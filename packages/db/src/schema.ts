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
    /** Charter (white paper 4.1): level, framework type, decision served, performance criteria, owner, policy id. */
    charter: jsonb('charter').notNull().default({}),
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
  /** P4: pseudonymous person code (never a name), group EXCELLENT | AVERAGE, BEI | WRITTEN, consent and retention. */
  personCode: text('person_code'),
  personGroup: text('person_group'),
  kind: text('kind').notNull().default('WRITTEN'),
  consentRef: text('consent_ref'),
  retainUntil: text('retain_until'),
  submittedBy: text('submitted_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** P4.1: one respondent's ratings of one competency (survey, level A ≥ 10 people, level B ≥ 5). */
export const surveyResponse = pgTable(
  'survey_response',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    sessionId: text('session_id').notNull(),
    respondentCode: text('respondent_code').notNull(),
    competencyLabel: text('competency_label').notNull(),
    importance: integer('importance'),
    discrimination: integer('discrimination'),
    level: integer('level'),
    consentRef: text('consent_ref').notNull(),
    retainUntil: text('retain_until'),
    submittedBy: text('submitted_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('survey_session').on(t.sessionId)],
);

/** P4.5: register of AI tools; every run snapshot points to one entry. */
export const aiTool = pgTable('ai_tool', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  channel: text('channel').notNull(),
  accountType: text('account_type').notNull(),
  retention: text('retention').notNull(),
  noTraining: boolean('no_training').notNull(),
  note: text('note').notNull().default(''),
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
    /** When the worker claimed the job / when the block finished (any outcome). */
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
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
    /** OK | SCHEMA_INVALID | CLI_ERROR | TIMEOUT | REJECTED | QUOTA */
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
  /** Usage-limit circuit breaker: null = closed; otherwise { code, message, until, tripped_at }. */
  breaker: jsonb('breaker'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** One AI-assisted scan of an external dataset for JDs of a role (queued by web, run by the worker). */
export const sourceSearch = pgTable('source_search', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  dataset: text('dataset').notNull(),
  role: text('role').notNull(),
  /** QUEUED | RUNNING | DONE | FAILED */
  state: text('state').notNull().default('QUEUED'),
  progress: text('progress').notNull().default(''),
  result: jsonb('result'),
  error: jsonb('error'),
  lockedAt: ts('locked_at'),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** A public dataset downloaded to the server's data directory (queued by web, downloaded by the worker). */
export const sourceDataset = pgTable('source_dataset', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** QUEUED | DOWNLOADING | READY | FAILED */
  state: text('state').notNull().default('QUEUED'),
  progress: text('progress').notNull().default(''),
  info: jsonb('info'),
  error: jsonb('error'),
  lockedAt: ts('locked_at'),
  createdBy: text('created_by').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Auto-run switch of a run: the worker acknowledges each passed block and queues the next one. Not exported. */
export const runAuto = pgTable('run_auto', {
  runId: text('run_id').primaryKey(),
  on: boolean('on').notNull().default(false),
  note: text('note').notNull().default(''),
  /** Structured stop reason: { code, block, message, actions, until, at } (see RunStop in @cl/contract). */
  stop: jsonb('stop'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Live progress of an attempt that is still computing (which agent step, how many calls done). Not exported. */
export const attemptProgress = pgTable('attempt_progress', {
  attemptId: text('attempt_id').primaryKey(),
  steps: jsonb('steps').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Trace beats written while a block runs (only the changed variables per beat), so the trace is readable before it ends. */
export const traceEvent = pgTable(
  'trace_event',
  {
    attemptId: text('attempt_id').notNull(),
    seq: integer('seq').notNull(),
    event: jsonb('event').notNull(),
  },
  (t) => [primaryKey({ name: 'trace_event_pk', columns: [t.attemptId, t.seq] })],
);

/** One row per calculation the code made (formula, inputs, result), written as the block runs. */
export const calcRecord = pgTable(
  'calc_record',
  {
    attemptId: text('attempt_id').notNull(),
    seq: integer('seq').notNull(),
    step: text('step').notNull(),
    substep: text('substep').notNull(),
    itemRef: text('item_ref'),
    formula: text('formula').notNull(),
    inputs: jsonb('inputs').notNull(),
    output: jsonb('output'),
    decision: text('decision'),
    seat: text('seat'),
  },
  (t) => [primaryKey({ name: 'calc_record_pk', columns: [t.attemptId, t.seq] }), index('calc_record_substep').on(t.attemptId, t.substep)],
);

/** Quality of one agent (task × model × prompt version) measured on an anchor set (spec P1.2, formula 16). */
export const agentMeasure = pgTable(
  'agent_measure',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    anchorSet: text('anchor_set').notNull(),
    metrics: jsonb('metrics').notNull(),
    thresholds: jsonb('thresholds').notNull(),
    passed: boolean('passed').notNull(),
    measuredBy: text('measured_by').notNull(),
    measuredAt: ts('measured_at').notNull().defaultNow(),
  },
  (t) => [index('agent_measure_key').on(t.taskId, t.model, t.promptVersion, t.measuredAt)],
);

/** P5.1 production catalogue: one framework to produce (root, level-derived or industry variant) in a batch. */
export const productionItem = pgTable(
  'production_item',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    batchId: text('batch_id').notNull(),
    roleTitle: text('role_title').notNull(),
    level: text('level'),
    industry: text('industry'),
    /** ROOT | DERIVED_LEVEL | INDUSTRY_VARIANT */
    frameworkType: text('framework_type').notNull(),
    rootItemId: text('root_item_id'),
    sessionId: text('session_id'),
    /** P5.4: E8 audits every root and a random fifth of the derived frameworks (all of them after a failure). */
    auditSampled: boolean('audit_sampled').notNull().default(true),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('production_batch').on(t.workspaceId, t.batchId)],
);
