import type { BlockDetail, BlockId, BlockTrace, DraftItem, GateResult, GateStatus, TraceEvent, TraceKind, TraceSource } from '@cl/contract';
import type { AgentConfig, TaskContext } from '@cl/agents';
import type { Dictionary } from '@cl/registry';
import type { RunBudget } from './estimate';

export interface Policy {
  id: string;
  version: number;
  /** Rigor level of the SOP: A (BEI + survey), B (written events), C (desk: JD and dictionary only). */
  rigor: 'A' | 'B' | 'C';
  /** G1 (8): N ≥ min_valid_jd ∧ N_P1 ≥ min_p1. */
  min_valid_jd: number;
  min_p1: number;
  allow_jd_only: boolean;
  require_human_review: boolean;
  retranslation: boolean;
  verify_real_events: boolean;
  propose_hypotheses: boolean;
  fast_branch: boolean;
  publish_scope: string;
  /** (24) coverage warning threshold. */
  min_coverage: number;
  /** (27) retranslation rate per indicator. */
  min_item_agreement: number;
  /** (15) G3 and (28) G6 kappa thresholds; κ needs at least kappa_min_items coded items, otherwise the gate passes on a deviation ticket. */
  min_kappa: number;
  kappa_min_items: number;
  /** Share of coded sentences re-coded by E9 (≥ 20%). */
  recode_share: number;
  /**
   * At least this many sentences are re-coded (all of them when there are fewer). With ~29 sentences κ (15) moved by
   * about ±0.1 between two runs of the same 35 JDs (0.64 vs 0.49, 20/11/2026), around a 0.61 threshold.
   */
  recode_min_sample?: number;
  /** (21) keep rule and (23) core size. */
  keep: { importance: number; discrimination: number; rwg: number };
  core_min: number;
  core_max: number;
  /**
   * Core fill by task coverage (decision of 21/11/2026): when the kept core covers less than min_coverage or is
   * below core_min, candidates with mean importance ≥ this value are added, most uncovered task weight first.
   * Unset: no fill.
   */
  core_fill_min_importance?: number;
  max_meta: number;
  stop_on: string[];
  /** K6 long tail (spec Q5): a group must be named by at least this many JDs… */
  long_tail_min_jds: number;
  /** …but only when the run has at least this many valid JDs. */
  long_tail_min_set: number;
  /** On large sets the threshold grows with the set: at least this share of the valid JDs (16/11: 3% of 131 → 4 JDs). */
  long_tail_min_share: number;
  /** Charter fields G0 requires; missing ones FAIL (SOP policies) or pass on a deviation ticket (dev policy). */
  charter_required: string[];
  /** These thresholds are engineering defaults, not business-approved values. */
  thresholds_status: string;
}
const SOP_BASE = {
  min_valid_jd: 15,
  min_p1: 5,
  allow_jd_only: true,
  require_human_review: false,
  retranslation: true,
  verify_real_events: true,
  propose_hypotheses: false,
  fast_branch: true,
  publish_scope: 'internal_draft',
  min_coverage: 0.8,
  min_item_agreement: 0.7,
  min_kappa: 0.61,
  kappa_min_items: 10,
  recode_share: 0.2,
  recode_min_sample: 60,
  keep: { importance: 3.5, discrimination: 3.0, rwg: 0.7 },
  core_min: 8,
  core_max: 14,
  max_meta: 1,
  stop_on: ['CRITICAL', 'HIGH'],
  long_tail_min_jds: 2,
  long_tail_min_set: 10,
  long_tail_min_share: 0.03,
  charter_required: ['role_title', 'purpose', 'industry', 'level', 'framework_type', 'rigor'],
  thresholds_status: 'theo chuẩn SOP',
};
/** Versioned policy sets (spec §6.1 B0). The run snapshot locks one of them. */
export const POLICIES: Record<string, Policy> = {
  // v2 (decision of 20/11/2026): core of 6–14 at level C. On 35 real postings per role, Sonnet seats find about six
  // competencies important for the whole role (x̄ ≥ 3.5); levels A and B keep 8–14
  'sop-c': { id: 'sop-c', version: 3, rigor: 'C', ...SOP_BASE, core_min: 6, core_fill_min_importance: 3, thresholds_status: 'theo chuẩn SOP; mức C: tập lõi tối thiểu 6 (quyết định 20/11/2026), bổ sung lõi theo độ phủ khi x̄ quan trọng ≥ 3 (quyết định 21/11/2026)' },
  'sop-b': { id: 'sop-b', version: 1, rigor: 'B', ...SOP_BASE, allow_jd_only: false },
  'sop-a': { id: 'sop-a', version: 1, rigor: 'A', ...SOP_BASE, allow_jd_only: false },
  /** For development and demos with a handful of JDs: same formulas, relaxed counts; never above the Internal tier. */
  'dev-small': { id: 'dev-small', version: 1, rigor: 'C', ...SOP_BASE, min_valid_jd: 1, min_p1: 0, core_min: 1, stop_on: ['CRITICAL'], charter_required: ['role_title', 'purpose'], thresholds_status: 'chỉ để phát triển và thử nghiệm, không theo chuẩn SOP' },
};
export const DEFAULT_POLICY_ID = 'sop-c';
export const DEFAULT_POLICY: Policy = POLICIES[DEFAULT_POLICY_ID];
export const policyOf = (id: string | null | undefined): Policy => POLICIES[id ?? ''] ?? DEFAULT_POLICY;

