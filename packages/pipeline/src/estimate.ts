import { MAIN_BLOCK_IDS, type BlockId } from '@cl/contract';
import { DEFAULT_AGENT_CONFIG, TASKS, priceOf, type AgentConfig, type TaskName } from '@cl/agents';

/**
 * Pre-run estimate of agent calls and tokens per block, computed by code from what is known.
 *
 * Coefficients come from the 16/11/2026 Project Manager run (175 JD, 131 valid; spec appendix A), measured on
 * `agent_call.usage` as input + cache_creation + cache_read tokens per successful call, and output tokens.
 * Every call also carries the CLI's own frame (≈ 1 200 tokens), already included in these averages.
 */
export const CLI_FRAME_TOKENS = 1200;
/** Characters per token of our prompts (Vietnamese JSON), measured on T3/T5/T8: 1.64–1.84. The low end over-estimates, on purpose. */
export const CHARS_PER_TOKEN = 1.6;

/*
 * P1 design (spec §5.2a): calls are batches of at most BATCH_CHARS characters of user input, so the number of calls
 * follows from the size of the data. Sizes per item are from the 16/11 run (prepared JD ≈ 1 600 characters after
 * the K7/K8 cuts; task ≈ 80; candidate ≈ 160; competency in a list ≈ 165) and are replaced by measurements of the P1
 * acceptance run. System prompts are ≈ 1 500 characters.
 */
const SIZE = { jd: 1600, task: 80, cand: 200, comp: 165, ind: 120, compBrief: 600, auditItem: 900, system: 1500 };
/**
 * Output tokens per item. jd/cluster/row/score from the 16/11 run; compInd, vote and audit measured on the first P1
 * run (19/11/2026, 4 valid JD, 11 core, 60 indicators): E6 ≈ 890 per competency, E7 ≈ 140 per indicator vote,
 * E8 ≈ 1 800 per call.
 */
const OUT = { jd: 900, cluster: 25, row: 40, compInd: 890, vote: 140, audit: 1800, score: 20 };
/** Shape of the data per valid JD: 856 merged tasks, 566 competency groups for 131 valid JDs. */
const PER_JD = { valid: 0.75, rawTasks: 9.5, tasks: 6.5, candidates: 8, groups: 4.3 };
const BATCH = 7000;
const callsFor = (items: number, size: number, maxItems = Infinity) => (items <= 0 ? 0 : Math.max(Math.ceil((items * size) / BATCH), Math.ceil(items / maxItems)));
const inTokens = (chars: number) => CLI_FRAME_TOKENS + Math.ceil((chars + SIZE.system) / CHARS_PER_TOKEN);

export interface EstimateBasis {
  jds: number;
  events?: number;
  rubric?: number;
  seats?: number;
  /** Known after the block ran (more precise than the per-JD averages). */
  valid?: number;
  rawTasks?: number;
  tasks?: number;
  candidates?: number;
  groups?: number;
  selected?: number;
  baseCompetencies?: number;
}
export interface TaskEstimate {
  task: TaskName;
  task_id: string;
  calls: number;
  tokens_per_call: number;
  /** Split of tokens_per_call: input (frame + system + data) and output. */
  input_per_call: number;
  output_per_call: number;
  tokens: number;
  /** API-equivalent cost of all calls of this task, from the model the run's configuration gives it. */
  usd: number;
}
export interface BlockEstimate {
  block: BlockId;
  calls: number;
  tokens: number;
  usd: number;
  tasks: TaskEstimate[];
}
export interface RunEstimate {
  basis: Required<Omit<EstimateBasis, 'baseCompetencies'>> & { baseCompetencies: number };
  blocks: BlockEstimate[];
  calls: number;
  tokens: number;
  /** API-equivalent USD (Claude CLI subscription: a measure of quota). */
  usd: number;
  note: string;
}

/** Pre-P1 T8 sent the whole competency list with every task. Kept to explain the 16/11 numbers. */
export const t8InputTokens = (groups: number) => CLI_FRAME_TOKENS + Math.ceil((groups * SIZE.comp + 800) / CHARS_PER_TOKEN);

