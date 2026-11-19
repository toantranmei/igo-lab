import { z } from 'zod';

export const MAIN_BLOCK_IDS = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'] as const;
export type MainBlockId = (typeof MAIN_BLOCK_IDS)[number];
export const BLOCK_IDS = [...MAIN_BLOCK_IDS, 'FAST'] as const;
export type BlockId = (typeof BLOCK_IDS)[number];
export const BlockIdSchema = z.enum(BLOCK_IDS);

export const GateStatusSchema = z.enum(['PASS', 'FAIL', 'NOT_EVALUATED', 'NOT_APPLICABLE']);
export type GateStatus = z.infer<typeof GateStatusSchema>;

export const GateResultSchema = z.object({
  gate_id: z.string(),
  name: z.string(),
  status: GateStatusSchema,
  actual: z.unknown(),
  criterion: z.string(),
  input_refs: z.array(z.string()),
  rule_version: z.string(),
  reason: z.string().optional(),
  required: z.boolean(),
  /** P2.1–P2.2: a PASS with a deviation ticket is "đạt bằng phiếu sai lệch", not "đạt bằng dữ liệu". */
  deviation: z.object({ id: z.string(), reason: z.string(), risk: z.string(), status: z.enum(['OPEN', 'CLOSED']) }).optional(),
});
export type GateResult = z.infer<typeof GateResultSchema>;

/** A gate blocks hand-off when it is required and neither PASS nor a justified NOT_APPLICABLE. */
export function gateBlocks(g: GateResult): boolean {
  if (!g.required) return false;
  if (g.status === 'PASS') return false;
  if (g.status === 'NOT_APPLICABLE') return !g.reason;
  return true;
}

export const TraceKindSchema = z.enum(['RECEIVE', 'READ', 'GATE', 'HANDOFF']);
export type TraceKind = z.infer<typeof TraceKindSchema>;
export const TRACE_KIND_LABEL: Record<TraceKind, string> = {
  RECEIVE: 'Nhận dữ liệu',
  READ: 'Từng phép tính',
  GATE: 'Nghiệm thu',
  HANDOFF: 'Bàn giao',
};

export const TraceSourceSchema = z.union([
  z.literal('CODE'),
  z.object({
    task_id: z.string(),
    agent_call_ids: z.array(z.string()).optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
  }),
]);
export type TraceSource = z.infer<typeof TraceSourceSchema>;

export const DraftItemSchema = z.object({ id: z.string(), value: z.string() });
export type DraftItem = z.infer<typeof DraftItemSchema>;

export const TraceEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  block: BlockIdSchema,
  attempt_id: z.string(),
  kind: TraceKindSchema,
  title: z.string(),
  explanation: z.string().optional(),
  /** IDs of the input records this beat reads. */
  record_refs: z.array(z.string()),
  formula: z.string().optional(),
  substitution: z.string().optional(),
  denominator: z.object({ value: z.number(), note: z.string() }).optional(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  /** Draft output as it stands after this beat; the viewer diffs it against the previous beat. */
  draft: z.array(DraftItemSchema),
  delta: z.string().optional(),
  source: TraceSourceSchema,
  gate: GateResultSchema.optional(),
  computed_at: z.string(),
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export const TraceRecordSchema = z.object({ key: z.string(), label: z.string(), data: z.unknown() });
export type TraceRecord = z.infer<typeof TraceRecordSchema>;

export const BlockTraceSchema = z.object({
  block: BlockIdSchema,
  attempt_id: z.string(),
  records: z.array(TraceRecordSchema),
  input_keys: z.array(z.string()),
  events: z.array(TraceEventSchema),
  gates: z.array(GateResultSchema),
  expected: z.unknown(),
  computed_at: z.string(),
});
export type BlockTrace = z.infer<typeof BlockTraceSchema>;

export const BlockStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'AWAITING_VIEW',
  'NEEDS_INPUT',
  'BLOCKED',
  'PASSED',
  'FAILED',
  'STALE',
]);
export type BlockStatus = z.infer<typeof BlockStatusSchema>;
export const BLOCK_STATUS_LABEL: Record<BlockStatus, string> = {
  PENDING: 'Đang chờ',
  RUNNING: 'Đang tính',
  AWAITING_VIEW: 'Chờ xem',
  NEEDS_INPUT: 'Cần bổ sung',
  BLOCKED: 'Chặn',
  PASSED: 'Đạt',
  FAILED: 'Lỗi',
  STALE: 'Cần chạy lại',
};

/** What changed between two consecutive draft lists (viewer + tests share this). */
export type DraftChange = { op: 'ADD' | 'CHANGE' | 'KEEP'; id: string; value: string; before?: string };
export function diffDraft(prev: DraftItem[], next: DraftItem[]): DraftChange[] {
  const old = new Map(prev.map((d) => [d.id, d.value]));
  return next.map((d) => {
    if (!old.has(d.id)) return { op: 'ADD', id: d.id, value: d.value };
    const before = old.get(d.id)!;
    return before === d.value
      ? { op: 'KEEP', id: d.id, value: d.value }
      : { op: 'CHANGE', id: d.id, value: d.value, before };
  });
}

/** Stable JSON: sorted keys, no whitespace. Used for hashing and cache keys everywhere. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => o[k] !== undefined)
          .sort()
          .map((k) => [k, walk(o[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export const PERMISSIONS = ['VIEW', 'OPERATE', 'APPROVE', 'BACKUP_ADMIN'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
    public actions: string[] = [],
  ) {
    super(message);
  }
}

/** Replaces absolute host paths in free text (error messages, stderr) so they never reach storage or exports. */
export const scrubPaths = (s: string) => s.replace(/(?:[A-Za-z]:\\|\/(?:Users|home|private|var|tmp|root|opt|mnt|app|data)\/)[^\s"'\\]*/g, '<path>');