export interface Charter {
  level?: string;
  framework_type?: 'ROOT' | 'DERIVED_LEVEL' | 'INDUSTRY_VARIANT';
  decision?: string;
  performance_criteria?: string;
  owner?: string;
  policy_id?: string;
  /** (30) three to five key outcomes of the role. */
  outcomes?: string[];
  /** P4.7 references of G11 (validation against performance) and G12 (fairness between groups); entered, not computed. */
  g11_ref?: string;
  g12_ref?: string;
  /** P5.2: a derived framework or industry variant names the session of its root framework. */
  root_session_id?: string;
  /** P5.4: false when the batch audit sample left this derived framework out. */
  audit_sampled?: boolean;
}
export const policyRef = (p: Policy) => `${p.id}@${p.version}`;

export interface SnapSegment {
  id: string;
  n: number;
  start: number;
  end: number;
  text: string;
}
export interface SnapDoc {
  ref: string;
  document_id: string;
  version: number;
  original_name: string;
  content_sha256: string;
  source_kind: string;
  source_ref: string;
  origin_group: string | null;
  check_status: string;
  language: string | null;
  usage_note: string | null;
  source_url: string | null;
  /** Posting date YYYY-MM-DD, null when unknown. */
  posted_at?: string | null;
}
export interface SnapEvent {
  id: string;
  label: string;
  situation: string;
  action: string;
  outcome: string;
  source_ref: string;
  /** P4: pseudonymous person code, group and kind; null on events without a person. */
  person_code?: string | null;
  person_group?: 'EXCELLENT' | 'AVERAGE' | null;
  kind?: 'BEI' | 'WRITTEN';
  retain_until?: string | null;
  redacted?: boolean;
}
export interface RunSnapshot {
  schema: 1;
  session: { id: string; name: string; role_title: string; role_id: string; purpose: string; context: string; family: string | null; industry: string | null; charter?: Charter };
  jd_set: { id: string; revision: number };
  documents: SnapDoc[];
  events: SnapEvent[];
  base_release_id: string | null;
  base_version_label: string;
  policy: Policy;
  agent_config: AgentConfig;
  cli_version: string | null;
  lessons_loaded: { id: string; fingerprint: string; text: string }[];
  rubric: { anchor_id: string; level: string; description: string }[];
  versions: { normalizer: string; segmenter: string; parser: string };
  /** Token budget of the run (1.5 × the pre-run estimate). Absent on runs created before P0. */
  budget?: RunBudget;
  /** P4.1 survey responses (pseudonymous), used before the AI seats in B5. */
  survey?: { respondent: string; label: string; importance: number | null; discrimination: number | null; level: number | null; retain_until?: string | null }[];
  /** P4.5 entry of the AI tool register the run used. */
  ai_tool?: { id: string; provider: string; channel: string; account_type: string; retention: string; no_training: boolean } | null;
}

