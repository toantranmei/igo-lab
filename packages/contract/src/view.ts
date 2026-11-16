/**
 * View models shared by the Example (browser engine) and Live (server) sources.
 * Every screen renders from these shapes only, so one UI serves both modes.
 */
import type { BlockId, BlockTrace, GateResult } from './core';

export type SessionMode = 'example' | 'live';

export type CardState = 'idle' | 'running' | 'awaiting_view' | 'pass' | 'blocked' | 'needs_input' | 'error' | 'stale';

export interface AgentBadge {
  /** 'CODE' when the block is computed by code only. */
  kind: 'CODE' | 'AI';
  tasks?: { task_id: string; model: string; effort: string }[];
}

export interface BlockCard {
  id: BlockId;
  name: string;
  agent: string;
  artifact: string;
  state: CardState;
  receipt: string;
  badge: AgentBadge;
}

export interface CalcEntry {
  label: string;
  formula: string;
  substitution: string;
  meaning: string;
}

export interface RecordRow {
  id: string;
  name: string;
  value: string;
  detail: string;
  bad?: boolean;
  /** Free-form structured payload shown in the record detail pane. */
  data?: unknown;
}

export type DetailState = 'actual_pass' | 'actual_blocked' | 'preview' | 'trial' | 'not_run' | 'running' | 'error';

export interface BlockDetail {
  id: BlockId;
  name: string;
  agent: string;
  method: string;
  state: DetailState;
  /** Set when an earlier block is blocking and this one has no valid output. */
  blockedAt?: BlockId;
  input: [string, string][];
  flow: string[];
  output: [string, string][];
  rows: RecordRow[];
  calc: CalcEntry[];
  gates: GateResult[];
  notes: string[];
  handoff: string;
  handoffTarget: string;
  /** Extra visual payloads for specific blocks (B3 strip, B5 matrix, B7 chain, B8 diff). */
  visual?: BlockVisual;
  raw: unknown;
  error?: { code: string; message: string; attempt_id?: string };
  computed_at?: string;
}

export type BlockVisual =
  | { kind: 'b3'; jdCount: number; candidates: { id: string; name: string; alias?: boolean; evidence: string[] }[]; unique: number }
  | {
      kind: 'b5';
      tasks: { id: string; name: string; weight: number }[];
      competencies: { id: string; name: string }[];
      /** links[taskId] = competency ids covering it */
      links: Record<string, string[]>;
    }
  | { kind: 'b7'; gates: { id: string; pass: boolean }[]; coverageOk: boolean }
  | { kind: 'b8'; changes: ChangeItem[] };

export interface ChangeItem {
  entity: string;
  id: string;
  name?: string;
  action: 'ADD' | 'UPDATE' | 'REUSE' | 'NEEDS_REVIEW';
  before: string | null;
  after: string | null;
  reason?: string;
  affected?: string[];
}

export interface LogEntry {
  seq: number;
  run: number;
  step: string;
  type: string;
  time: string;
  summary: string;
  payload?: unknown;
}

export interface InputDoc {
  id: string;
  title: string;
  origin?: string;
  industry?: string;
  role?: string;
  source: string;
  sourceOk: boolean;
  synthetic: boolean;
  version?: number;
  text: string;
  /** Segments/passages used downstream, with the concept or task they support. */
  usedPassages: { label: string; text: string }[];
  meta: [string, string][];
  evidenceClass: string;
}

export interface InputTask {
  id: string;
  name: string;
  weight: number | null;
  refs: string[];
}

export interface InputEvent {
  id: string;
  label: string;
  type: string;
  evidenceClass: 'REAL' | 'SEED' | 'HYPOTHESIS';
  source: string;
  situation?: string;
  action?: string;
  outcome?: string;
  ratings?: number[];
  ratingBasis?: string;
}

