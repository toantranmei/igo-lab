/**
 * White paper formulas (1)–(37) that the code computes (spec §6). Pure functions, no I/O; every block records the
 * inputs and outputs of each call in calc_record. Numbers in comments are the white paper's formula numbers.
 * (1), (37) hashes live in @cl/db; (4), (10) similarities in prep.ts / blocks-a; (16) in anchor.ts; (24), (25) in B5.
 */

export type Rank = 'P1' | 'P2' | 'P3';
export type Rigor = 'A' | 'B' | 'C';
export type Tier = 'INTERNAL' | 'MARKET' | 'HR_DECISION';

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const clamp03 = (x: number) => Math.max(0, Math.min(3, Math.round(x)));

/* --------------------------------------------------------------------------------------- B1 */

/** (5) Seniority lens L = 3A + 2C + D + E, max 21. */
export const lensL = (A: number, C: number, D: number, E: number) => 3 * clamp03(A) + 2 * clamp03(C) + clamp03(D) + clamp03(E);
/** (6) Field lens M = 3B + 2C + D + E, only when A ≥ 2. */
export const lensM = (A: number, B: number, C: number, D: number, E: number) => (clamp03(A) >= 2 ? 3 * clamp03(B) + 2 * clamp03(C) + clamp03(D) + clamp03(E) : null);
/** (7) Rank from max(L, M): P1 ≥ 18, P2 13–17, P3 ≤ 12. */
export function sourceRank(L: number, M: number | null): Rank {
  const x = Math.max(L, M ?? -1);
  return x >= 18 ? 'P1' : x >= 13 ? 'P2' : 'P3';
}
/** D · recency from the posting date (months before the run); unknown date counts 1. */
export function recencyD(postedAt: string | null | undefined, now: string): number {
  const months = ageMonths(postedAt, now);
  // no posting date: kept as evidence but with the lowest recency (decision of 19/11/2026)
  if (months === null) return 0;
  return months <= 6 ? 3 : months <= 12 ? 2 : months <= 24 ? 1 : 0;
}
/** SOP: only postings of the last 24 months are used; older ones are dropped before any AI call. */
export const MAX_JD_AGE_MONTHS = 24;
/**
 * Postings from a public Hugging Face dataset carry no date; they count as posted within the last 24 months
 * (decision of 20/11/2026), at the most cautious recency of that window: D = 1. Pasted text without a date keeps D = 0.
 */