export interface LoadedDoc extends SnapDoc {
  text: string;
  segments: SnapSegment[];
}

export interface BlockView {
  input: [string, string][];
  output: [string, string][];
  rows: BlockDetail['rows'];
  calc: BlockDetail['calc'];
  notes: string[];
  handoff: string;
  visual?: BlockDetail['visual'];
}
export interface BlockResult {
  status: 'DONE' | 'BLOCKED' | 'NEEDS_INPUT';
  output: Record<string, any>;
  view: BlockView;
  gates: GateResult[];
  trace: CompactTrace;
  /** Agent tasks really used by this attempt, for the card badge. */
  ai: { task_id: string; model: string; effort: string; calls: number; cached: number }[];
}

export interface BlockCtx {
  block: BlockId;
  attemptId: string;
  runId: string;
  workspaceId: string;
  snapshot: RunSnapshot;
  docs: LoadedDoc[];
  base: Dictionary;
  /** Outputs of earlier blocks (current, passed attempts). */
  prev: Partial<Record<BlockId, Record<string, any>>>;
  prevGates: Partial<Record<BlockId, GateResult[]>>;
  agent: TaskContext;
  now: string;
}

const RULE_VERSION = 'live-rules-2';
export function gate(block: BlockId, n: number, name: string, status: GateStatus, actual: unknown, criterion: string, opts: { required?: boolean; reason?: string; refs?: string[] } = {}): GateResult {
  return { gate_id: `${block}.G${n}`, name, status, actual, criterion, input_refs: opts.refs ?? [], rule_version: RULE_VERSION, required: opts.required ?? true, ...(opts.reason ? { reason: opts.reason } : {}) };
}
/** A gate that cannot be decided on data (e.g. no reference list, sample too small) passes on a deviation ticket (P2.1). */
export function deviationGate(block: BlockId, n: number, name: string, actual: unknown, criterion: string, reason: string, risk: string, opts: { required?: boolean; refs?: string[] } = {}): GateResult {
  return { ...gate(block, n, name, 'PASS', actual, criterion, { ...opts, reason }), deviation: { id: `DEV-${block}-G${n}`, reason, risk, status: 'OPEN' } };
}
/** SOP gate number (G0–G8) of a block, for the tier rule (34). */
export const sopGate = (block: BlockId) => (block === 'FAST' ? null : `G${block.slice(1)}`);

/**
 * One beat as stored: only what changed. `set` holds the variables this beat changed, `draft` the draft items
 * it added or replaced, `remove` the ids it dropped. The full before/after/draft of each beat is rebuilt on
 * read (expandTrace). Storing cumulative state per beat made B2 of 175 JD weigh 41 MB.
 */
