import { describe, expect, it } from 'vitest';
import { BLOCK_IDS, BlockTraceSchema, MAIN_BLOCK_IDS } from '@cl/contract';
import type { BlockId, BlockTrace } from '@cl/contract';
import { Lab } from './engine';
import { explain, snapshot } from './explain';
import { buildTrace } from './trace';

const runAll = (lab: Lab) => {
  while (lab.step());
  return lab;
};
const round2 = () => {
  const lab = runAll(new Lab());
  lab.approve();
  lab.nextRound();
  return lab;
};
const reads = (t: BlockTrace) => t.events.filter((e) => e.kind === 'READ');

const READS_ROUND_1: Record<BlockId, number> = {
  B0: 3,
  B1: 8 + 1,
  B2: 6,
  B3: 8 + 1 + 1,
  B4: 6,
  B5: 7 + 1 + 6 + 6,
  B6: 6 * (1 + 3) + 1,
  B7: 7 + 1,
  B8: 6 + 2,
  FAST: 7 + 1,
};

function expectStructure(t: BlockTrace, id: BlockId, readCount: number) {
  expect(BlockTraceSchema.safeParse(t).success).toBe(true);
  const kinds = t.events.map((e) => e.kind);
  expect(kinds).toEqual(['RECEIVE', ...Array(readCount).fill('READ'), ...Array(t.gates.length).fill('GATE'), 'HANDOFF']);
  expect(t.gates).toHaveLength(2);
  expect(t.events.map((e) => e.seq)).toEqual(t.events.map((_, i) => i));
  expect(t.events.every((e) => e.block === id && e.source === 'CODE' && e.attempt_id === t.attempt_id)).toBe(true);
  const gateEvents = t.events.filter((e) => e.kind === 'GATE');
  expect(gateEvents.map((e) => e.gate)).toEqual(t.gates);
  expect(gateEvents.every((e) => e.record_refs.length === 0)).toBe(true);
  expect(t.gates.map((g) => g.gate_id)).toEqual([`${id}.G1`, `${id}.G2`]);
  expect(t.gates.every((g) => g.required && g.rule_version === 'sim-policy-1.0' && typeof g.criterion === 'string')).toBe(true);
  expect(t.events[0].record_refs).toEqual(t.input_keys);
  const keys = new Set(t.records.map((r) => r.key));
  expect(t.events.flatMap((e) => e.record_refs).every((k) => keys.has(k))).toBe(true);
}

describe('buildTrace · cấu trúc nhịp', () => {
  it('lượt 1, block đã chạy: RECEIVE → READ… → GATE mỗi luật → HANDOFF với đúng số nhịp READ', () => {
    const lab = runAll(new Lab());
    lab.quick();
    for (const id of BLOCK_IDS) {
      const t = buildTrace(lab, id);
      expectStructure(t, id, READS_ROUND_1[id]);
      expect(t.attempt_id).toBe(`example-r1-${id}`);
      expect(t.computed_at).not.toBe('1970-01-01T00:00:00.000Z');
      expect(t.expected).toEqual(JSON.parse(JSON.stringify(id === 'FAST' ? lab.fast : lab.outputs[id])));
    }
    expect(buildTrace(lab, 'FAST').gates.map((g) => g.name)).toEqual(['Truy nguồn bản thử', 'Phạm vi dùng thử']);
  });

  it('xem trước block chưa chạy: cùng số nhịp, thời điểm cố định, không đổi lab', () => {
    const lab = new Lab();
    const before = JSON.stringify(lab);
    for (const id of BLOCK_IDS) {
      const t = buildTrace(lab, id);
      expectStructure(t, id, READS_ROUND_1[id]);
      expect(t.computed_at).toBe('1970-01-01T00:00:00.000Z');
      expect(JSON.stringify(buildTrace(lab, id))).toBe(JSON.stringify(t));
      explain(lab, id);
    }
    expect(JSON.stringify(lab)).toBe(before);
    expect(lab.position).toBe(0);
    expect(lab.logs).toHaveLength(0);
  });

  it('xem trước giữa chừng (đã chạy tới B3) không đổi lab', () => {
    const lab = new Lab();
    for (let i = 0; i < 4; i++) lab.step();
    const before = JSON.stringify(lab);
    const t = buildTrace(lab, 'B8');
    expect(reads(t)).toHaveLength(READS_ROUND_1.B8);
    buildTrace(lab, 'FAST');
    expect(JSON.stringify(lab)).toBe(before);
    expect(snapshot(lab, 'B3').actual).toBe(true);
    expect(snapshot(lab, 'B4').actual).toBe(false);
  });

  it('lượt 2: số nhịp READ theo seed mới', () => {
    const lab = runAll(round2());
    const count = (id: BlockId) => reads(buildTrace(lab, id)).length;
    expect(count('B1')).toBe(11 + 1);
    expect(count('B2')).toBe(7);
    expect(count('B3')).toBe(11 + 1 + 1);
    expect(count('B5')).toBe(7 + 1 + 7 + 7);
    expect(count('B6')).toBe(7 * 4 + 1);
    expect(count('B8')).toBe(7 + 2);
    expect(buildTrace(lab, 'B0').attempt_id).toBe('example-r2-B0');
  });
});