export const DATASET_UNDATED_D = 1;
export const isDatasetSource = (kind: string, sourceRef: string) => kind === 'dataset' || /^(hf:|dataset:)/i.test(sourceRef) || /^https:\/\/huggingface\.co\/datasets\//i.test(sourceRef);
/** Months between the posting date and `now`, or null when the date is missing or unreadable. */
export function ageMonths(postedAt: string | null | undefined, now: string): number | null {
  if (!postedAt || Number.isNaN(Date.parse(postedAt))) return null;
  return (Date.parse(now) - Date.parse(postedAt)) / (30.44 * 24 * 3600 * 1000);
}
export const tooOld = (postedAt: string | null | undefined, now: string) => (ageMonths(postedAt, now) ?? 0) > MAX_JD_AGE_MONTHS;
/** E · reliability of the source from its kind: a traceable URL or a public dataset 2, a file 1, pasted text without source 0. */
export function reliabilityE(kind: string, sourceRef: string, sourceUrl: string | null | undefined): number {
  if (sourceUrl?.trim() || /^https?:\/\//i.test(sourceRef) || /^(hf:|dataset:)/i.test(sourceRef) || kind === 'dataset') return 2;
  if (kind === 'file' || sourceRef.trim()) return 1;
  return 0;
}
/** (8) G1: N ≥ minN ∧ N_P1 ≥ minP1. */
export const g1 = (n: number, nP1: number, minN: number, minP1: number) => n >= minN && nP1 >= minP1;

/* --------------------------------------------------------------------------------------- B2 */

/** (9) External importance 0–100 to the shared 1–5 scale: s = 1 + x/100 × 4. */
export const scale100to5 = (x: number) => r4(1 + (Math.max(0, Math.min(100, x)) / 100) * 4);

/* --------------------------------------------------------------------------------------- B3 */

/** (11) Task weight w = n / N. */
export const taskWeight = (n: number, N: number) => (N ? r4(n / N) : 0);
/** (12) Source weight ω by rank; an external standard occupation counts 3. */
export const OMEGA: Record<Rank | 'EXTERNAL', number> = { P1: 3, P2: 2, P3: 1, EXTERNAL: 3 };
/** (12) Evidence weight of a candidate = Σ ω over its supporting sentences. */
export const evidenceWeight = (ranks: (Rank | 'EXTERNAL')[]) => ranks.reduce((a, r) => a + OMEGA[r], 0);
/** (13) Market score S(c) = w(c) / max w. */
export const marketScore = (w: number, maxW: number) => (maxW ? r4(w / maxW) : 0);
/** (14) Library coverage = candidates coded into existing dictionary entries / all candidates. */
export const libraryCoverage = (reused: number, total: number) => (total ? r4(reused / total) : null);
/**
 * (15) Cohen's kappa of two codings of the same items: κ = (p_o − p_e) / (1 − p_e).
 * When p_e = 1 (both used one single code throughout) κ is 1 if they agree everywhere, else 0.
 */
export function cohenKappa(a: string[], b: string[]): { po: number; pe: number; kappa: number | null; n: number } {
  const n = Math.min(a.length, b.length);
  if (!n) return { po: 0, pe: 0, kappa: null, n };
  let agree = 0;
  const fa = new Map<string, number>(), fb = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    fa.set(a[i], (fa.get(a[i]) ?? 0) + 1);
    fb.set(b[i], (fb.get(b[i]) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [k, x] of fa) pe += (x / n) * ((fb.get(k) ?? 0) / n);
  const kappa = 1 - pe < 1e-12 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { po: r4(po), pe: r4(pe), kappa: r4(kappa), n };
}

/* --------------------------------------------------------------------------------------- B4 */

/** (17) Level A sample: ≥ 6 excellent, ≥ 3 average, ≥ 4 events each, κ ≥ 0.61. */
export const sampleA = (excellent: number, average: number, minEventsPerPerson: number, kappa: number | null) => excellent >= 6 && average >= 3 && minEventsPerPerson >= 4 && (kappa ?? 0) >= 0.61;
/** (18) Level B sample: ≥ 3 people and ≥ 6 events. */
export const sampleB = (people: number, events: number) => people >= 3 && events >= 6;
/** (19) Theme class from the share of people in each group showing it. */
export function themeClass(fExcellent: number, fAverage: number, delta = 0.3): 'DIFFERENTIATING' | 'THRESHOLD' | 'AVOID' | 'WEAK' {
  const d = fExcellent - fAverage;
  if (d >= delta) return 'DIFFERENTIATING';
  if (-d >= delta) return 'AVOID';
  if (fExcellent >= 0.5 && fAverage >= 0.5) return 'THRESHOLD';
  return 'WEAK';
}

/* --------------------------------------------------------------------------------------- B5 */

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
/** Sample variance s² (n − 1). */
export const variance = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
};
/**
 * (20) r_wg = max(0, 1 − s² / 2); 2 is the variance of a uniform answer on a 5-point scale. Agreement needs at least
 * two ratings: with one (the other seats blank) it is undefined, so null, and the keep rule (21) does not hold.
 */
export const rwg = (xs: number[]): number | null => (xs.length < 2 ? null : r4(Math.max(0, 1 - variance(xs) / 2)));
export interface KeepInput {
  importance: number[];
  discrimination: number[];
}
/** (21) Keep when mean importance ≥ 3.5, mean discrimination ≥ 3.0 and r_wg(importance) ≥ 0.70. */
export function keepRule(x: KeepInput, t = { importance: 3.5, discrimination: 3.0, rwg: 0.7 }) {
  const mi = mean(x.importance), md = mean(x.discrimination), a = rwg(x.importance);
  const reasons: string[] = [];
  if (!(mi >= t.importance)) reasons.push(`quan trọng ${r4(mi)} < ${t.importance}`);
  if (!(md >= t.discrimination)) reasons.push(`phân biệt ${r4(md)} < ${t.discrimination}`);
  if (a === null) reasons.push('r_wg không tính được: cần ít nhất 2 điểm chấm');
  else if (!(a >= t.rwg)) reasons.push(`r_wg ${a} < ${t.rwg}`);
  return { keep: !reasons.length, mean_importance: r4(mi), variance: r4(variance(x.importance)), mean_discrimination: r4(md), rwg: a, reasons };
}
/** (22) Level C desk rule: S(c) ≥ 0.60 or external importance s ≥ 3.5. */
export const keepRuleC = (S: number, s: number | null) => S >= 0.6 || (s ?? 0) >= 3.5;
/** (23) Core set: the kept candidates ordered by mean importance then S(c), at most `max`; meta at most `maxMeta`. */
export function coreSet<T extends { id: string; mean_importance: number; S: number; meta?: boolean }>(kept: T[], max = 14, maxMeta = 1) {
  const sorted = [...kept].sort((a, b) => b.mean_importance - a.mean_importance || b.S - a.S || a.id.localeCompare(b.id));
  const out: T[] = [];
  let metas = 0;
  for (const c of sorted) {
    if (out.length >= max) break;
    if (c.meta) {
      if (metas >= maxMeta) continue;
      metas++;
    }
    out.push(c);
  }
  return out;
}
/** (26) Level = median of the valid votes (≥ 2). With an even count the upper middle is taken (rounds up). */
export function medianLevel(votes: number[]): number | null {
  const v = votes.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : Math.ceil((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
}

/* --------------------------------------------------------------------------------------- B6 */

/** (27) Retranslation rate of one indicator: seats right on BOTH competency and level / all seats (blank votes count). */
export function retranslationRate(votes: { competency: string; level: string }[], expected: { competency: string; level: string }, seats = votes.length) {
  const right = votes.filter((v) => v.competency === expected.competency && v.level === expected.level).length;
  return { right, seats, p: seats ? r4(right / seats) : 0 };
}
/**
 * (28) Fleiss' kappa. `ratings[i]` lists the category each rater gave item i ('' = blank, ignored).
 * P_i = (Σ_j n_ij² − n) / (n(n − 1)); P̄ = mean P_i; P̄_e = Σ_j p_j²; κ = (P̄ − P̄_e) / (1 − P̄_e).
 */
export function fleissKappa(ratings: string[][]): { P: number; Pe: number; kappa: number | null; items: number } {
  const rows = ratings.map((r) => r.filter((x) => x !== '')).filter((r) => r.length >= 2);
  if (!rows.length) return { P: 0, Pe: 0, kappa: null, items: 0 };
  const totals = new Map<string, number>();
  let all = 0, sumP = 0;
  for (const r of rows) {
    const n = r.length;
    const c = new Map<string, number>();
    for (const x of r) c.set(x, (c.get(x) ?? 0) + 1);
    let sq = 0;
    for (const [k, v] of c) {
      sq += v * v;
      totals.set(k, (totals.get(k) ?? 0) + v);
    }
    all += n;
    sumP += (sq - n) / (n * (n - 1));
  }
  const P = sumP / rows.length;
  let Pe = 0;
  for (const v of totals.values()) Pe += (v / all) ** 2;
  const kappa = 1 - Pe < 1e-12 ? (P >= 1 - 1e-12 ? 1 : 0) : (P - Pe) / (1 - Pe);
  return { P: r4(P), Pe: r4(Pe), kappa: r4(kappa), items: rows.length };
}
/** (29) 2 ≤ indicators of each (competency, level) ≤ 4, levels 1, 3, 5. */
export const INDICATOR_LEVELS = ['1', '3', '5'] as const;
export const indicatorCountOk = (n: number) => n >= 2 && n <= 4;
/** (30) Every core competency linked to ≥ 1 key outcome and every outcome to ≥ 2 competencies. */
export function outcomeConstraint(links: Record<string, string[]>, competencies: string[], outcomes: string[]) {
  const unlinked = competencies.filter((c) => !(links[c] ?? []).length);
  const thin = outcomes.filter((o) => competencies.filter((c) => (links[c] ?? []).includes(o)).length < 2);
  return { ok: !unlinked.length && !thin.length && outcomes.length >= 3 && outcomes.length <= 5, unlinked, thin };
}

/* --------------------------------------------------------------------------------------- B7 */

/** (31) The auditor's model is none of the models that extracted, wrote or scored. */
export const auditIndependent = (auditor: string, makers: string[]) => !makers.includes(auditor);
/** (32) Re-check sample size n = ⌈0.1 · N⌉. */
export const auditSample = (N: number) => Math.ceil(0.1 * N);
/** (33) G7 ⇔ all 10 variables ∈ {PASS, PASS_COND with a plan}. */
export const AUDIT_VARIABLES = ['collection_method', 'content_type', 'content_build', 'granularity', 'goal_link', 'independent_review', 'prioritisation', 'reliability', 'keep_drop_criteria', 'documentation'] as const;
export const g7 = (vars: { variable: string; result: string; plan: string }[]) => AUDIT_VARIABLES.every((k) => vars.some((v) => v.variable === k && (v.result === 'PASS' || (v.result === 'PASS_COND' && v.plan.trim()))));

/* --------------------------------------------------------------------------------------- B8 */

/** (34)–(35) Release tier: the highest tier whose conditions all hold on data. */
export function releaseTier(x: { rigor: Rigor; g6Data: boolean; g7Data: boolean; deviationIn: string[]; g11: boolean; g12: boolean }): { tier: Tier; reasons: string[] } {
  const reasons: string[] = [];
  const devs = x.deviationIn.filter((g) => ['G1', 'G3', 'G4', 'G5', 'G6', 'G7'].includes(g));
  const market = (x.rigor === 'A' || x.rigor === 'B') && x.g6Data && x.g7Data && !devs.length;
  if (x.rigor === 'C') reasons.push('Mức C (chỉ dữ liệu bàn giấy) không lên tầng Sản phẩm thị trường.');
  if (!x.g6Data) reasons.push('G6 không đạt bằng dữ liệu.');
  if (!x.g7Data) reasons.push('G7 không đạt bằng dữ liệu.');
  if (devs.length) reasons.push(`Cổng qua bằng phiếu sai lệch: ${devs.join(', ')}.`);
  if (market && x.rigor === 'A' && x.g11 && x.g12) return { tier: 'HR_DECISION', reasons: [] };
  if (market) return { tier: 'MARKET', reasons: x.rigor === 'A' ? ['Chưa có G11, G12 nên chưa lên tầng Quyết định nhân sự.'] : [] };
  return { tier: 'INTERNAL', reasons };
}
/** (36) Review date: +12 months for technology, data and AI families, +24 months otherwise. */
export function reviewDate(releasedAt: string, techFamily: boolean): string {
  const d = new Date(releasedAt);
  const y = d.getUTCFullYear() + (techFamily ? 1 : 2), m = d.getUTCMonth();
  // 29/02 + 12 months is 28/02 of the next year, not 01/03: the day is clamped to the month's last day
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
}
export const TECH_FAMILY = /công nghệ|cntt|it\b|phần mềm|software|dữ liệu|data|\bai\b|trí tuệ nhân tạo|machine learning|kỹ thuật số|digital/i;

/** Seeded shuffle (mulberry32) so each seat's order is reproducible from the seed in calc_record (spec §6.1a S4). */
export function seededShuffle<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export const seedOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