export interface CompactBeat {
  seq: number;
  kind: TraceKind;
  title: string;
  explanation?: string;
  record_refs: string[];
  formula?: string;
  substitution?: string;
  denominator?: { value: number; note: string };
  set?: Record<string, unknown>;
  draft?: DraftItem[];
  remove?: string[];
  delta?: string;
  source: TraceSource;
  gate?: GateResult;
  at: string;
}
export interface CompactTrace {
  compact: 1;
  block: BlockId;
  attempt_id: string;
  records: { key: string; label: string; data: unknown }[];
  /** Omitted when equal to the record keys. */
  input_keys?: string[];
  /** Packed beats (see packBeats): no seq, time as ms after `computed_at`, fields equal to the previous beat's listed in `~`. */
  beats: Record<string, unknown>[];
  gates: GateResult[];
  expected: unknown;
  computed_at: string;
}
/** Fields a beat often shares with the one before it (same formula over a loop). */
const CARRY = ['formula', 'explanation', 'denominator', 'source', 'kind'] as const;
const same = (a: unknown, b: unknown) => a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
export function packBeats(beats: CompactBeat[], start: string): Record<string, unknown>[] {
  const t0 = Date.parse(start) || 0;
  let prev: CompactBeat | null = null;
  return beats.map((b) => {
    const { seq: _seq, at, ...rest } = b;
    const out: Record<string, unknown> = {};
    const carried: string[] = [];
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      if (k === 'record_refs' && Array.isArray(v) && !v.length) continue;
      if (prev && (CARRY as readonly string[]).includes(k) && same(v, (prev as any)[k])) carried.push(k);
      else out[k] = v;
    }
    // a carried field that is absent here must not be inherited: mark it explicitly
    for (const k of CARRY) if (prev && (prev as any)[k] !== undefined && (b as any)[k] === undefined) out[k] = null;
    if (carried.length) out['~'] = carried;
    out.t = Date.parse(at) - t0;
    prev = b;
    return out;
  });
}
export function unpackBeats(packed: Record<string, unknown>[], start: string): CompactBeat[] {
  const t0 = Date.parse(start) || 0;
  let prev: CompactBeat | null = null;
  return packed.map((p, seq) => {
    const { '~': carried, t: dt, ...rest } = p as any;
    const b: any = { seq, record_refs: [], source: 'CODE', ...rest, at: new Date(t0 + (Number(dt) || 0)).toISOString() };
    for (const k of (carried as string[] | undefined) ?? []) b[k] = (prev as any)?.[k];
    for (const k of CARRY) if (b[k] === null) delete b[k];
    if (!b.source) b.source = 'CODE';
    prev = b;
    return b as CompactBeat;
  });
}
/** One calculation the code made (spec §3.2). */
export interface CalcInput {
  substep: string;
  item_ref?: string | null;
  formula: string;
  inputs: Record<string, unknown>;
  output?: unknown;
  decision?: string | null;
  seat?: string | null;
}
export interface CalcRow extends CalcInput {
  seq: number;
  step: BlockId;
}
/** Where a running attempt's beats and calculations go while it runs (registered by the runtime, per attempt). */
export interface TraceSink {
  beats(rows: CompactBeat[]): Promise<void>;
  calcs(rows: CalcRow[]): Promise<void>;
}
const SINKS = new Map<string, TraceSink>();
export const registerTraceSink = (attemptId: string, sink: TraceSink) => {
  SINKS.set(attemptId, sink);
  return () => void SINKS.delete(attemptId);
};
const FLUSH_MS = 1000;

/** Accumulates beats; `vars` and `draft` carry over from beat to beat so the viewer can diff them. */
export class TraceBuilder {
  beats: CompactBeat[] = [];
  calcs: CalcRow[] = [];
  records: { key: string; label: string; data: unknown }[] = [];
  private recordKeys = new Set<string>();
  private sink: TraceSink | undefined;
  private flushedBeats = 0;
  private flushedCalcs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> = Promise.resolve();
  constructor(
    private block: BlockId,
    private attemptId: string,
    private now: string,
  ) {
    this.sink = SINKS.get(attemptId);
  }

