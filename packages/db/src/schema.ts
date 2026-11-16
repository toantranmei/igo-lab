import { bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, doublePrecision } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const workspace = pgTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** null = running; otherwise { since, finding_refs, reason, scope } */
  stopState: jsonb('stop_state'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    roleTitle: text('role_title').notNull(),
    roleId: text('role_id').notNull(),
    family: text('family'),
    industry: text('industry'),
    purpose: text('purpose').notNull().default(''),
    context: text('context').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('session_ws').on(t.workspaceId)],
);

export const documentVersion = pgTable(
  'document_version',
  {
    workspaceId: text('workspace_id').notNull(),
    documentId: text('document_id').notNull(),
    version: integer('version').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceRef: text('source_ref').notNull(),
    originalName: text('original_name').notNull(),
    contentSha256: text('content_sha256').notNull(),
    blobSha256: text('blob_sha256'),
    normalizedText: text('normalized_text').notNull(),
    normalizerVersion: text('normalizer_version').notNull(),
    parserVersion: text('parser_version').notNull(),
    segmenterVersion: text('segmenter_version').notNull(),
    segments: jsonb('segments').notNull(),
    originGroup: text('origin_group'),
    submittedBy: text('submitted_by').notNull(),
    submittedAt: ts('submitted_at').notNull().defaultNow(),
    roleId: text('role_id'),
    language: text('language'),
    checkStatus: text('check_status').notNull(),
    usageNote: text('usage_note'),
    sourceUrl: text('source_url'),
    meta: jsonb('meta').notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.version] }), index('doc_ws_hash').on(t.workspaceId, t.contentSha256)],
);

