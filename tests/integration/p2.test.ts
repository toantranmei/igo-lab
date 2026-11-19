import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { t, type Db } from '@cl/db';
import { DEFAULT_AGENT_CONFIG } from '@cl/agents';
import { confirmJdSet, createRun, createSession, getDetail, attemptCalc } from '@cl/pipeline';
import { WS, closeTestDb, resetDb } from './helpers';
import { JD_A, JD_B, doc, jd, newSession, runThrough } from './fixtures';

let db: Db;
beforeAll(() => {
  process.env.AGENT_RETRY_DELAY_MS = '1';
});
beforeEach(async () => {
  db = await resetDb();
  process.env.FAKE_CLAUDE_LOG = path.join(mkdtempSync(path.join(os.tmpdir(), 'cl-fake-')), 'calls.jsonl');
  process.env.FAKE_CLAUDE_MODE = 'ok';
});
afterAll(closeTestDb);

const many = (n: number, tag: string) => Array.from({ length: n }, (_, i) => doc(`${tag}${i}`, jd(`${tag} ${i} ${['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'][i % 5]} ${i * 7}`, [`NV: Sắp xếp backlog đợt ${tag}-${i} theo giá trị kỳ vọng của quý ${i} [k1]`, `NV: Viết tiêu chí nghiệm thu cho mục ${i}-${tag} trước kỳ phát hành [k2]`, 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]'])));
async function sopSession(name: string, docs: ReturnType<typeof doc>[], charter: Record<string, unknown> = {}) {
  const { id } = await createSession(db, WS, { name, role_title: 'Product Owner', purpose: 'Khung nội bộ', context: 'Phần mềm', industry: 'Phần mềm', charter: { policy_id: 'sop-c', level: 'Chuyên viên', framework_type: 'ROOT', owner: 'Trưởng nhóm sản phẩm', ...charter } }, 'local');
  await confirmJdSet(db, WS, id, docs, 'local');
  const run = await createRun(db, WS, id, { acknowledge_send: true, cli_version: '2.1.325' }, 'local');
  return { sessionId: id, runId: run.id };
}

describe('P2 · nghiệm thu cổng', () => {
  it('G1 (8): 14 JD không qua theo chuẩn SOP; mỗi JD có A–E, L, M và hạng', async () => {
    const { sessionId } = await sopSession('G1 thiếu', many(14, 'J'));
    await runThrough(db, sessionId, 'B1');
    const b1 = await getDetail(db, WS, sessionId, 'B1');
    const g = b1.gates.find((x) => x.gate_id === 'B1.G1')!;
    expect(g.status).toBe('FAIL');
    expect(g.actual).toContain('N = 14');
    const j = (b1.raw as any).jds[0];
    expect(j.criteria).toMatchObject({ A: 3, B: 3, C: 3, D: 0, E: 1 }); // no posting date: D = 0
    expect(j).toMatchObject({ L: 16, M: 16, rank: 'P2' }); // 9 + 6 + 0 + 1
  });

  it('G0 (2): cấu hình agent kiểm trùng model với agent làm thì G0 chặn', async () => {
    const { sessionId, runId } = await newSession(db, [doc('A', JD_A)], 'G0 trùng model');
    const [run] = await db.select().from(t.run).where(eq(t.run.id, runId));
    const snap = run.snapshot as any;
    await db.update(t.run).set({ snapshot: { ...snap, agent_config: { ...snap.agent_config, tasks: { ...snap.agent_config.tasks, E9: DEFAULT_AGENT_CONFIG.tasks.E1 } } } }).where(eq(t.run.id, runId));
    await runThrough(db, sessionId, 'B0');
    const b0 = await getDetail(db, WS, sessionId, 'B0');
    expect(b0.state).toBe('actual_blocked');
    expect(b0.gates.find((x) => x.gate_id === 'B0.G4')).toMatchObject({ status: 'FAIL' });
  });

  it('mức C không có sự kiện thật: G4 không áp dụng, tầng Nội bộ; cổng thiếu dữ liệu đạt bằng phiếu sai lệch; số liệu lấy từ bản ghi phép tính', async () => {
    const { sessionId } = await newSession(db, [doc('A', JD_A), doc('B', JD_B)], 'Mức C');
    await runThrough(db, sessionId, 'B8');
    const b4 = await getDetail(db, WS, sessionId, 'B4');
    expect(b4.gates.find((x) => x.gate_id === 'B4.G4')).toMatchObject({ status: 'NOT_APPLICABLE' });
    const b2 = await getDetail(db, WS, sessionId, 'B2');
    // G2 is decided on data: a VN code from the catalog, ISCO-08 and O*NET occupations through the crosswalk
    expect(b2.gates.find((x) => x.gate_id === 'B2.G3')).toMatchObject({ status: 'PASS' });
    expect(b2.gates.find((x) => x.gate_id === 'B2.G3')!.deviation).toBeUndefined();
    expect((b2.raw as any).occupation).toMatchObject({ vn_code: '2421', isco08: '2421' });
    expect((b2.raw as any).occupation.external.length).toBeGreaterThan(0);
    expect((b2.raw as any).external_tasks.length).toBeGreaterThan(0);
    // B3: an O*NET task that supports a competency counts ω = 3 in its evidence weight (12)
    const b3g = ((await getDetail(db, WS, sessionId, 'B3')).raw as any).groups as any[];
    const ext = b3g.find((g) => g.external_refs?.length);
    expect(ext.external_refs.every((r: string) => r.startsWith('onet:'))).toBe(true);
    expect(ext.evidence_weight).toBeGreaterThanOrEqual(3 * ext.external_refs.length);
    const b8 = (await getDetail(db, WS, sessionId, 'B8')).raw as any;
    expect(b8.tier).toBe('INTERNAL');
    expect(b8.deviations).toEqual(expect.arrayContaining(['G3']));
    expect(b8.deviations).not.toContain('G2');
    // B5: the numbers on the screen are the calc records of the run
    const [a5] = await db.select().from(t.blockAttempt).where(eq(t.blockAttempt.block, 'B5'));
    const keep = await attemptCalc(db, WS, a5.id, 'B5.keep');
    const b5 = (await getDetail(db, WS, sessionId, 'B5')).raw as any;
    expect(keep.rows.length).toBe(b5.scores.length);
    expect(keep.rows[0]).toMatchObject({ inputs: { importance: [4, 4, 4] }, output: { rwg: 1 } });
    // B6: indicators at levels 1, 3, 5, retranslation on competency AND level, Fleiss κ recorded
    const b6 = (await getDetail(db, WS, sessionId, 'B6')).raw as any;
    expect(new Set(b6.indicators.map((x: any) => x.level))).toEqual(new Set(['1', '3', '5']));
    expect(b6.indicators.every((x: any) => x.non_abstain === 3)).toBe(true);
    expect(b6.fleiss.kappa).toBe(1);
    // B7: the independent audit with ten variables. Level C (decision 19/11): E8 on Haiku, so (31) is a deviation
    // ticket; level C stays Internal anyway. Levels A/B run E8 on Opus (see the P4 test).
    const b7 = await getDetail(db, WS, sessionId, 'B7');
    expect(b7.gates.find((x) => x.gate_id === 'B7.G5')).toMatchObject({ status: 'PASS' });
    expect(b7.gates.find((x) => x.gate_id === 'B7.G6')!.deviation).toBeTruthy();
    expect((b7.raw as any).audit.variables).toHaveLength(10);
  });

  it('chỉ báo mơ hồ: dịch ngược trượt, viết lại một vòng rồi đạt', async () => {
    const vague = jd('Công ty V', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục vague_test [k1]']);
    const { sessionId } = await newSession(db, [doc('V', vague)], 'Mơ hồ');
    await runThrough(db, sessionId, 'B6');
    const b6 = (await getDetail(db, WS, sessionId, 'B6')).raw as any;
    expect(b6.rewritten).toBe(6);
    expect(b6.indicators.every((x: any) => x.round === 2 && x.pass)).toBe(true);
    expect(b6.passed).toHaveLength(1);
  });

  it('viết lại một phần: chỉ báo viết lại lấy số trống của bậc, không trùng mã với chỉ báo đã đạt', async () => {
    const half = jd('Công ty H', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục vague_half [k1]']);
    const { sessionId } = await newSession(db, [doc('H', half)], 'Nửa mơ hồ');
    await runThrough(db, sessionId, 'B6');
    const b6 = (await getDetail(db, WS, sessionId, 'B6')).raw as any;
    expect(b6.rewritten).toBe(3);
    const ns = b6.indicators.map((x: any) => `${x.competency_id}-${x.n}`);
    expect(new Set(ns).size).toBe(ns.length);
    expect(new Set(b6.indicators.map((x: any) => x.key)).size).toBe(b6.indicators.length);
    expect(b6.indicators.filter((x: any) => x.round === 2).map((x: any) => x.n).sort()).toEqual([12, 32, 52]);
  });

  it('P3: từ chối có lý do → lượt sau của cùng vị trí nạp lý do đó vào bài học tự nạp', async () => {
    const { decideCandidate } = await import('@cl/registry');
    const { getCandidate } = await import('@cl/pipeline');
    const one = await newSession(db, [doc('A', JD_A)], 'Bị từ chối');
    await runThrough(db, one.sessionId, 'B8');
    const c = (await getCandidate(db, WS, one.sessionId))!;
    await decideCandidate(db, WS, c.id, { decision: 'REJECT', reason: 'Định nghĩa Ưu tiên backlog quá hẹp', actor: 'reviewer' });
    const two = await newSession(db, [doc('B', JD_B)], 'Lượt sau');
    const [run] = await db.select().from(t.run).where(eq(t.run.id, two.runId));
    expect((run.snapshot as any).lessons_loaded.map((l: any) => l.text).join(' ')).toContain('Định nghĩa Ưu tiên backlog quá hẹp');
  });
});