describe('buildTrace · B1', () => {
  it('nhịp JD thứ 2 ghi rõ 1 + 1 = 2, bộ đếm 1 → 2, mẫu số là số JD đã đọc', () => {
    const t = buildTrace(new Lab(), 'B1');
    const second = reads(t)[1];
    expect(second.title).toContain('JD-1-2');
    expect(second.substitution).toContain('1 + 1 = 2');
    expect(second.substitution).toContain('2/2 = 100%');
    expect(second.substitution).toContain('N = 8');
    expect(second.before.hợp_lệ).toBe(1);
    expect(second.after.hợp_lệ).toBe(2);
    expect(second.before.đã_đọc).toBe(1);
    expect(second.after.đã_đọc).toBe(2);
    expect(second.record_refs).toEqual(['JD-1-2']);
    expect(second.denominator?.value).toBe(2);
    expect(reads(t).slice(0, 8).map((e) => e.after.hợp_lệ)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reads(t)[8].denominator?.value).toBe(8);
    expect(reads(t)[7].draft).toHaveLength(8);
  });

  it('lỗi mất nguồn: JD đầu không tăng bộ đếm, cổng FAIL, HANDOFF bị chặn', () => {
    const lab = new Lab();
    lab.fault = 'missing_source';
    const t = buildTrace(lab, 'B1');
    const first = reads(t)[0];
    expect(first.substitution).toContain('0 + 0 = 0');
    expect(first.after.hợp_lệ).toBe(0);
    expect(reads(t)[1].substitution).toContain('0 + 1 = 1');
    expect(t.gates.map((g) => g.status)).toEqual(['PASS', 'FAIL']);
    expect(t.events.at(-1)!.title).toBe('Đã chặn · không bàn giao');
    // block sau cổng chặn không có đầu ra để diễn giải
    const b2 = buildTrace(lab, 'B2');
    expect(b2.events.map((e) => e.kind)).toEqual(['RECEIVE', 'HANDOFF']);
    expect(b2.gates).toEqual([]);
    expect(explain(lab, 'B2').state).toBe('not_run');
    expect(explain(lab, 'B2').blockedAt).toBe('B1');
    expect(lab.position).toBe(0);
  });
});

