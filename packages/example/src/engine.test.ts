import { describe, expect, it } from 'vitest';
import { Lab, seed, initial } from './engine';
import { Catalog, buildGraph } from './catalog';

function runAll(lab: Lab) {
  const outs: Record<string, any> = {};
  let o;
  while ((o = lab.step())) outs[o.id] = o.output;
  return outs;
}
const count = (changes: any[], a: string) => changes.filter((c) => c.action === a).length;

describe('seed (YC Phụ lục A)', () => {
  it('lượt 1 và 2 có đúng số JD, nhiệm vụ, sự kiện, tổng trọng số', () => {
    const s1 = seed(1), s2 = seed(2);
    expect([s1.jds.length, s1.tasks.length, s1.events.length]).toEqual([8, 6, 6]);
    expect([s2.jds.length, s2.tasks.length, s2.events.length]).toEqual([11, 7, 7]);
    expect(s1.tasks.reduce((a, t) => a + t.weight, 0)).toBe(15);
    expect(s2.tasks.reduce((a, t) => a + t.weight, 0)).toBe(19);
    expect(s2.events.find((e) => e.concept === 'metrics')!.ratings).toEqual([4, 4, 3]);
    expect(initial().C.map((c) => c.id)).toEqual(['C01', 'C02']);
  });
});

describe('engine (YC §11)', () => {
  it('lượt 1: B3 7 ứng viên P=6/7, coverage 15/15, lõi 1.0 = 4 ADD + 2 UPDATE, LL-001', () => {
    const lab = new Lab();
    const o = runAll(lab);
    expect(o.B1._metrics).toEqual({ valid: 8, total: 8 });
    expect(o.B3.candidates).toHaveLength(7);
    expect(o.B3.candidates.filter((c: any) => c.alias).map((c: any) => c.name)).toEqual(['Giao tiếp với stakeholder']);
    expect(o.B3._metrics.precision).toBeCloseTo(6 / 7);
    expect(o.B3._metrics.recall).toBe(1);
    expect(o.B5.selected).toHaveLength(6);
    expect(o.B5.coverage).toBe(1);
    expect(o.B5.removedLate).toBe(1);
    expect(o.B5.selected.every((c: any) => c.level === 3)).toBe(true);
    expect(o.B6.cards.every((c: any) => c.votes.join() === [c.id, c.id, c.id].join())).toBe(true);
    expect(o.B8.version).toBe('1.0');
    expect([count(o.B8.changes, 'ADD'), count(o.B8.changes, 'UPDATE'), count(o.B8.changes, 'REUSE')]).toEqual([4, 2, 0]);
    expect(o.B8.audit.findings.map((f: any) => f.id)).toEqual(['F-001']);
    expect(lab.dictionary.lessons.map((l) => l.id)).toEqual(['LL-001']);
    expect(lab.dictionary.C).toHaveLength(6);
    expect(lab.completed).toBe(true);
  });

  it('nhánh nhanh: pilot 9/12, chỉ ghi V', () => {
    const lab = new Lab();
    for (let i = 0; i < 4; i++) lab.step();
    const before = JSON.stringify({ W: lab.dictionary.W, C: lab.dictionary.C, R: lab.dictionary.R });
    const f = lab.quick();
    expect([f.feedback.tasks, f.feedback.success, f.feedback.errors]).toEqual([12, 9, 3]);
    expect(f.competencies).toHaveLength(6);
    expect(JSON.stringify({ W: lab.dictionary.W, C: lab.dictionary.C, R: lab.dictionary.R })).toBe(before);
    expect(lab.dictionary.V.map((v) => v.id)).toEqual(['PILOT-1']);
  });

  it('lượt 2: 11 JD, khử trùng sớm, C04 bậc 4, lõi 1.1 = 1 ADD + 1 UPDATE + 5 REUSE, giữ R 1.0', () => {
    const lab = new Lab();
    runAll(lab);
    expect(() => lab.nextRound()).toThrow('Lesson chưa An toàn');
    lab.approve();
    lab.nextRound();
    const o = runAll(lab);
    expect(o.B1._metrics.total).toBe(11);
    expect(o.B3.earlyDedup).toBe(true);
    expect(o.B3.candidates).toHaveLength(7);
    expect(o.B3.candidates.some((c: any) => c.alias)).toBe(false);
    expect(o.B5.removedLate).toBe(0);
    expect(o.B5.selected.find((c: any) => c.id === 'C04').level).toBe(4);
    expect(o.B6.cards.find((c: any) => c.id === 'C04').indicator).toContain('nhóm đối chiếu');
    expect(o.B8.version).toBe('1.1');
    expect([count(o.B8.changes, 'ADD'), count(o.B8.changes, 'UPDATE'), count(o.B8.changes, 'REUSE')]).toEqual([1, 1, 5]);
    expect(o.B8.audit.findings).toHaveLength(0);
    const [r10, r11] = lab.dictionary.R;
    expect(r10.version).toBe('1.0');
    expect(r10.competencies.find((c: any) => c.id === 'C04').level).toBe(3);
    expect(r11.competencies.find((c: any) => c.id === 'C04').level).toBe(4);
  });

  it('coverage cộng dồn 3,6,9,11,13,15 trên 15 và mẫu số 19 ở lượt 2', () => {
    const acc: number[] = [];
    seed(1).tasks.reduce((s, t) => (acc.push(s + t.weight), s + t.weight), 0);
    expect(acc).toEqual([3, 6, 9, 11, 13, 15]);
    expect(seed(2).tasks.reduce((s, t) => s + t.weight, 0)).toBe(19);
  });

  it('lỗi mô phỏng: mất nguồn chặn tại B1, ghi trái quyền chặn tại B6, mở lại có dấu vết', () => {
    const a = new Lab();
    a.fault = 'missing_source';
    a.step();
    const r = a.step()!;
    expect(r.id).toBe('B1');
    expect(r.pass).toBe(false);
    expect(a.halted).toBe(true);
    expect(a.step()).toBeNull();
    expect(a.quick()).toBeNull();
    a.recover('đã bổ sung nguồn');
    expect(a.halted).toBe(false);
    expect(a.logs.at(-1)!.type).toBe('RESUME');
    expect(a.step()!.pass).toBe(true);

    const b = new Lab();
    b.fault = 'forbidden_write';
    let o;
    while ((o = b.step()) && o.pass);
    expect(o!.id).toBe('B6');
    expect(b.dictionary.version).toBe('0.9');
  });
});