export function estimateRun(b: EstimateBasis, config: AgentConfig = DEFAULT_AGENT_CONFIG): RunEstimate {
  const jds = Math.max(0, b.jds);
  const valid = b.valid ?? Math.ceil(jds * PER_JD.valid);
  const rawTasks = b.rawTasks ?? Math.ceil(valid * PER_JD.rawTasks);
  const tasks = b.tasks ?? Math.ceil(valid * PER_JD.tasks);
  const candidates = b.candidates ?? Math.ceil(valid * PER_JD.candidates);
  const groups = b.groups ?? Math.ceil(valid * PER_JD.groups);
  // K6 keeps groups named by ≥ 2 JDs on large sets; the core is 8–14
  // share of groups named by ≥ max(2, 3% of valid) JDs, from the 16/11 distribution: ≥2 → 35%, ≥4 → 12%
  const minJds = Math.max(2, Math.ceil(valid * 0.03));
  const kept = valid >= 10 ? Math.min(groups, Math.max(8, Math.ceil(groups * (minJds <= 2 ? 0.35 : minJds <= 3 ? 0.2 : 0.12)))) : groups;
  const selected = b.selected ?? Math.min(kept, 14);
  const events = b.events ?? 0;
  const rubric = b.rubric ?? 0;
  const seats = b.seats ?? 3;
  const baseCompetencies = b.baseCompetencies ?? 0;
  const t = (task: TaskName, calls: number, inChars: number, outTokens: number): TaskEstimate => {
    const input = calls ? inTokens(inChars) : 0, output = calls ? outTokens : 0;
    const model = task === 'E7' || task === 'E10' ? config.seats[0]?.model ?? config.tasks[task].model : config.tasks[task].model;
    const [pi, po] = priceOf(model);
    const usd = Math.round(((calls * (input * pi + output * po)) / 1e6) * 10000) / 10000;
    return { task, task_id: TASKS[task].id, calls, tokens_per_call: input + output, input_per_call: input, output_per_call: output, tokens: calls * (input + output), usd };
  };
  const e1 = callsFor(jds, SIZE.jd, 20);
  const e23 = rawTasks > 1 ? callsFor(rawTasks, SIZE.task) : 0;
  // each E4 call also carries the ≤ 20 O*NET tasks of the anchored occupation (≈ 2 600 characters)
  const e4 = candidates > 1 || baseCompetencies ? Math.max(1, Math.ceil((candidates * SIZE.cand) / (BATCH - 2600))) : 0;
  // two E4M passes over every cluster (merge to the grain of a framework competency; the second on the first's result)
  const e4merge = Math.max(1, Math.ceil((groups * 230) / 34000));
  // E5 runs after the seats chose the core, so its list is the ≤ 14 core competencies (one part)
  const listParts = Math.max(1, Math.ceil((selected * SIZE.comp) / 4500));
  const e5 = selected ? Math.ceil(tasks / 25) * listParts : 0;
  const e6 = callsFor(selected, SIZE.compBrief);
  // the main E8 call also carries the gate results, stats and re-check sample (≈ 4 000 characters)
  const auditChars = selected * SIZE.auditItem + 4000;
  const e8 = Math.max(1, Math.ceil(auditChars / (BATCH - 1500)));
  const per: Record<BlockId, TaskEstimate[]> = {
    B0: [],
    B1: [t('E1', e1, Math.min(BATCH, jds * SIZE.jd), Math.ceil((jds / Math.max(1, e1)) * OUT.jd))],
    // the occupation list rides on the first E23 call; spread over the calls so the total is right
    B2: [t('E23', e23, Math.min(BATCH, rawTasks * SIZE.task) + (e23 ? Math.ceil(23000 / e23) : 0), 300)],
    B3: [t('E4', e4, Math.min(BATCH - 2600, Math.ceil((candidates * SIZE.cand) / Math.max(1, e4))) + 2600, Math.ceil((candidates / Math.max(1, e4)) * OUT.cluster)), t('E4M', e4merge * 2, Math.ceil((groups * 230) / e4merge), Math.ceil((groups * 8) / e4merge)), t('E9', candidates ? 1 : 0, Math.min(BATCH, Math.ceil(candidates * 0.2) * 160 + groups * SIZE.comp), Math.ceil(candidates * 0.2) * 10)],
    B4: [t('T7', events, 2000, 300)],
    B5: [t('E5', e5, Math.min(4500, selected * SIZE.comp) + 25 * 120, 25 * OUT.row), t('E10', seats * Math.max(1, Math.ceil((kept * 500) / BATCH)), Math.min(BATCH, kept * 500), kept * OUT.score)],
    // E6: the rewrite round adds calls but only rewrites failed indicators (≈ 10% of the output, P1 run)
    B6: [t('E6', Math.ceil(e6 * 1.3), Math.min(BATCH, selected * SIZE.compBrief), Math.ceil((selected * OUT.compInd * 1.1) / Math.ceil(e6 * 1.3))), t('E7', seats * 2, selected * 3 * SIZE.ind + selected * SIZE.comp, Math.ceil((selected * 4 * OUT.vote) / 2))],
    B7: [t('E8', e8, Math.min(BATCH, Math.ceil(auditChars / e8)), OUT.audit)],
    B8: [],
    FAST: [],
  };
  const blocks = MAIN_BLOCK_IDS.map((block): BlockEstimate => {
    const ts = per[block].filter((x) => x.calls > 0);
    return { block, calls: ts.reduce((a, x) => a + x.calls, 0), tokens: ts.reduce((a, x) => a + x.tokens, 0), usd: Math.round(ts.reduce((a, x) => a + x.usd, 0) * 10000) / 10000, tasks: ts };
  });
  return {
    basis: { jds, events, rubric, seats, valid, rawTasks, tasks, candidates, groups, selected, baseCompetencies },
    blocks,
    calls: blocks.reduce((a, x) => a + x.calls, 0),
    tokens: blocks.reduce((a, x) => a + x.tokens, 0),
    usd: Math.round(blocks.reduce((a, x) => a + x.usd, 0) * 10000) / 10000,
    note: 'Ước tính bằng code theo thiết kế P1 (gọi theo lô); cỡ dữ liệu lấy từ lượt 16/11. Kết quả đã lưu được dùng lại nên lượt chạy lại thường tốn ít hơn nhiều.',
  };
}