  record(key: string, label: string, data: unknown) {
    if (this.recordKeys.has(key)) return;
    this.recordKeys.add(key);
    this.records.push({ key, label, data });
  }
  beat(
    kind: TraceKind,
    title: string,
    o: { explanation?: string; refs?: string[]; formula?: string; substitution?: string; denominator?: { value: number; note: string }; set?: Record<string, unknown>; draft?: DraftItem[]; remove?: string[]; delta?: string; source?: TraceSource; gate?: GateResult; calc?: CalcInput | CalcInput[] } = {},
  ) {
    this.beats.push({
      seq: this.beats.length,
      kind,
      title,
      explanation: o.explanation,
      record_refs: o.refs ?? [],
      formula: o.formula,
      substitution: o.substitution,
      denominator: o.denominator,
      ...(o.set && Object.keys(o.set).length ? { set: { ...o.set } } : {}),
      ...(o.draft?.length ? { draft: o.draft.map((d) => ({ ...d })) } : {}),
      ...(o.remove?.length ? { remove: [...o.remove] } : {}),
      delta: o.delta,
      source: o.source ?? 'CODE',
      gate: o.gate,
      at: new Date().toISOString(),
    });
    for (const c of o.calc ? (Array.isArray(o.calc) ? o.calc : [o.calc]) : []) this.calc(c);
    this.schedule();
  }
  /** Records one calculation (formula, inputs, result) for the "Bước con" tab. */
  calc(c: CalcInput) {
    this.calcs.push({ ...c, seq: this.calcs.length, step: this.block });
    this.schedule();
  }
  private schedule() {
    if (!this.sink || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_MS);
  }
  /** Writes what was not written yet. Called on a timer while the block runs and once at the end. */
  flush(): Promise<void> {
    if (!this.sink) return Promise.resolve();
    const sink = this.sink;
    const beats = this.beats.slice(this.flushedBeats);
    const calcs = this.calcs.slice(this.flushedCalcs);
    this.flushedBeats = this.beats.length;
    this.flushedCalcs = this.calcs.length;
    this.pending = this.pending.then(async () => {
      if (beats.length) await sink.beats(beats).catch(() => {});
      if (calcs.length) await sink.calcs(calcs).catch(() => {});
    });
    return this.pending;
  }
  gates(gates: GateResult[]) {
    for (const g of gates)
      this.beat('GATE', `Nghiệm thu · ${g.name}`, {
        explanation: g.status === 'NOT_APPLICABLE' || g.status === 'NOT_EVALUATED' ? g.reason : undefined,
        formula: `${g.name}: ${g.criterion}`,
        substitution: `Thực tế = ${typeof g.actual === 'string' ? g.actual : JSON.stringify(g.actual)} → ${g.status}`,
        gate: g,
      });
  }
  build(gates: GateResult[], expected: unknown, inputKeys: string[] = []): CompactTrace {
    if (this.timer) clearTimeout(this.timer), (this.timer = null);
    void this.flush();
    return { compact: 1, block: this.block, attempt_id: this.attemptId, records: this.records, ...(inputKeys.length ? { input_keys: inputKeys } : {}), beats: packBeats(this.beats, this.now), gates, expected, computed_at: this.now };
  }
  /** Resolves when everything written so far reached the sink. */
  settled() {
    return this.flush();
  }
}

/** Rebuilds the full per-beat before/after/draft view (the guide's format) from compact beats. */
export function expandBeats(block: BlockId, attemptId: string, beats: CompactBeat[], computedAt: string): TraceEvent[] {
  let vars: Record<string, unknown> = {};
  let draft: DraftItem[] = [];
  return beats.map((b) => {
    const before = vars;
    vars = { ...vars, ...(b.set ?? {}) };
    if (b.remove) draft = draft.filter((d) => !b.remove!.includes(d.id));
    if (b.draft) {
      draft = [...draft];
      for (const d of b.draft) {
        const i = draft.findIndex((x) => x.id === d.id);
        if (i >= 0) draft[i] = d;
        else draft.push(d);
      }
    }
    return { seq: b.seq, block, attempt_id: attemptId, kind: b.kind, title: b.title, explanation: b.explanation, record_refs: b.record_refs, formula: b.formula, substitution: b.substitution, denominator: b.denominator, before, after: vars, draft, delta: b.delta, source: b.source, gate: b.gate, computed_at: computedAt };
  });
}
/** Old (full) and new (compact) stored traces both come out in the full format. */
export function expandTrace(stored: unknown): BlockTrace | null {
  if (!stored) return null;
  const s = stored as CompactTrace | BlockTrace;
  if (!('compact' in s)) return s as BlockTrace;
  return { block: s.block, attempt_id: s.attempt_id, records: s.records, input_keys: s.input_keys ?? s.records.map((r) => r.key), events: expandBeats(s.block, s.attempt_id, unpackBeats(s.beats, s.computed_at), s.computed_at), gates: s.gates, expected: s.expected, computed_at: s.computed_at };
}

export const pct = (x: number | null) => (x === null || Number.isNaN(x) ? 'Không tính được' : `${Math.round(x * 1000) / 10}%`);
export const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);
export const round4 = (x: number) => Math.round(x * 10000) / 10000;