describe('catalog (YC Phụ lục B)', () => {
  it('kích thước và trọng số', () => {
    expect([Catalog.families.length, Catalog.roles.length, Catalog.industries.length, Catalog.competencies.length, Catalog.profiles.length]).toEqual([5, 10, 4, 21, 40]);
    expect(Catalog.profiles.filter((p) => p.industry === 'BASE')).toHaveLength(10);
    for (const p of Catalog.profiles) expect(p.requirements.reduce((s, q) => s + q.weight, 0)).toBeCloseTo(1);
    expect(Catalog.profiles.every((p) => p.sources.length === 20)).toBe(true);
  });
  it('view toàn mạng mặc định: 36 node, 134 cạnh; Sản phẩm số + Tài chính: 3 role', () => {
    const g = buildGraph(Catalog.filtered({}));
    expect(g.nodes).toHaveLength(36);
    expect(g.edges).toHaveLength(134);
    const f = buildGraph(Catalog.filtered({ family: 'PRODUCT', industry: 'FIN' }));
    expect(f.nodes.filter((n) => n.kind === 'role')).toHaveLength(3);
  });
  it('bộ lọc nhóm không đổi mẫu số trọng số', () => {
    const all = Catalog.filtered({ industry: 'FIN' }).find((p) => p.id === 'R-PO-FIN')!;
    const pro = Catalog.filtered({ industry: 'FIN', group: 'PRO' }).find((p) => p.id === 'R-PO-FIN')!;
    const q = pro.requirements[0];
    expect(all.requirements.find((x) => x.id === q.id)!.weight).toBe(q.weight);
    expect(pro.requirements.reduce((s, x) => s + x.weight, 0)).toBeLessThan(1);
  });
  it('core = importance ≥ 4 OR criticality ≥ 4; Jaccard theo trọng số; mẫu số 0 → null', () => {
    for (const p of Catalog.profiles) for (const q of p.requirements) expect(q.core).toBe(q.importance >= 4 || q.criticality >= 4);
    const a = Catalog.profiles.find((p) => p.id === 'R-PO-TECH')!, b = Catalog.profiles.find((p) => p.id === 'R-DA-FIN')!;
    const c = Catalog.compare(a, b);
    expect(c.jaccard).toBeGreaterThan(0);
    expect(c.jaccard).toBeLessThan(1);
    expect(Catalog.compare(a, a).jaccard).toBeCloseTo(1);
    const empty = { ...a, requirements: [] };
    expect(Catalog.compare(empty, empty).jaccard).toBeNull();
  });
});