export const jdSetRevision = pgTable(
  'jd_set_revision',
  {
    jdSetId: text('jd_set_id').notNull(),
    revision: integer('revision').notNull(),
    workspaceId: text('workspace_id').notNull(),
    sessionId: text('session_id').notNull(),
    parentRevision: integer('parent_revision'),
    /** [{document_id, version}] */
    documentRefs: jsonb('document_refs').notNull(),
    confirmedBy: text('confirmed_by').notNull(),
    confirmedAt: ts('confirmed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jdSetId, t.revision] }), index('jdset_session').on(t.sessionId)],
);

export const userEvent = pgTable('user_event', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  sessionId: text('session_id').notNull(),
  label: text('label').notNull(),
  situation: text('situation').notNull().default(''),
  action: text('action').notNull().default(''),
  outcome: text('outcome').notNull().default(''),
  sourceRef: text('source_ref').notNull().default(''),
  submittedBy: text('submitted_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const run = pgTable(
  'run',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    sessionId: text('session_id').notNull(),
    runNo: integer('run_no').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    status: text('status').notNull().default('OPEN'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('run_session_no').on(t.sessionId, t.runNo)],
);

export const blockAttempt = pgTable(
  'block_attempt',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    runId: text('run_id').notNull(),
    block: text('block').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    prevAttemptId: text('prev_attempt_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** QUEUED | RUNNING | DONE | BLOCKED | NEEDS_INPUT | FAILED | STALE */
    status: text('status').notNull(),
    current: boolean('current').notNull().default(true),
    options: jsonb('options').notNull().default({}),
    inputHash: text('input_hash'),
    output: jsonb('output'),
    outputHash: text('output_hash'),
    gates: jsonb('gates'),
    trace: jsonb('trace'),
    error: jsonb('error'),
    computedAt: ts('computed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attempt_run_block_no').on(t.runId, t.block, t.attemptNo), uniqueIndex('attempt_run_idem').on(t.runId, t.idempotencyKey)],
);

export const job = pgTable('job', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id').notNull().unique(),
  /** QUEUED | RUNNING | DONE | FAILED */
  state: text('state').notNull().default('QUEUED'),
  lockedAt: ts('locked_at'),
  tries: integer('tries').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const agentCall = pgTable(
  'agent_call',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    runId: text('run_id'),
    attemptId: text('attempt_id'),
    taskId: text('task_id').notNull(),
    taskKey: text('task_key').notNull(),
    cacheHit: boolean('cache_hit').notNull(),
    model: text('model').notNull(),
    effort: text('effort').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    cliVersion: text('cli_version'),
    startedAt: ts('started_at').notNull().defaultNow(),
    durationMs: integer('duration_ms'),
    usage: jsonb('usage'),
    costUsd: doublePrecision('cost_usd'),
    /** OK | SCHEMA_INVALID | CLI_ERROR | TIMEOUT | REJECTED */
    status: text('status').notNull(),
    error: text('error'),
  },
  (t) => [index('call_attempt').on(t.attemptId), index('call_key').on(t.taskKey)],
);

export const agentResult = pgTable('agent_result', {
  taskKey: text('task_key').primaryKey(),
  taskId: text('task_id').notNull(),
  inputCanonical: text('input_canonical').notNull(),
  output: jsonb('output').notNull(),
  firstCallId: text('first_call_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Append-only. The application DB role gets INSERT/SELECT only (see migration 0001_event_guard). */
export const event = pgTable(
  'event',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: text('id').notNull().unique(),
    workspaceId: text('workspace_id').notNull(),
    sessionId: text('session_id'),
    runId: text('run_id'),
    attemptId: text('attempt_id'),
    block: text('block'),
    serverTime: ts('server_time').notNull().defaultNow(),
    actor: text('actor').notNull(),
    type: text('type').notNull(),
    versions: jsonb('versions').notNull().default({}),
    inputHash: text('input_hash'),
    outputHash: text('output_hash'),
    payload: jsonb('payload').notNull().default({}),
    prevEventHash: text('prev_event_hash'),
    eventHash: text('event_hash').notNull(),
  },
  (t) => [index('event_run').on(t.runId, t.seq), index('event_ws').on(t.workspaceId, t.seq)],
);

export const viewCursor = pgTable(
  'view_cursor',
  {
    runId: text('run_id').notNull(),
    block: text('block').notNull(),
    attemptId: text('attempt_id').notNull(),
    seq: integer('seq').notNull().default(0),
    acknowledgedAt: ts('acknowledged_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.block] })],
);

/** Immutable versioned dictionary records (W role, T task, C competency, I indicator, R framework, V evidence, G governance). */
export const dictRecord = pgTable(
  'dict_record',
  {
    workspaceId: text('workspace_id').notNull(),
    kind: text('kind').notNull(),
    id: text('id').notNull(),
    version: integer('version').notNull(),
    data: jsonb('data').notNull(),
    contentSha256: text('content_sha256').notNull(),
    releaseId: text('release_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.kind, t.id, t.version] }), index('dict_release').on(t.releaseId)],
);

export const release = pgTable(
  'release',
  {
    releaseId: text('release_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    seq: integer('seq').notNull(),
    parentReleaseId: text('parent_release_id'),
    versionLabel: text('version_label').notNull(),
    runId: text('run_id'),
    candidateId: text('candidate_id'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: ts('decided_at').notNull().defaultNow(),
    diff: jsonb('diff').notNull(),
    /** [{kind,id,version}] — every record version that makes up the dictionary as of this release */
    members: jsonb('members').notNull(),
    receiptHash: text('receipt_hash').notNull(),
    reverts: text('reverts'),
    origin: text('origin').notNull().default('B8'),
  },
  (t) => [uniqueIndex('release_ws_seq').on(t.workspaceId, t.seq), uniqueIndex('release_ws_candidate').on(t.workspaceId, t.runId, t.candidateId)],
);

export const candidate = pgTable('candidate', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  runId: text('run_id').notNull(),
  attemptId: text('attempt_id').notNull(),
  baseReleaseId: text('base_release_id'),
  items: jsonb('items').notNull(),
  /** READY | DECIDED | COMMITTED | SUPERSEDED */
  status: text('status').notNull().default('READY'),
  decision: jsonb('decision'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const finding = pgTable('finding', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  runId: text('run_id'),
  severity: text('severity').notNull(),
  fingerprint: text('fingerprint').notNull(),
  data: jsonb('data').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const lesson = pgTable('lesson', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  /** PENDING | SAFE | APPLIED | REJECTED */
  status: text('status').notNull().default('PENDING'),
  data: jsonb('data').notNull(),
  decidedBy: text('decided_by'),
  decidedAt: ts('decided_at'),
  decisionReason: text('decision_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const importPreview = pgTable('import_preview', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  digest: text('digest').notNull(),
  blobSha256: text('blob_sha256').notNull(),
  mode: text('mode').notNull(),
  report: jsonb('report').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const exportFile = pgTable('export_file', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  kind: text('kind').notNull(),
  blobSha256: text('blob_sha256').notNull(),
  fileName: text('file_name').notNull(),
  manifest: jsonb('manifest').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Heartbeat written by the worker so the web process can tell whether Live runs are possible. */
export const workerStatus = pgTable('worker_status', {
  id: text('id').primaryKey(),
  ok: boolean('ok').notNull(),
  cliVersion: text('cli_version'),
  message: text('message').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
