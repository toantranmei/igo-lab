import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { AppError, MAIN_BLOCK_IDS, scrubPaths, gateBlocks, type BlockCard, type BlockDetail, type BlockId, type BlockTrace, type CardState, type DictFrame, type GateResult, type InputDoc, type InputEvent, type InputTask, type Lesson, type LogEntry, type PendingGuide, type ReleaseHistoryEntry, type SessionState } from '@cl/contract';
import { BLOCK_TASKS, ClaudeCliRunner, TASKS, shortModel, type TaskName } from '@cl/agents';
import { appendEvent, hashJson, newId, t, type Db } from '@cl/db';
import { getStop, listReleases, loadDictionary, toDictView } from '@cl/registry';
import { runB0, runB1, runB2, runB3, runFAST } from './blocks-a';
import { runB4, runB5, runB6, runB7, runB8 } from './blocks-b';
import { BLOCK_META } from './meta';
import { currentRun, getSession, latestJdSet, listUserEvents, loadDocs } from './sessions';
import { policyRef, type BlockCtx, type BlockResult, type RunSnapshot } from './types';

type Attempt = Omit<typeof t.blockAttempt.$inferSelect, 'trace'>;
const RUNNERS: Record<BlockId, (c: BlockCtx) => Promise<BlockResult>> = { B0: runB0, B1: runB1, B2: runB2, B3: runB3, B4: runB4, B5: runB5, B6: runB6, B7: runB7, B8: runB8, FAST: runFAST };
const ALL: BlockId[] = [...MAIN_BLOCK_IDS, 'FAST'];
const isBlock = (b: string): b is BlockId => (ALL as string[]).includes(b);
export function assertBlock(b: string): BlockId {
  if (!isBlock(b)) throw new AppError('NOT_FOUND', `Không có block "${b}".`, 404);
  return b;
}
const computed = (a?: Attempt | null) => !!a && (a.status === 'DONE' || a.status === 'BLOCKED' || a.status === 'NEEDS_INPUT');

async function currentAttempts(db: Db, runId: string) {
  // Without `trace`: it can be tens of MB for a large JD set and only the guide needs it (see getTrace).
  const { trace: _trace, ...cols } = getTableColumns(t.blockAttempt);
  const rows = await db.select(cols).from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, runId), eq(t.blockAttempt.current, true)));
  return new Map(rows.map((r) => [r.block as BlockId, r]));
}
async function cursors(db: Db, runId: string) {
  const rows = await db.select().from(t.viewCursor).where(eq(t.viewCursor.runId, runId));
  return new Map(rows.map((r) => [r.block as BlockId, r]));
}

export async function workerStatus(db: Db): Promise<{ ok: boolean; message: string; cliVersion: string | null; fresh: boolean }> {
  const [w] = await db.select().from(t.workerStatus).where(eq(t.workerStatus.id, 'worker'));
  if (!w) return { ok: false, fresh: false, cliVersion: null, message: 'Worker chưa chạy. Mở một terminal và chạy `pnpm worker` (hoặc `docker compose --profile app up`).' };
  const fresh = Date.now() - new Date(w.updatedAt).getTime() < 90000;
  if (!fresh) return { ok: false, fresh, cliVersion: w.cliVersion, message: 'Worker không còn phản hồi. Khởi động lại bằng `pnpm worker`.' };
  return { ok: w.ok, fresh, cliVersion: w.cliVersion, message: w.message };
}
export async function writeWorkerStatus(db: Db, status: { ok: boolean; version: string | null; message: string }) {
  const now = new Date().toISOString();
  await db.insert(t.workerStatus).values({ id: 'worker', ok: status.ok, cliVersion: status.version, message: status.message, updatedAt: now }).onConflictDoUpdate({ target: t.workerStatus.id, set: { ok: status.ok, cliVersion: status.version, message: status.message, updatedAt: now } });
}