/** Basis from what earlier blocks of a run produced (for the estimate at the start of a later block). */
export function basisFromPrev(jds: number, prev: Partial<Record<BlockId, Record<string, any>>>, extra: Partial<EstimateBasis> = {}): EstimateBasis {
  const b1 = prev.B1, b2 = prev.B2, b3 = prev.B3, b5 = prev.B5;
  return {
    jds,
    ...extra,
    ...(b1?.jds ? { valid: (b1.jds as any[]).filter((j) => j.valid).length } : {}),
    ...(b2?.tasks ? { tasks: (b2.tasks as any[]).length } : {}),
    ...(b2?.raw_count != null ? { rawTasks: b2.raw_count } : {}),
    ...(b3?.groups ? { groups: (b3.groups as any[]).filter((g) => g.decision !== 'NEEDS_REVIEW').length } : {}),
    ...(b5?.selected ? { selected: (b5.selected as any[]).length } : {}),
  };
}

/* ------------------------------------------------------------------- budget and anomaly thresholds */

/** Budget = this × estimate (spec §12.1). */
export const BUDGET_FACTOR = 1.5;
/** A call whose input is estimated above this many tokens is an anomaly (spec P0.11). */
export const ANOMALY_INPUT_TOKENS = 8000;
/**
 * Batch tasks see up to 100 items in one call by design (T3, T5, T12, T15): measured 11–13 thousand tokens per
 * call on the 16/11 run, so 8 000 is normal-sized for them. Their limit is higher; T8 is not a batch task and
 * keeps the 8 000 limit. Both can be changed with AGENT_ANOMALY_INPUT_TOKENS(_BATCH), read at call time.
 */
export const ANOMALY_INPUT_TOKENS_BATCH = 24000;
/**
 * E23 carries the occupation list (≈ 23k characters) on its first call, and E7 sends every indicator of the framework
 * to a seat in one call by design (≤ 14 competencies × ≤ 12 indicators; P1 run: 60 indicators ≈ 5 200 real tokens,
 * ≈ 9 000 by the conservative estimate), so both get the batch limit too.
 */
/** E4M and E9 see every candidate cluster of the role in one call by design (35 real postings: 10–15 thousand tokens). */
export const BATCH_TASKS: TaskName[] = ['T3', 'T5', 'T12', 'T15', 'E23', 'E7', 'E4M', 'E9'];
export const inputLimitFor = (task: TaskName) => (BATCH_TASKS.includes(task) ? Number(process.env.AGENT_ANOMALY_INPUT_TOKENS_BATCH || ANOMALY_INPUT_TOKENS_BATCH) : Number(process.env.AGENT_ANOMALY_INPUT_TOKENS || ANOMALY_INPUT_TOKENS));
/** Estimated input tokens of one call from its prompt length. */
export const inputTokensFromChars = (chars: number) => CLI_FRAME_TOKENS + Math.ceil(chars / CHARS_PER_TOKEN);

export interface RunBudget {
  run_tokens: number;
  block_tokens: Partial<Record<BlockId, number>>;
  estimate_tokens: number;
  factor: number;
}
/** Minimum block budget: small blocks must not trip on a couple of retries. */
const MIN_BLOCK_BUDGET = 20000;
export function budgetFrom(e: RunEstimate): RunBudget {
  const block_tokens: Partial<Record<BlockId, number>> = {};
  for (const b of e.blocks) if (b.calls) block_tokens[b.block] = Math.max(MIN_BLOCK_BUDGET, Math.ceil(b.tokens * BUDGET_FACTOR));
  return { run_tokens: Math.max(MIN_BLOCK_BUDGET, Math.ceil(e.tokens * BUDGET_FACTOR)), block_tokens, estimate_tokens: e.tokens, factor: BUDGET_FACTOR };
}

/** Total tokens of one call from `agent_call.usage`. */
export function usageTokens(u: any): number {
  if (!u || typeof u !== 'object') return 0;
  return (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.output_tokens) || 0);
}
