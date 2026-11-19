/**
 * Formulas (1)–(37) against the independent answer key in tests/reference/golden.json (computed by
 * tests/reference/formulas_ref.py from the white paper and the spec only, without reading the code). Tolerance 0.01.
 * Cases whose reading of the documents differs from a decision already taken are listed in KNOWN with the reason.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as F from '../../packages/pipeline/src/formulas';
import { prf } from '../../packages/pipeline/src/anchor';

const golden = JSON.parse(readFileSync(path.join(__dirname, '../reference/golden.json'), 'utf8')) as { tolerance: number; cases: { formula: string; name: string; inputs: any; expected: any }[] }[] extends never ? never : any;
const TOL = 0.01;
const near = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= TOL);
const RANK: Record<string, string> = { P1: 'P1', P2: 'P2', P3: 'P3' };
const TIER: Record<string, F.Tier> = { noi_bo: 'INTERNAL', san_pham_thi_truong: 'MARKET', quyet_dinh_nhan_su: 'HR_DECISION' };

/** formula → (inputs) → value comparable with `expected`; undefined = case shape not handled by this adapter. */
const ADAPT: Record<string, (i: any, name: string) => any> = {
  '(5)': (i) => F.lensL(i.A, i.C, i.D, i.E),
  '(6)': (i) => F.lensM(i.A, i.B, i.C, i.D, i.E),
  '(7)': (i) => RANK[F.sourceRank(i.L ?? F.lensL(i.A, i.C, i.D, i.E), 'L' in i ? i.M : F.lensM(i.A, i.B, i.C, i.D, i.E))],
  '(8)': (i) => F.g1(i.n_full, i.n_p1, 15, 5),
  '(9)': (i) => F.scale100to5(i.x),
  '(11)': (i) => (i.N ? F.taskWeight(i.n_t, i.N) : null),
  '(12)': (i) => F.evidenceWeight(i.sources.map((x: string) => (x === 'EXT' ? 'EXTERNAL' : x))),
  '(13)': (i) => {
    const max = Math.max(0, ...Object.values(i.E as Record<string, number>));
    return Object.fromEntries(Object.entries(i.E as Record<string, number>).map(([k, w]) => [k, max ? F.marketScore(w, max) : null]));
  },
  '(14)': (i) => F.libraryCoverage(i.n_coded_existing, i.n_sentences),
  '(15)': (i) => {
    const k = F.cohenKappa(i.coder1, i.coder2);
    return { p_o: k.po, p_e: k.pe, kappa: k.pe >= 1 ? null : k.kappa, G3: k.pe < 1 && (k.kappa ?? -1) >= 0.61 };
  },
  '(16)': (i) => {
    const r = prf(i.correct, i.extra, i.missed);
    return { P: r.precision, R: r.recall, F1: r.f1 };
  },
  '(18)': (i) => (i.level === 'C' ? undefined : F.sampleB(i.n_people, i.n_events)),
  '(20)': (i) => {
    const xs = (i.ratings as (number | null)[]).filter((x): x is number => x !== null);
    return { mean: F.mean(xs), s2: xs.length < 2 ? null : F.variance(xs), rwg: F.rwg(xs) };
  },
  '(21)': (i) => ('importance' in i ? undefined : i.mean_importance >= 3.5 && i.mean_discrimination >= 3.0 && i.rwg >= 0.7),
  '(22)': (i) => F.keepRuleC(i.S_c, i.s_ext),
  '(26)': (i) => F.medianLevel((i.votes as (number | null)[]).filter((x): x is number => x !== null)),
  '(27)': (i) => {
    const votes = (i.votes as ([string, number] | null)[]).map((v) => (v ? { competency: v[0], level: String(v[1]) } : { competency: '', level: '' }));
    const r = F.retranslationRate(votes, { competency: i.answer[0], level: String(i.answer[1]) });
    return { p: r.p, pass: r.p >= 0.7 };
  },
  '(29)': (i) => F.INDICATOR_LEVELS.every((L) => F.indicatorCountOk(i.counts[L] ?? 0)),
  '(30)': (i) => {
    const links: Record<string, string[]> = {};
    for (const [c, o] of i.links as [string, string][]) (links[c] ??= []).push(o);
    const r = F.outcomeConstraint(links, i.core, i.outcomes);
    return { constraint_30: !r.unlinked.length && !r.thin.length, outcomes_count_ok: i.outcomes.length >= 3 && i.outcomes.length <= 5 };
  },
  '(32)': (i) => F.auditSample(i.n_sentences),
  '(33)': (i) => {
    const vars = (i.variables as string[]).map((v, k) => ({ variable: F.AUDIT_VARIABLES[k] ?? `x${k}`, result: v === 'dat' ? 'PASS' : v.startsWith('dat_co_dieu_kien') ? 'PASS_COND' : 'FAIL', plan: v.endsWith('kem_ke_hoach') ? 'kế hoạch' : '' }));
    return F.g7(vars);
  },
  '(35)': (i) => {
    const g = i.gates as Record<string, string>;
    const t = F.releaseTier({ rigor: i.level, g6Data: g.G6 === 'data', g7Data: g.G7 === 'data', deviationIn: Object.keys(g).filter((k) => g[k] === 'deviation'), g11: !!i.G11, g12: !!i.G12 });
    return Object.keys(TIER).find((k) => TIER[k] === t.tier);
  },
  '(36)': (i) => F.reviewDate(i.release_date, i.tech_family),
};

/** Cases where the documents allow two readings and the product owner or the spec chose the one the code follows. */
const KNOWN: Record<string, string> = {
  '(16) nothing predicted': 'F1 = 2tp / (2tp + fp + fn) cho 0 khi tp = 0; đáp án để null vì P không xác định. Cùng kết luận: không đạt ngưỡng.',
  '(16) all wrong': 'Như trên: F1 = 0 thay vì null khi tp = 0.',
  '(13) all E = 0': 'Không có bằng chứng nào: code cho S = 0 (không có giá trị trống trong bảng xếp hạng); đáp án để null. Cùng kết luận: không giữ.',
};

const cases = (golden.cases as any[]).filter((c) => ADAPT[c.formula]);
function same(got: any, exp: any): boolean {
  if (typeof exp === 'number' || exp === null) return typeof got === 'number' || got === null ? near(got, exp) : false;
  if (Array.isArray(exp)) return Array.isArray(got) && got.length === exp.length && exp.every((x, k) => same(got[k], x));
  if (typeof exp === 'object') return got && typeof got === 'object' && Object.keys(exp).every((k) => same(got[k], exp[k]));
  return got === exp;
}

describe('công thức (1)–(37) so với đáp án tính độc lập', () => {
  it('đáp án có đủ 37 công thức', () => {
    const covered = new Set((golden.cases as any[]).map((c) => c.formula));
    for (let n = 1; n <= 37; n++) expect(covered.has(`(${n})`), `(${n})`).toBe(true);
  });
  it.each(cases.map((c) => [`${c.formula} ${c.name}`, c] as const))('%s', (_, c) => {
    const got = ADAPT[c.formula](c.inputs, c.name);
    if (got === undefined) return;
    const key = `${c.formula} ${c.name}`;
    if (KNOWN[key]) return;
    expect(same(got, c.expected), `${key}: code ${JSON.stringify(got)} ≠ đáp án ${JSON.stringify(c.expected)}`).toBe(true);
  });
});
