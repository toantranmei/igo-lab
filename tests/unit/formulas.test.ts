import { describe, expect, it } from 'vitest';
import * as F from '../../packages/pipeline/src/formulas';

/** Hand-computed answers (spec §6.4.1: rounding error ≤ 0.01). */
describe('Công thức P2 so với đáp án tính tay', () => {
  it('(5)–(8) lăng kính, hạng nguồn, G1', () => {
    expect(F.lensL(3, 3, 2, 2)).toBe(19); // 9 + 6 + 2 + 2
    expect(F.lensM(1, 3, 3, 2, 2)).toBeNull(); // A < 2
    expect(F.lensM(2, 3, 2, 1, 2)).toBe(16); // 9 + 4 + 1 + 2
    expect(F.sourceRank(19, null)).toBe('P1');
    expect(F.sourceRank(12, 16)).toBe('P2');
    expect(F.sourceRank(12, 12)).toBe('P3');
    // acceptance 2: 14 JD fail G1; 15 JD with only 4 P1 fail G1
    expect(F.g1(14, 9, 15, 5)).toBe(false);
    expect(F.g1(15, 4, 15, 5)).toBe(false);
    expect(F.g1(15, 5, 15, 5)).toBe(true);
    expect(F.recencyD('2026-08-01', '2026-11-18')).toBe(3);
    expect(F.recencyD('2025-06-01', '2026-11-18')).toBe(1);
    expect(F.recencyD(null, '2026-11-18')).toBe(0); // no posting date: kept, lowest recency
    // SOP: postings older than 24 months are dropped
    expect(F.tooOld('2024-11-01', '2026-11-18')).toBe(true);
    expect(F.tooOld('2025-01-01', '2026-11-18')).toBe(false);
    expect(F.tooOld(null, '2026-11-18')).toBe(false);
  });
  it('(9) quy thang; (11)–(14) trọng số, điểm thị trường, bao phủ', () => {
    expect(F.scale100to5(75)).toBe(4);
    expect(F.scale100to5(0)).toBe(1);
    expect(F.taskWeight(3, 4)).toBe(0.75);
    expect(F.evidenceWeight(['P1', 'P2', 'P3', 'EXTERNAL'])).toBe(9);
    expect(F.marketScore(6, 9)).toBeCloseTo(0.6667, 3);
    expect(F.libraryCoverage(3, 12)).toBe(0.25);
  });
  it('(15) Cohen κ', () => {
    // 10 items; agreements at 1–4 (A) and 8–10 (B) → p_o = 0.7; first coder A5 B5, second A6 B4
    // → p_e = 0.5·0.6 + 0.5·0.4 = 0.5; κ = (0.7 − 0.5) / (1 − 0.5) = 0.4
    const a = ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B'];
    const b = ['A', 'A', 'A', 'A', 'B', 'A', 'A', 'B', 'B', 'B'];
    expect(F.cohenKappa(a, b)).toMatchObject({ po: 0.7, pe: 0.5, kappa: 0.4 });
    expect(F.cohenKappa(['X', 'X'], ['X', 'X']).kappa).toBe(1);
  });
  it('(20)–(23) r_wg, quy tắc giữ, tập lõi; ví dụ 4,4,5 và 5,4,2 của spec', () => {
    const keep = F.keepRule({ importance: [4, 4, 5], discrimination: [4, 3, 4] });
    expect(keep).toMatchObject({ keep: true, mean_importance: 4.3333, variance: 0.3333, rwg: 0.8333 });
    const drop = F.keepRule({ importance: [5, 4, 2], discrimination: [4, 4, 4] });
    expect(drop.mean_importance).toBeCloseTo(3.67, 2);
    expect(drop.variance).toBeCloseTo(2.33, 2);
    expect(drop.rwg).toBe(0);
    expect(drop.keep).toBe(false);
    expect(drop.reasons[0]).toContain('r_wg');
    expect(F.keepRuleC(0.6, null)).toBe(true);
    const core = F.coreSet(Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, mean_importance: 5 - i / 10, S: 1, meta: i < 3 })));
    expect(core).toHaveLength(14);
    expect(core.filter((c) => c.meta)).toHaveLength(1);
  });
  it('(26) bậc trung vị; (27) tỷ lệ dịch ngược có phiếu trắng; (28) Fleiss κ', () => {
    expect(F.medianLevel([3, 4, 3])).toBe(3);
    expect(F.medianLevel([3, 4])).toBe(4); // rounds up
    expect(F.medianLevel([4])).toBeNull();
    // acceptance 4: one right vote and two blanks → 1/3, below 0.70
    const r = F.retranslationRate([{ competency: 'c1', level: '3' }, { competency: '', level: '' }, { competency: '', level: '' }], { competency: 'c1', level: '3' });
    expect(r.p).toBeCloseTo(0.33, 2);
    expect(r.p < 0.7).toBe(true);
    // spec example: levels 1, 3, 5 on an indicator written for level 3 → 1/3
    expect(F.retranslationRate([{ competency: 'c', level: '1' }, { competency: 'c', level: '3' }, { competency: 'c', level: '5' }], { competency: 'c', level: '3' }).p).toBeCloseTo(0.33, 2);
    // Fleiss: 3 raters, 4 items. Item rows: [I,I,I] [I,I,II] [II,II,II] [III,II,II]
    // P_i: 1, 1/3, 1, 1/3 → P̄ = 0.6667; totals I 5, II 6, III 1 of 12 → P̄e = (25+36+1)/144 = 0.4306; κ = 0.2361/0.5694 = 0.4146
    const f = F.fleissKappa([['I', 'I', 'I'], ['I', 'I', 'II'], ['II', 'II', 'II'], ['III', 'II', 'II']]);
    expect(f.P).toBeCloseTo(0.6667, 3);
    expect(f.Pe).toBeCloseTo(0.4306, 3);
    expect(f.kappa).toBeCloseTo(0.4146, 3);
    expect(F.fleissKappa([['II', 'II', 'II'], ['II', 'II', 'II']]).kappa).toBe(1);
  });
  it('(29)–(36) số chỉ báo, kết quả chính, thẩm định, tầng, hạn rà soát', () => {
    expect([1, 2, 4, 5].map(F.indicatorCountOk)).toEqual([false, true, true, false]);
    expect(F.outcomeConstraint({ a: ['o1'], b: ['o1', 'o2'], c: ['o2', 'o3'], d: ['o3'] }, ['a', 'b', 'c', 'd'], ['o1', 'o2', 'o3']).ok).toBe(true);
    expect(F.auditIndependent('sonnet', ['haiku', 'sonnet'])).toBe(false);
    expect(F.auditSample(37)).toBe(4);
    expect(F.g7(F.AUDIT_VARIABLES.map((v) => ({ variable: v, result: 'PASS', plan: '' })))).toBe(true);
    expect(F.g7(F.AUDIT_VARIABLES.map((v, i) => ({ variable: v, result: i ? 'PASS' : 'PASS_COND', plan: '' })))).toBe(false);
    // acceptance 6: level C without real events → Internal
    expect(F.releaseTier({ rigor: 'C', g6Data: true, g7Data: true, deviationIn: ['G4'], g11: false, g12: false }).tier).toBe('INTERNAL');
    expect(F.releaseTier({ rigor: 'B', g6Data: true, g7Data: true, deviationIn: [], g11: false, g12: false }).tier).toBe('MARKET');
    expect(F.releaseTier({ rigor: 'B', g6Data: true, g7Data: true, deviationIn: ['G3'], g11: false, g12: false }).tier).toBe('INTERNAL');
    expect(F.reviewDate('2026-11-18T10:00:00Z', true)).toBe('2027-11-18');
    expect(F.reviewDate('2026-11-18T10:00:00Z', false)).toBe('2028-11-18');
    expect(F.seededShuffle([1, 2, 3, 4, 5], 7)).toEqual(F.seededShuffle([1, 2, 3, 4, 5], 7));
  });
});