/** Start (or return) the attempt for a block. Never computes anything itself: it only enqueues a job. */
export async function startAttempt(db: Db, workspaceId: string, sessionId: string, block: BlockId, idempotencyKey: string, opts: { rerun_tasks?: string[]; actor: string; skipAgentCheck?: boolean }): Promise<PendingGuide> {
  if (!idempotencyKey?.trim()) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Thiếu header Idempotency-Key.', 400);
  const run = await currentRun(db, sessionId);
  if (!run || run.workspaceId !== workspaceId) throw new AppError('NO_RUN', 'Phiên chưa có lượt chạy. Thêm JD và tạo lượt trước.', 409, undefined, ['CREATE_RUN']);
  const [same] = await db.select().from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, run.id), eq(t.blockAttempt.idempotencyKey, idempotencyKey)));
  if (same) return { id: same.block as BlockId, cursor: 0, committed: computed(same) };
  if (await getStop(db, workspaceId)) throw new AppError('WORKSPACE_STOPPED', 'Workspace đang STOP: không chạy block mới cho tới khi được mở lại.', 423, undefined, ['OPEN_AUDIT']);
  if (run.status === 'COMPLETE') throw new AppError('RUN_COMPLETE', 'Lượt này đã công bố xong. Tạo lượt mới để chạy tiếp.', 409, undefined, ['NEW_RUN']);
  const cur = await currentAttempts(db, run.id);
  const cs = await cursors(db, run.id);
  const mine = cur.get(block);
  if (mine && (mine.status === 'QUEUED' || mine.status === 'RUNNING')) return { id: block, cursor: 0, committed: false };
  if (mine && computed(mine) && mine.status === 'DONE' && !cs.get(block)?.acknowledgedAt && !opts.rerun_tasks?.length) return { id: block, cursor: cs.get(block)?.seq ?? 0, committed: true };
  for (const [b, a] of cur) if (b !== block && a.status !== 'STALE' && !cs.get(b)?.acknowledgedAt && a.status !== 'FAILED') throw new AppError('PENDING_VIEW', `Block ${b} đang chờ xem và bấm "Đã hiểu" trước khi chạy block khác.`, 409, { block: b }, ['REOPEN_PENDING']);
  const snapshot = run.snapshot as RunSnapshot;
  if (block === 'FAST') {
    if (!snapshot.policy.fast_branch) throw new AppError('FAST_DISABLED', 'Policy của lượt không mở nhánh giao thử.', 409);
    if (cur.get('B3')?.status !== 'DONE') throw new AppError('ORDER', 'Nhánh giao thử chỉ mở sau khi B3 đạt.', 409);
  } else {
    const idx = MAIN_BLOCK_IDS.indexOf(block as any);
    for (const b of MAIN_BLOCK_IDS.slice(0, idx)) if (cur.get(b)?.status !== 'DONE') throw new AppError('ORDER', `Chưa chạy được ${block}: ${b} chưa đạt.`, 409, { block: b });
  }
  if (BLOCK_TASKS[block].length && !opts.skipAgentCheck) {
    const ws = await workerStatus(db);
    if (!ws.ok) throw new AppError('AGENT_CLI_UNAVAILABLE', ws.message, 503, undefined, ['RETRY']);
  }
  const rerun: Record<string, number> = {};
  for (const name of opts.rerun_tasks ?? []) if (name in TASKS) rerun[name] = ((mine?.options as any)?.rerun?.[name] ?? 0) + 1;
  for (const [k, v] of Object.entries(((mine?.options as any)?.rerun ?? {}) as Record<string, number>)) if (!(k in rerun)) rerun[k] = v;
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${t.blockAttempt.attemptNo}), 0)::int` }).from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, run.id), eq(t.blockAttempt.block, block)));
    if (mine) await tx.update(t.blockAttempt).set({ current: false }).where(eq(t.blockAttempt.id, mine.id));
    if (block !== 'FAST') {
      // Retrying block n makes everything after it stale; earlier blocks are reused as they are.
      const later = [...MAIN_BLOCK_IDS.slice(MAIN_BLOCK_IDS.indexOf(block as any) + 1), ...(MAIN_BLOCK_IDS.indexOf(block as any) <= 3 ? (['FAST'] as BlockId[]) : [])];
      const stale = later.map((b) => cur.get(b)).filter((a): a is Attempt => !!a && a.status !== 'STALE');
      if (stale.length) await tx.update(t.blockAttempt).set({ status: 'STALE' }).where(inArray(t.blockAttempt.id, stale.map((a) => a.id)));
    }
    const id = newId('att');
    await tx.insert(t.blockAttempt).values({ id, workspaceId, runId: run.id, block, attemptNo: n + 1, prevAttemptId: mine?.id ?? null, idempotencyKey, status: 'QUEUED', current: true, options: { rerun } });
    await tx.insert(t.job).values({ id: newId('job'), attemptId: id, state: 'QUEUED' });
    const now = new Date().toISOString();
    await tx.insert(t.viewCursor).values({ runId: run.id, block, attemptId: id, seq: 0, acknowledgedAt: null, updatedAt: now }).onConflictDoUpdate({ target: [t.viewCursor.runId, t.viewCursor.block], set: { attemptId: id, seq: 0, acknowledgedAt: null, updatedAt: now } });
    return { id: block, cursor: 0, committed: false };
  });
}

/** Claim one queued job (SKIP LOCKED so several workers never take the same one) and run it. */
export async function processNextJob(db: Db, runner: ClaudeCliRunner): Promise<boolean> {
  const claimed = await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`select id, attempt_id from job where state = 'QUEUED' or (state = 'RUNNING' and locked_at < now() - interval '15 minutes') order by created_at for update skip locked limit 1`)) as unknown as { id: string; attempt_id: string }[];
    const j = rows[0];
    if (!j) return null;
    await tx.update(t.job).set({ state: 'RUNNING', lockedAt: new Date().toISOString(), tries: sql`${t.job.tries} + 1` }).where(eq(t.job.id, j.id));
    await tx.update(t.blockAttempt).set({ status: 'RUNNING' }).where(eq(t.blockAttempt.id, j.attempt_id));
    return j;
  });
  if (!claimed) return false;
  const ok = await runAttempt(db, runner, claimed.attempt_id);
  await db.update(t.job).set({ state: ok ? 'DONE' : 'FAILED' }).where(eq(t.job.id, claimed.id));
  const [att] = await db.select().from(t.blockAttempt).where(eq(t.blockAttempt.id, claimed.attempt_id));
  const [run] = att ? await db.select().from(t.run).where(eq(t.run.id, att.runId)) : [];
  if (run) await advanceAuto(db, run.workspaceId, run.sessionId).catch((e) => console.error('[auto]', e?.message ?? e));
  return true;
}

/**
 * Auto-run: from "start" to the B8 candidate without a click per block. The worker acknowledges each block
 * that passed (actor "auto") and queues the next one. It stops by itself at a blocked gate, an error, STOP,
 * or after B8 — it never decides the candidate and never commits to the dictionary.
 */
export async function getAuto(db: Db, runId: string) {
  const [a] = await db.select().from(t.runAuto).where(eq(t.runAuto.runId, runId));
  return { on: !!a?.on, note: a?.note ?? '' };
}
const putAuto = (db: Db, runId: string, on: boolean, note: string) => {
  const updatedAt = new Date().toISOString();
  return db.insert(t.runAuto).values({ runId, on, note, updatedAt }).onConflictDoUpdate({ target: t.runAuto.runId, set: { on, note, updatedAt } });
};
export async function setAuto(db: Db, workspaceId: string, sessionId: string, on: boolean, actor: string) {
  const run = await currentRun(db, sessionId);
  if (!run || run.workspaceId !== workspaceId) throw new AppError('NO_RUN', 'Phiên chưa có lượt chạy. Thêm JD và tạo lượt trước.', 409, undefined, ['CREATE_RUN']);
  if (on) {
    const ws = await workerStatus(db);
    if (!ws.ok) throw new AppError('AGENT_CLI_UNAVAILABLE', ws.message, 503, undefined, ['RETRY']);
  }
  await putAuto(db, run.id, on, on ? 'Đang chạy tự động.' : 'Đã dừng chạy tự động theo yêu cầu.');
  await appendEvent(db, { workspaceId, type: on ? 'AUTO_STARTED' : 'AUTO_STOPPED', actor, sessionId, runId: run.id, payload: {} });
  if (on) await advanceAuto(db, workspaceId, sessionId);
  return getAuto(db, run.id);
}
export async function advanceAuto(db: Db, workspaceId: string, sessionId: string): Promise<void> {
  const run = await currentRun(db, sessionId);
  if (!run || !(await getAuto(db, run.id)).on) return;
  const off = (note: string) => putAuto(db, run.id, false, note);
  if (run.status === 'COMPLETE') return void (await off('Lượt đã công bố.'));
  if (await getStop(db, workspaceId)) return void (await off('Dừng: workspace đang STOP.'));
  const cur = await currentAttempts(db, run.id);
  const cs = await cursors(db, run.id);
  for (const [b, a] of cur) {
    if (a.status === 'STALE') continue;
    if (a.status === 'QUEUED' || a.status === 'RUNNING') return; // the worker comes back here when it finishes
    if (a.status === 'FAILED') return void (await off(`Dừng ở ${b}: lỗi ${(a.error as any)?.code ?? ''}. Xem chi tiết và bấm Thử lại.`));
    if (a.status !== 'DONE') return void (await off(`Dừng ở ${b}: cổng chặn. Xem lý do ở thẻ ${b}.`));
    if (!cs.get(b)?.acknowledgedAt) await acknowledge(db, workspaceId, sessionId, b, 'auto');
  }
  const next = MAIN_BLOCK_IDS.find((b) => cur.get(b)?.status !== 'DONE');
  if (!next) return void (await off('Đã chạy xong B0–B8. Hồ sơ DỰ KIẾN chờ bạn duyệt để ghi vào từ điển.'));
  try {
    await startAttempt(db, workspaceId, sessionId, next, `auto-${newId('k')}`, { actor: 'auto' });
  } catch (e: any) {
    await off(`Dừng trước ${next}: ${e?.code ?? ''} ${e?.message ?? e}`.slice(0, 300));
  }
}

export async function runAttempt(db: Db, runner: ClaudeCliRunner, attemptId: string): Promise<boolean> {
  const [att] = await db.select().from(t.blockAttempt).where(eq(t.blockAttempt.id, attemptId));
  if (!att) return false;
  const block = att.block as BlockId;
  const [run] = await db.select().from(t.run).where(eq(t.run.id, att.runId));
  const snapshot = run.snapshot as RunSnapshot;
  const now = new Date().toISOString();
  try {
    const docs = await loadDocs(db, att.workspaceId, snapshot.documents);
    const cur = await currentAttempts(db, run.id);
    const prev: BlockCtx['prev'] = {};
    const prevGates: BlockCtx['prevGates'] = {};
    for (const [b, a] of cur) if (a.status === 'DONE' && b !== block) (prev[b] = a.output as any), (prevGates[b] = a.gates as GateResult[]);
    const base = await loadDictionary(db, att.workspaceId, snapshot.base_release_id);
    const status = await runner.status();
    const ctx: BlockCtx = { block, attemptId, runId: run.id, workspaceId: att.workspaceId, snapshot, docs, base, prev, prevGates, now, agent: { db, runner, config: snapshot.agent_config, workspaceId: att.workspaceId, runId: run.id, attemptId, sessionId: run.sessionId, rerun: (att.options as any)?.rerun ?? {}, cliVersion: status.version } };
    const inputHash = hashJson({ block, snapshot: hashJson(snapshot), prev: Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, hashJson(v)])) });
    const res = await RUNNERS[block](ctx);
    const output = { ...res.output, __view: res.view, __ai: res.ai };
    const outputHash = hashJson(res.output);
    await db.update(t.blockAttempt).set({ status: res.status, inputHash, output, outputHash, gates: res.gates, trace: res.trace, error: null, computedAt: now }).where(eq(t.blockAttempt.id, attemptId));
    await appendEvent(db, { workspaceId: att.workspaceId, type: 'JOB_RESULT', actor: 'worker', sessionId: run.sessionId, runId: run.id, attemptId, block, inputHash, outputHash, versions: { policy: policyRef(snapshot.policy), agents: snapshot.agent_config.version, cli: status.version }, payload: { status: res.status, attempt_no: att.attemptNo, ai: res.ai, summary: res.view.handoff } });
    await appendEvent(db, { workspaceId: att.workspaceId, type: 'GATE_RESULT', actor: 'worker', sessionId: run.sessionId, runId: run.id, attemptId, block, payload: { gates: res.gates.map((g) => ({ gate_id: g.gate_id, name: g.name, status: g.status, actual: g.actual, criterion: g.criterion, required: g.required, reason: g.reason })) } });
    return true;
  } catch (e: any) {
    const err = e instanceof AppError ? { code: e.code, message: scrubPaths(e.message), actions: e.actions } : { code: 'INTERNAL', message: scrubPaths(String(e?.message ?? e)).slice(0, 500), actions: ['RETRY'] };
    // The draft of earlier blocks is untouched; this attempt just records why it stopped.
    await db.update(t.blockAttempt).set({ status: 'FAILED', error: err, computedAt: now }).where(eq(t.blockAttempt.id, attemptId));
    await appendEvent(db, { workspaceId: att.workspaceId, type: 'JOB_RESULT', actor: 'worker', sessionId: run.sessionId, runId: run.id, attemptId, block, payload: { status: 'FAILED', attempt_no: att.attemptNo, error: err } });
    return false;
  }
}

export async function setCursor(db: Db, sessionId: string, block: BlockId, cursor: number) {
  const run = await currentRun(db, sessionId);
  if (!run) return;
  await db.update(t.viewCursor).set({ seq: Math.max(0, Math.floor(cursor)), updatedAt: new Date().toISOString() }).where(and(eq(t.viewCursor.runId, run.id), eq(t.viewCursor.block, block)));
}
export async function acknowledge(db: Db, workspaceId: string, sessionId: string, block: BlockId, actor: string) {
  const run = await currentRun(db, sessionId);
  if (!run) throw new AppError('NO_RUN', 'Phiên chưa có lượt chạy.', 409);
  const a = (await currentAttempts(db, run.id)).get(block);
  if (!a || !computed(a)) throw new AppError('NOT_COMMITTED', 'Block chưa tính xong nên chưa thể xác nhận đã hiểu.', 409);
  const [c] = await db.select().from(t.viewCursor).where(and(eq(t.viewCursor.runId, run.id), eq(t.viewCursor.block, block)));
  if (c?.acknowledgedAt) return;
  await db.update(t.viewCursor).set({ acknowledgedAt: new Date().toISOString() }).where(and(eq(t.viewCursor.runId, run.id), eq(t.viewCursor.block, block)));
  await appendEvent(db, { workspaceId, type: 'ACKNOWLEDGED', actor, sessionId, runId: run.id, attemptId: a.id, block, payload: { status: a.status } });
}

/** One line for the card: the step in flight and its count, e.g. "Gộp nhiệm vụ… 8/11 lời gọi". */
function progressText(p?: BlockCard['progress']): string {
  const steps = p?.steps ?? [];
  const live = steps.find((s) => s.done + s.failed < s.total) ?? steps.at(-1);
  if (!live) return 'Đang tính… (code, chưa gọi AI)';
  return live.done + live.failed < live.total ? `${live.title}: ${live.done}/${live.total} lời gọi AI` : 'Code đang tổng hợp kết quả…';
}
function badgeFor(block: BlockId, snapshot: RunSnapshot | null, a?: Attempt | null): BlockCard['badge'] {
  const used = ((a?.output as any)?.__ai ?? []) as { task_id: string; model: string; effort: string }[];
  if (computed(a)) return used.length ? { kind: 'AI', tasks: used.map((u) => ({ task_id: u.task_id, model: shortModel(u.model), effort: u.effort })) } : { kind: 'CODE' };
  const names = BLOCK_TASKS[block] as TaskName[];
  if (!names.length) return { kind: 'CODE' };
  const cfg = snapshot?.agent_config;
  return { kind: 'AI', tasks: names.filter((n) => n !== 'T9' || (snapshot?.rubric.length ?? 0) > 0).map((n) => ({ task_id: TASKS[n].id, model: n === 'T9' || n === 'T11' ? (cfg?.seats ?? []).map((s) => shortModel(s.model)).join('/') || '3 ghế' : shortModel(cfg?.tasks[n].model ?? ''), effort: cfg?.tasks[n].effort ?? '' })) };
}
const cardState = (a: Attempt | undefined, acked: boolean): CardState => (!a ? 'idle' : a.status === 'QUEUED' || a.status === 'RUNNING' ? 'running' : a.status === 'FAILED' ? 'error' : a.status === 'STALE' ? 'stale' : !acked ? 'awaiting_view' : a.status === 'DONE' ? 'pass' : a.status === 'NEEDS_INPUT' ? 'needs_input' : 'blocked');

const EVENT_TEXT: Record<string, (p: any) => string> = {
  INPUT_LOCKED: (p) => `Khóa snapshot lượt ${p.run_no}: ${p.documents?.length ?? 0} JD, nền ${p.base_release_id ?? 'rỗng'}.`,
  JOB_RESULT: (p) => (p.status === 'FAILED' ? `Lỗi ${p.error?.code}: ${p.error?.message}` : `${p.status === 'DONE' ? 'ĐẠT' : 'CHẶN'} · ${p.summary ?? ''}`),
  GATE_RESULT: (p) => (p.gates ?? []).map((g: any) => `${g.name}: ${g.status}`).join(' · '),
  AGENT_CALL: () => 'Gọi agent qua Claude CLI.',
  CANDIDATE_READY: (p) => `Hồ sơ dự kiến: ${p.counts?.ADD} ADD · ${p.counts?.UPDATE} UPDATE · ${p.counts?.REUSE} REUSE.`,
  AUDIT: (p) => `Kiểm toán: ${p.conclusion}, ${p.findings} finding.`,
  APPROVAL: (p) => `Quyết định ${p.decision}: ${p.reason}`,
  RELEASE_COMMITTED: (p) => `Đã ghi release ${p.version_label ?? ''} (${p.release_id}).`,
  ACKNOWLEDGED: () => 'Xác nhận "Đã hiểu" (người dùng bấm, hoặc chế độ tự động).',
  AUTO_STARTED: () => 'Bật chạy tự động tới B8.',
  AUTO_STOPPED: () => 'Tắt chạy tự động.',
  STOP_RAISED: (p) => `STOP: ${p.reason}`,
  STOP_CLEARED: (p) => `Mở lại: ${p.reason}`,
  RUN_CREATED: () => 'Tạo lượt.',
};

export async function getState(db: Db, workspaceId: string, sessionId: string): Promise<SessionState> {
  const session = await getSession(db, workspaceId, sessionId);
  const run = await currentRun(db, sessionId);
  const snapshot = (run?.snapshot as RunSnapshot | undefined) ?? null;
  const cur = run ? await currentAttempts(db, run.id) : new Map<BlockId, Attempt>();
  const cs = run ? await cursors(db, run.id) : new Map();
  const stop = await getStop(db, workspaceId);
  const acked = (b: BlockId) => !!cs.get(b)?.acknowledgedAt;
  const out = (b: BlockId) => (cur.get(b)?.status === 'DONE' || cur.get(b)?.status === 'BLOCKED' ? (cur.get(b)!.output as any) : null);

  // what blocks that are still computing are doing right now (written by the worker as calls start/finish)
  const progress = new Map<string, BlockCard['progress']>();
  for (const a of cur.values()) {
    if (a.status !== 'RUNNING' && a.status !== 'QUEUED') continue;
    const [p] = await db.select().from(t.attemptProgress).where(eq(t.attemptProgress.attemptId, a.id));
    progress.set(a.id, { started_at: new Date(a.createdAt).toISOString(), updated_at: new Date(p?.updatedAt ?? a.createdAt).toISOString(), steps: (p?.steps as any[]) ?? [] });
  }
  const cards: BlockCard[] = ALL.map((b) => {
    const a = cur.get(b);
    const m = BLOCK_META[b];
    return { id: b, name: m.name, agent: m.agent, artifact: m.artifact, state: cardState(a, acked(b)), receipt: a?.status === 'FAILED' ? `${(a.error as any)?.code}: ${(a.error as any)?.message}` : computed(a) ? ((a!.output as any).__view?.handoff ?? '') : a ? progressText(progress.get(a.id)) : m.artifact, badge: badgeFor(b, snapshot, a), ...(a && progress.get(a.id) ? { progress: progress.get(a.id) } : {}) };
  });
  let position = 0;
  for (const b of MAIN_BLOCK_IDS) {
    if (cur.get(b)?.status === 'DONE') position++;
    else break;
  }
  const pendingBlock = ALL.find((b) => cur.get(b) && cur.get(b)!.status !== 'STALE' && !acked(b));
  const pa = pendingBlock ? cur.get(pendingBlock)! : null;
  const auto = run ? await getAuto(db, run.id) : { on: false, note: '' };
  // while auto-run is on nothing waits for the viewer: the worker acknowledges and moves on
  const pending: PendingGuide | null = pendingBlock && !auto.on ? { id: pendingBlock, cursor: cs.get(pendingBlock)?.seq ?? 0, committed: computed(pa) } : null;
  const blocked = ALL.filter((b) => cur.get(b)?.status === 'BLOCKED');
  const haltReasons = [...(stop ? [`STOP toàn workspace: ${stop.reason}`] : []), ...blocked.flatMap((b) => ((cur.get(b)!.gates as GateResult[]) ?? []).filter(gateBlocks).map((g) => `${b} · ${g.name}`))];
  const halted = !!stop || blocked.some((b) => b !== 'FAST');

  const [committedRelease] = run ? await db.select().from(t.release).where(and(eq(t.release.workspaceId, workspaceId), eq(t.release.runId, run.id))) : [];
  const releases = await listReleases(db, workspaceId);
  const shownId = committedRelease?.releaseId ?? (snapshot ? snapshot.base_release_id : releases.at(-1)?.releaseId ?? null);
  const dict = await loadDictionary(db, workspaceId, shownId);
  const dictionary = await toDictView(db, workspaceId, dict);
  const history: ReleaseHistoryEntry[] = [];
  for (const r of releases.filter((r) => r.seq <= dict.seq)) {
    const d = await loadDictionary(db, workspaceId, r.releaseId);
    const parent = releases.find((x) => x.releaseId === r.parentReleaseId);
    history.push({ run: r.seq, fromVersion: parent?.versionLabel ?? '0.0', toVersion: r.versionLabel, changes: ((r.diff as any).changes ?? []).filter((c: any) => c.entity === 'C' || c.entity === 'R' || c.entity === 'W'), after: await toDictView(db, workspaceId, d), receipt: { release_id: r.releaseId, hash: r.receiptHash, decided_by: r.decidedBy, decided_at: new Date(r.decidedAt).toISOString() } });
  }

  const events = run ? await db.select().from(t.event).where(and(eq(t.event.runId, run.id))).orderBy(asc(t.event.seq)) : [];
  const logs: LogEntry[] = events.filter((e) => e.type !== 'AGENT_CALL').map((e) => ({ seq: e.seq, run: run!.runNo, step: e.block ?? '—', type: e.type, time: new Date(e.serverTime).toISOString(), summary: (EVENT_TEXT[e.type] ?? (() => e.type))(e.payload), payload: e.payload }));

  // Inputs: the run's locked documents, or (before the first run) the latest confirmed JD set.
  const jdSet = !snapshot ? await latestJdSet(db, sessionId) : null;
  const docs = await loadDocs(db, workspaceId, snapshot ? snapshot.documents : ((jdSet?.documentRefs as any[]) ?? []));
  const b1 = out('B1'), b2 = out('B2'), b3 = out('B3'), b4 = out('B4');
  const used = new Map<string, string[]>();
  for (const k of (b2?.tasks ?? []) as any[]) for (const s of k.segment_ids) used.set(s, [...(used.get(s) ?? []), `Nhiệm vụ: ${k.statement}`]);
  for (const g of (b3?.groups ?? []) as any[]) for (const s of g.segment_ids) used.set(s, [...(used.get(s) ?? []), `Năng lực: ${g.label}`]);
  const jds: InputDoc[] = docs.map((d) => {
    const j = (b1?.jds as any[] | undefined)?.find((x) => x.ref === d.ref);
    return { id: d.ref, title: d.original_name, origin: d.origin_group ?? 'chưa xác định', role: session.roleTitle, source: d.source_ref || '(chưa nhập nguồn)', sourceOk: !!d.source_ref.trim(), synthetic: false, version: d.version, text: d.text, usedPassages: d.segments.filter((s) => used.has(s.id)).flatMap((s) => used.get(s.id)!.map((label) => ({ label: `${label} · ${s.id}`, text: s.text }))), meta: [['Mã tài liệu', d.ref], ['SHA-256 nội dung', d.content_sha256], ['Kiểu nguồn', d.source_kind], ['Ngôn ngữ', d.language ?? '—'], ['Số đoạn', String(d.segments.length)], ['Trạng thái kiểm', d.check_status], ['Kết luận B1', j ? j.why : 'chưa chạy'], ...(d.usage_note ? [['Ghi chú sử dụng', d.usage_note] as [string, string]] : []), ...(d.source_url ? [['URL nguồn', d.source_url] as [string, string]] : [])], evidenceClass: 'JD · người dùng nhập' };
  });
  const tasks: InputTask[] = ((b2?.tasks ?? []) as any[]).map((k) => ({ id: k.id, name: k.statement, weight: k.weight, refs: k.segment_ids }));
  const userEvents = snapshot ? snapshot.events : (await listUserEvents(db, sessionId)).map((e) => ({ id: e.id, label: e.label, situation: e.situation, action: e.action, outcome: e.outcome, source_ref: e.sourceRef }));
  const inputEvents: InputEvent[] = [
    ...userEvents.map((e) => ({ id: e.id, label: e.label, type: 'Sự kiện thật', evidenceClass: 'REAL' as const, source: e.source_ref || '(thiếu nguồn)', situation: e.situation, action: e.action, outcome: e.outcome })),
    ...((b4?.hypotheses ?? []) as any[]).map((h) => ({ id: h.id, label: h.label, type: 'Giả thuyết do agent đề xuất', evidenceClass: 'HYPOTHESIS' as const, source: h.segment_ids.join(', '), situation: h.situation, action: h.action, outcome: h.outcome })),
  ];

  const fastOut = out('FAST');
  const trial: DictFrame | null = fastOut && cur.get('FAST')?.status === 'DONE' ? { id: `R-${session.roleId}-trial`, version: fastOut.version, role: session.roleTitle, purpose: 'Bản thử phát triển', evidence: 'jd_only · chưa qua B4–B8', trial: true, competencies: (fastOut.competencies as any[]).map((c) => ({ id: c.id, name: c.name, level: null, indicator: null, evidence: c.evidence })) } : null;
  const lessonRows = await db.select().from(t.lesson).where(eq(t.lesson.workspaceId, workspaceId)).orderBy(asc(t.lesson.createdAt));
  const lessons: Lesson[] = lessonRows.map((l) => ({ id: l.id, text: (l.data as any).text, status: l.status as Lesson['status'], owner: l.decidedBy ?? (l.data as any).owner ?? 'local', control: (l.data as any).control, test: (l.data as any).test }));
  const ws = await workerStatus(db);
  const completed = run?.status === 'COMPLETE';
  const b8 = out('B8');
  const statusText = !run ? (docs.length ? 'Đã có bộ JD · chưa tạo lượt' : 'Chưa có JD') : stop ? 'STOP · chờ mở lại' : completed ? `Đã công bố ${committedRelease?.versionLabel ?? ''}` : halted ? `Chặn tại ${blocked[0]}` : auto.on ? `Tự động · ${pendingBlock ? `${pendingBlock} · ${progressText(progress.get(cur.get(pendingBlock)!.id))}` : 'đang chuyển block'}` : pending && !pending.committed ? `Đang tính ${pending.id}` : pending ? `Chờ "Đã hiểu" ${pending.id}` : position === 9 ? 'Chờ quyết định công bố' : `Sẵn sàng chạy B${position}`;
  return {
    mode: 'live',
    sessionId,
    sessionName: session.name,
    roleTitle: session.roleTitle,
    runNo: run?.runNo ?? 0,
    runLabel: run ? `Lượt ${String(run.runNo).padStart(2, '0')}` : 'Chưa có lượt',
    inputSummary: `${docs.length} JD · ${tasks.length} nhiệm vụ · ${inputEvents.length} sự kiện`,
    dictionaryVersionLabel: `Lõi v${dict.versionLabel}${snapshot && !committedRelease ? ' · nền của lượt' : ''}`,
    position,
    completed: !!completed,
    halted,
    haltReasons,
    statusText,
    cards,
    fast: { available: !!snapshot?.policy.fast_branch && cur.get('B3')?.status === 'DONE' && !fastOut && !halted && !completed, done: !!trial, summary: trial ? `Bản thử ${trial.competencies.length} năng lực · chỉ dùng cho phát triển` : 'Mở sau khi B3 đạt' },
    pending,
    logs,
    inputs: { label: snapshot ? `Bộ JD revision ${snapshot.jd_set.revision} · khóa theo lượt ${run!.runNo}` : jdSet ? `Bộ JD revision ${jdSet.revision} · chưa chạy` : 'Chưa có JD', jds, tasks, events: inputEvents },
    dictionary,
    startDictionaryVersion: snapshot?.base_version_label ?? dict.versionLabel,
    history,
    audit: b8?.audit ?? null,
    lessons,
    canStartNextRun: false,
    nextRunHint: !run ? 'Thêm JD và tạo lượt đầu tiên ở khung "Dữ liệu của phiên".' : completed ? 'Lượt đã công bố. Tạo lượt mới (dùng lại hoặc bổ sung JD) ở khung "Dữ liệu của phiên".' : stop ? 'Workspace đang STOP: xử lý lesson rồi mở lại trước khi chạy tiếp.' : halted ? 'Lượt bị chặn ở cổng. Sửa dữ liệu rồi tạo lượt mới; lượt cũ được giữ nguyên.' : 'Lượt đang chạy. Lượt mới tạo được bất cứ lúc nào; lượt cũ không bị sửa.',
    trial,
    aiReady: { ok: ws.ok, message: ws.message },
    auto: { ...auto, running: auto.on ? (pendingBlock ?? null) : null },
  };
}

function staticDetail(block: BlockId, state: BlockDetail['state'], note: string): BlockDetail {
  const m = BLOCK_META[block];
  return { id: block, name: m.name, agent: m.agent, method: m.method, state, input: [], flow: [...m.flow], output: [], rows: [], calc: [], gates: [], notes: [note], handoff: '', handoffTarget: m.target, raw: null };
}
export async function getDetail(db: Db, workspaceId: string, sessionId: string, block: BlockId): Promise<BlockDetail> {
  await getSession(db, workspaceId, sessionId);
  const run = await currentRun(db, sessionId);
  const a = run ? (await currentAttempts(db, run.id)).get(block) : undefined;
  const m = BLOCK_META[block];
  if (!a) return staticDetail(block, 'not_run', run ? 'Block chưa chạy. Mở thẻ không tạo job và không gọi agent.' : 'Phiên chưa có lượt chạy.');
  if (a.status === 'QUEUED' || a.status === 'RUNNING') return { ...staticDetail(block, 'running', 'Worker đang tính block này…'), computed_at: undefined };
  if (a.status === 'FAILED') return { ...staticDetail(block, 'error', 'Lần chạy này lỗi. Bản nháp của các block trước được giữ nguyên.'), error: { code: (a.error as any)?.code ?? 'INTERNAL', message: (a.error as any)?.message ?? '', attempt_id: a.id } };
  const o = a.output as any;
  const v = o.__view;
  const { __view: _v, __ai: _a, ...raw } = o;
  return { id: block, name: m.name, agent: m.agent, method: m.method, state: block === 'FAST' && a.status === 'DONE' ? 'trial' : a.status === 'DONE' ? 'actual_pass' : 'actual_blocked', input: v.input, flow: [...m.flow], output: v.output, rows: v.rows, calc: v.calc, gates: a.gates as GateResult[], notes: [...v.notes, ...(a.status === 'STALE' ? ['Kết quả này đã cũ: một block trước đó được chạy lại.'] : [])], handoff: v.handoff, handoffTarget: m.target, visual: v.visual, raw, computed_at: a.computedAt ? new Date(a.computedAt).toISOString() : undefined };
}

/** Beats of the current attempt. `null` while the worker is still computing. A block that has not run yields a short, number-free description. */
export async function getTrace(db: Db, workspaceId: string, sessionId: string, block: BlockId): Promise<BlockTrace | null> {
  await getSession(db, workspaceId, sessionId);
  const run = await currentRun(db, sessionId);
  const a = run ? (await currentAttempts(db, run.id)).get(block) : undefined;
  if (a && computed(a)) {
    const [row] = await db.select({ trace: t.blockAttempt.trace }).from(t.blockAttempt).where(eq(t.blockAttempt.id, a.id));
    return row.trace as BlockTrace;
  }
  if (a && a.status !== 'STALE') return null;
  const m = BLOCK_META[block];
  const at = '1970-01-01T00:00:00.000Z';
  const ev = (seq: number, kind: 'RECEIVE' | 'READ' | 'HANDOFF', title: string, explanation: string) => ({ seq, block, attempt_id: 'preview', kind, title, explanation, record_refs: [], before: {}, after: {}, draft: [], source: 'CODE' as const, computed_at: at });
  return { block, attempt_id: 'preview', records: [], input_keys: [], gates: [], expected: null, computed_at: at, events: [ev(0, 'RECEIVE', `${block} chưa chạy`, 'Bản xem trước chỉ mô tả cách block làm việc; chưa có số liệu vì chưa có lần chạy nào.'), ...m.flow.map((f, i) => ev(i + 1, 'READ', f, m.method)), ev(m.flow.length + 1, 'HANDOFF', `Bàn giao cho ${m.target}`, 'Số liệu thật xuất hiện sau khi chạy block.')] };
}

export async function getCandidate(db: Db, workspaceId: string, sessionId: string) {
  const run = await currentRun(db, sessionId);
  if (!run) return null;
  const [c] = await db.select().from(t.candidate).where(and(eq(t.candidate.runId, run.id), eq(t.candidate.workspaceId, workspaceId), inArray(t.candidate.status, ['READY', 'DECIDED', 'COMMITTED']))).orderBy(desc(t.candidate.createdAt)).limit(1);
  if (!c) return null;
  const [rel] = await db.select().from(t.release).where(and(eq(t.release.workspaceId, workspaceId), eq(t.release.candidateId, c.id)));
  const snapshot = run.snapshot as RunSnapshot;
  return { id: c.id, status: c.status, base_release_id: c.baseReleaseId, base_version_label: snapshot.base_version_label, items: c.items, decision: c.decision, receipt: rel ? { release_id: rel.releaseId, version_label: rel.versionLabel, hash: rel.receiptHash, counts: (rel.diff as any).counts, decided_by: rel.decidedBy, decided_at: new Date(rel.decidedAt).toISOString() } : null, stop: await getStop(db, workspaceId) };
}