describe('buildTrace · B5', () => {
  const taskBeats = (t: BlockTrace) => reads(t).filter((e) => e.title.startsWith('Cộng trọng số nhiệm vụ'));

  it('lượt 1: coverage 3/15 → 15/15, mẫu số cố định 15, công thức trung vị đúng', () => {
    const t = buildTrace(new Lab(), 'B5');
    const beats = taskBeats(t);
    expect(beats.map((e) => `${e.after.tử_số}/${e.after.mẫu_số_cố_định}`)).toEqual(['3/15', '6/15', '9/15', '11/15', '13/15', '15/15']);
    expect(beats.map((e) => e.draft.find((d) => d.id === 'R.coverage')!.value.split(' = ')[0])).toEqual(['3/15', '6/15', '9/15', '11/15', '13/15', '15/15']);
    expect(beats.every((e) => e.denominator?.value === 15)).toBe(true);
    const medians = reads(t).filter((e) => e.title.startsWith('Sắp xếp rating'));
    expect(medians).toHaveLength(6);
    expect(medians.every((e) => e.formula === 'Level = median(r₁, r₂, r₃)')).toBe(true);
    expect(t.events.some((e) => (e.formula || '').includes('sorted[2]'))).toBe(false);
    expect(reads(t).filter((e) => e.title.startsWith('Gộp trùng'))).toHaveLength(1);
  });

  it('lượt 2: mẫu số 19, C04 [4, 4, 3] → trung vị 4', () => {
    const t = buildTrace(round2(), 'B5');
    const beats = taskBeats(t);
    expect(beats).toHaveLength(7);
    expect(beats.every((e) => e.denominator?.value === 19)).toBe(true);
    expect(beats.at(-1)!.after.tử_số).toBe(19);
    const c04 = reads(t).find((e) => e.title === 'Sắp xếp rating của C04')!;
    expect(c04.substitution).toBe('[4, 4, 3] → [3, 4, 4] → phần tử giữa = 4');
    expect(c04.after.median).toBe(4);
  });
});

describe('buildTrace · B3 và explain', () => {
  it('lượt 1 có nhịp alias; lượt 2 có nhịp LL-001 và không còn ứng viên alias', () => {
    const t1 = buildTrace(new Lab(), 'B3');
    expect(reads(t1).some((e) => e.title === 'Đưa alias stakeholder vào hàng ứng viên')).toBe(true);
    const lab2 = round2();
    const t2 = buildTrace(lab2, 'B3');
    expect(reads(t2).some((e) => e.title === 'Áp dụng LL-001 trước bàn giao')).toBe(true);
    expect(reads(t2).some((e) => e.title.includes('alias'))).toBe(false);
    expect((t2.expected as any).candidates.some((c: any) => c.alias)).toBe(false);
    expect(t2.events.at(-1)!.draft.some((d) => d.id.includes('alias'))).toBe(false);
    const v = explain(lab2, 'B3').visual;
    expect(v?.kind === 'b3' && v.candidates.length === 7 && v.unique === 7 && v.jdCount === 11).toBe(true);
  });

  it('explain điền đủ trường cho mọi block, trạng thái đúng theo tiến độ', () => {
    const lab = new Lab();
    expect(explain(lab, 'B0').state).toBe('preview');
    runAll(lab);
    lab.quick();
    for (const id of MAIN_BLOCK_IDS) {
      const d = explain(lab, id);
      expect(d.state).toBe('actual_pass');
      expect(d.flow).toHaveLength(3);
      expect(d.input).toHaveLength(3);
      expect(d.output).toHaveLength(3);
      expect(d.calc.length).toBeGreaterThan(0);
      expect(d.gates).toEqual(buildTrace(lab, id).gates);
      expect(d.handoffTarget).toBe(id === 'B8' ? 'LÕI & VÒNG SAU' : 'BƯỚC TIẾP');
      expect(d.raw).toBe(lab.outputs[id]);
    }
    const fast = explain(lab, 'FAST');
    expect(fast.state).toBe('trial');
    expect(fast.handoffTarget).toBe('KHO V');
    expect(fast.calc[0].substitution).toBe('9 / 12 = 75%');
    expect(fast.calc[0].meaning.startsWith('9 thành công, 3 lỗi')).toBe(true);
    expect(explain(lab, 'B6').calc[0].substitution).toContain('C01: 3/3 = 100%');
    const b5 = explain(lab, 'B5').visual;
    expect(b5?.kind === 'b5' && b5.links.T5).toEqual(['C05']);
    const b8 = explain(lab, 'B8').visual;
    expect(b8?.kind === 'b8' && b8.changes.map((c) => c.action).join()).toBe('UPDATE,UPDATE,ADD,ADD,ADD,ADD');
    const b7 = explain(lab, 'B7').visual;
    expect(b7?.kind === 'b7' && b7.gates.length === 7 && b7.coverageOk).toBe(true);
  });
});
