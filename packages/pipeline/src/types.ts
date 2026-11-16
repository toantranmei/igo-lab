import type { BlockDetail, BlockId, BlockTrace, DraftItem, GateResult, GateStatus, TraceEvent, TraceKind, TraceSource } from '@cl/contract';
import type { AgentConfig, TaskContext } from '@cl/agents';
import type { Dictionary } from '@cl/registry';

export interface Policy {
  id: string;
  version: number;
  min_valid_jd: number;
  allow_jd_only: boolean;
  require_human_review: boolean;
  retranslation: boolean;
  verify_real_events: boolean;
  propose_hypotheses: boolean;
  fast_branch: boolean;
  publish_scope: string;
  min_coverage: number;
  min_item_agreement: number;
  stop_on: string[];
  /** These thresholds are engineering defaults, not business-approved values. */
  thresholds_status: string;
}
export const DEFAULT_POLICY: Policy = {
  id: 'jd-only-draft',
  version: 1,
  min_valid_jd: 1,
  allow_jd_only: true,
  require_human_review: false,
  retranslation: true,
  verify_real_events: true,
  propose_hypotheses: true,
  fast_branch: true,
  publish_scope: 'internal_draft',
  min_coverage: 0.8,
  min_item_agreement: 2 / 3,
  stop_on: ['CRITICAL'],
  thresholds_status: 'chưa duyệt nghiệp vụ',
};
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
}
export interface SnapEvent {
  id: string;
  label: string;
  situation: string;
  action: string;
  outcome: string;
  source_ref: string;
}
export interface RunSnapshot {
  schema: 1;
  session: { id: string; name: string; role_title: string; role_id: string; purpose: string; context: string; family: string | null; industry: string | null };
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
  trace: BlockTrace;
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

const RULE_VERSION = 'live-rules-1';
export function gate(block: BlockId, n: number, name: string, status: GateStatus, actual: unknown, criterion: string, opts: { required?: boolean; reason?: string; refs?: string[] } = {}): GateResult {
  return { gate_id: `${block}.G${n}`, name, status, actual, criterion, input_refs: opts.refs ?? [], rule_version: RULE_VERSION, required: opts.required ?? true, ...(opts.reason ? { reason: opts.reason } : {}) };
}

/** Accumulates beats; `vars` and `draft` carry over from beat to beat so the viewer can diff them. */
export class TraceBuilder {
  events: TraceEvent[] = [];
  records: { key: string; label: string; data: unknown }[] = [];
  private vars: Record<string, unknown> = {};
  private draft: DraftItem[] = [];
  constructor(private block: BlockId, private attemptId: string, private now: string) {}

  record(key: string, label: string, data: unknown) {
    if (!this.records.some((r) => r.key === key)) this.records.push({ key, label, data });
  }
  beat(
    kind: TraceKind,
    title: string,
    o: { explanation?: string; refs?: string[]; formula?: string; substitution?: string; denominator?: { value: number; note: string }; set?: Record<string, unknown>; draft?: DraftItem[]; remove?: string[]; delta?: string; source?: TraceSource; gate?: GateResult } = {},
  ) {
    const before = { ...this.vars };
    Object.assign(this.vars, o.set ?? {});
    if (o.remove) this.draft = this.draft.filter((d) => !o.remove!.includes(d.id));
    for (const d of o.draft ?? []) {
      const i = this.draft.findIndex((x) => x.id === d.id);
      if (i >= 0) this.draft[i] = d;
      else this.draft.push(d);
    }
    this.events.push({
      seq: this.events.length,
      block: this.block,
      attempt_id: this.attemptId,
      kind,
      title,
      explanation: o.explanation,
      record_refs: o.refs ?? [],
      formula: o.formula,
      substitution: o.substitution,
      denominator: o.denominator,
      before,
      after: { ...this.vars },
      draft: this.draft.map((d) => ({ ...d })),
      delta: o.delta,
      source: o.source ?? 'CODE',
      gate: o.gate,
      computed_at: this.now,
    });
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
  build(gates: GateResult[], expected: unknown, inputKeys: string[] = []): BlockTrace {
    return { block: this.block, attempt_id: this.attemptId, records: this.records, input_keys: inputKeys.length ? inputKeys : this.records.map((r) => r.key), events: this.events, gates, expected, computed_at: this.now };
  }
}

export const pct = (x: number | null) => (x === null || Number.isNaN(x) ? 'Không tính được' : `${Math.round(x * 1000) / 10}%`);
export const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);
export const round4 = (x: number) => Math.round(x * 10000) / 10000;