/** Simplified dictionary view. Example produces it directly; Live maps the registry into it. */
export interface DictCompetency {
  id: string;
  name: string;
  concept?: string;
  group?: string;
  definition?: string;
  version: number;
  indicators: string[];
  aliases?: string[];
  status?: string;
}
export interface DictFrameCompetency {
  id: string;
  name: string;
  level: number | null;
  indicator: string | null;
  evidence: string[];
  weight?: number | null;
  version?: number;
}
export interface DictFrame {
  id: string;
  version: string;
  role: string;
  purpose: string;
  evidence: string;
  competencies: DictFrameCompetency[];
  trial?: boolean;
}
export interface DictView {
  version: string;
  W: { id: string; role: string; tasks: { id: string; name: string; concept?: string; weight: number | null; competencies?: string[] }[] }[];
  C: DictCompetency[];
  R: DictFrame[];
  V: Record<string, unknown>[];
  G: { version: string; run: number; changes: ChangeItem[]; policy: string; decided_by?: string; receipt?: string }[];
}

export interface ReleaseHistoryEntry {
  run: number;
  fromVersion: string;
  toVersion: string;
  changes: ChangeItem[];
  /** Dictionary as it stood right after this release. */
  after: DictView;
  receipt?: { release_id: string; hash: string; decided_by: string; decided_at: string };
}

export interface Finding {
  id: string;
  severity: string;
  type: string;
  text: string;
  expected?: string;
  observed?: string;
  evidence: string[];
  lesson?: string;
}
export interface Lesson {
  id: string;
  text: string;
  status: 'PENDING' | 'SAFE' | 'APPLIED' | 'REJECTED';
  owner: string;
  control?: string;
  test?: string;
  testResult?: Record<string, boolean>;
}
export interface AuditView {
  scope: string;
  findings: Finding[];
  limitations: string[];
  checks: string[];
  conclusions?: string[];
}

export interface PendingGuide {
  id: BlockId;
  cursor: number;
  committed: boolean;
}

export interface SessionState {
  mode: SessionMode;
  sessionId: string;
  sessionName: string;
  roleTitle: string;
  runNo: number;
  runLabel: string;
  inputSummary: string;
  dictionaryVersionLabel: string;
  /** Blocks finished out of 9. */
  position: number;
  completed: boolean;
  halted: boolean;
  haltReasons: string[];
  statusText: string;
  cards: BlockCard[];
  fast: { available: boolean; done: boolean; summary: string };
  pending: PendingGuide | null;
  logs: LogEntry[];
  inputs: { label: string; jds: InputDoc[]; tasks: InputTask[]; events: InputEvent[] };
  dictionary: DictView;
  startDictionaryVersion: string;
  history: ReleaseHistoryEntry[];
  audit: AuditView | null;
  lessons: Lesson[];
  /** Example-only simulated faults. */
  fault?: { value: string; options: [string, string][]; locked: boolean };
  canStartNextRun: boolean;
  nextRunHint: string;
  trial: DictFrame | null;
  aiReady?: { ok: boolean; message: string };
  /** Live only: auto-run switch of the current run and the block it is on. */
  auto?: { on: boolean; note: string; running: BlockId | null };
}

export interface SessionListItem {
  id: string;
  mode: SessionMode;
  name: string;
  roleTitle: string;
  runs: { runNo: number; status: string; baseRelease: string; createdAt: string }[];
  updatedAt: string;
}

export interface SessionSource {
  readonly mode: SessionMode;
  getState(): Promise<SessionState>;
  getDetail(id: BlockId): Promise<BlockDetail>;
  /** preview=true never changes data and never calls a model. */
  getTrace(id: BlockId, preview: boolean): Promise<BlockTrace | null>;
  /** Start the next block (or FAST). Returns the pending guide. */
  begin(id: BlockId): Promise<PendingGuide>;
  /** Persist the viewing cursor. Reaching the last beat lets the source commit the block. */
  progress(id: BlockId, cursor: number, atEnd: boolean): Promise<void>;
  acknowledge(id: BlockId): Promise<void>;
  reset(): Promise<void>;
  setFault?(value: string): Promise<void>;
  recover?(reason: string): Promise<void>;
  approveLessons?(reason: string): Promise<void>;
  startNextRun?(): Promise<void>;
  subscribe(listener: () => void): () => void;
}
