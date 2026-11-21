import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { AppError, MAIN_BLOCK_IDS, scrubPaths, gateBlocks, type RunStop, type StopAction, type StopCode, type BlockCard, type BlockDetail, type BlockId, type BlockTrace, type CardState, type DictFrame, type GateResult, type InputDoc, type InputEvent, type InputTask, type Lesson, type LogEntry, type PendingGuide, type ReleaseHistoryEntry, type SessionState } from '@cl/contract';
import { BLOCK_TASKS, ClaudeCliRunner, DEFAULT_AGENT_CONFIG, TASKS, getBreaker, shortModel, type BreakerState, type TaskName } from '@cl/agents';
import { appendEvent, hashJson, newId, t, type Db } from '@cl/db';
import { getStop, listReleases, loadDictionary, toDictView } from '@cl/registry';
import { runB0, runB1, runB2, runB3, runFAST } from './blocks-a';
import { runB4, runB5, runB6, runB7, runB8 } from './blocks-b';
import { BLOCK_META } from './meta';
import { currentRun, getSession, latestJdSet, listUserEvents, loadDocs } from './sessions';
import { expandTrace, policyRef, registerTraceSink, type BlockCtx, type BlockResult, type CalcRow, type CompactBeat, type RunSnapshot } from './types';
import { basisFromPrev, estimateRun, usageTokens } from './estimate';
import { BlockGuard, type AcceptOver } from './budget';
import { assertAgentsUnlocked } from './anchor';
import { escalateBatchAudit } from './production';

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
export async function writeWorkerStatus(db: Db, status: { ok: boolean; version: string | null; message: string; breaker?: BreakerState | null }) {
  const now = new Date().toISOString();
  const breaker = status.breaker === undefined ? {} : { breaker: status.breaker };
  await db.insert(t.workerStatus).values({ id: 'worker', ok: status.ok, cliVersion: status.version, message: status.message, updatedAt: now, ...breaker }).onConflictDoUpdate({ target: t.workerStatus.id, set: { ok: status.ok, cliVersion: status.version, message: status.message, updatedAt: now, ...breaker } });
}

/** Persists the worker's in-memory breaker so the web process can refuse new runs while it is open. */
export async function saveBreaker(db: Db, state: BreakerState | null = getBreaker()) {
  const updated = await db.update(t.workerStatus).set({ breaker: state }).where(eq(t.workerStatus.id, 'worker')).returning({ id: t.workerStatus.id });
  if (!updated.length) await db.insert(t.workerStatus).values({ id: 'worker', ok: false, cliVersion: null, message: 'Worker chưa ghi trạng thái.', breaker: state, updatedAt: new Date(0).toISOString() }).onConflictDoUpdate({ target: t.workerStatus.id, set: { breaker: state } });
}
/** The breaker as last persisted, or null when closed or expired. */
export async function readBreaker(db: Db): Promise<BreakerState | null> {
  const [w] = await db.select({ breaker: t.workerStatus.breaker }).from(t.workerStatus).where(eq(t.workerStatus.id, 'worker'));
  const b = (w?.breaker as BreakerState | null) ?? null;
  return b && new Date(b.until).getTime() > Date.now() ? b : null;
}
const BREAKER_TEXT: Record<BreakerState['code'], string> = { QUOTA: 'Đã chạm hạn mức Claude', NOT_LOGGED_IN: 'Claude CLI chưa đăng nhập', AI_ERROR: 'Claude CLI lỗi liên tiếp' };
export function breakerError(b: BreakerState) {
  const code = b.code === 'QUOTA' ? 'AGENT_QUOTA' : b.code === 'NOT_LOGGED_IN' ? 'AGENT_NOT_LOGGED_IN' : 'AGENT_CLI_ERROR';
  return new AppError(code, `${BREAKER_TEXT[b.code]}: cầu dao đang ngắt tới ${b.until}. Không xếp thêm lời gọi AI.`, 429, { until: b.until, breaker: b.code }, b.code === 'QUOTA' ? ['SCHEDULE'] : ['RETRY']);
}

/** Start (or return) the attempt for a block. Never computes anything itself: it only enqueues a job. */
export async function startAttempt(db: Db, workspaceId: string, sessionId: string, block: BlockId, idempotencyKey: string, opts: { rerun_tasks?: string[]; actor: string; skipAgentCheck?: boolean; reason?: 'auto' | 'resume' | 'rerun' | 'manual'; acceptOver?: AcceptOver }): Promise<PendingGuide> {
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
  if (BLOCK_TASKS[block].length) {
    const b = await readBreaker(db);
    if (b) throw breakerError(b);
    const cfg = (run.snapshot as RunSnapshot).agent_config;
    const missing = (BLOCK_TASKS[block] as TaskName[]).filter((n) => !cfg.tasks[n]);
    if (missing.length) throw new AppError('RUN_OUTDATED', `Lượt này được tạo với cấu hình agent ${cfg.version} (trước thiết kế P1), không có ${missing.join(', ')}. Tạo lượt mới; kết quả cũ vẫn xem được.`, 409, { agents: cfg.version }, ['NEW_RUN']);
    // P1.2: an agent below its anchor threshold is locked
    await assertAgentsUnlocked(db, BLOCK_TASKS[block] as TaskName[], (run.snapshot as RunSnapshot).agent_config);
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
    await tx.insert(t.blockAttempt).values({ id, workspaceId, runId: run.id, block, attemptNo: n + 1, prevAttemptId: mine?.id ?? null, idempotencyKey, status: 'QUEUED', current: true, options: { rerun, reason: opts.reason ?? (opts.rerun_tasks?.length || mine ? 'rerun' : 'manual'), ...(opts.acceptOver ? { accept_over: opts.acceptOver } : {}) } });
    await tx.insert(t.job).values({ id: newId('job'), attemptId: id, state: 'QUEUED' });
    const now = new Date().toISOString();
    await tx.insert(t.viewCursor).values({ runId: run.id, block, attemptId: id, seq: 0, acknowledgedAt: null, updatedAt: now }).onConflictDoUpdate({ target: [t.viewCursor.runId, t.viewCursor.block], set: { attemptId: id, seq: 0, acknowledgedAt: null, updatedAt: now } });
    return { id: block, cursor: 0, committed: false };
  });
}

/** A RUNNING job whose lock was not renewed for this long belongs to a dead worker (the lock is renewed every 60 s). */
const LOCK_STALE = '3 minutes';
const LOCK_RENEW_MS = Number(process.env.JOB_LOCK_RENEW_MS ?? 60000);
const MAX_TRIES = Number(process.env.JOB_MAX_TRIES ?? 3);

/** Claim one queued job (SKIP LOCKED so several workers never take the same one) and run it. */
export async function processNextJob(db: Db, runner: ClaudeCliRunner): Promise<boolean> {
  const claimed = await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`select id, attempt_id from job where state = 'QUEUED' or (state = 'RUNNING' and locked_at < now() - ${sql.raw(`interval '${LOCK_STALE}'`)}) order by created_at for update skip locked limit 1`)) as unknown as { id: string; attempt_id: string }[];
    const j = rows[0];
    if (!j) return null;
    // a job reclaimed again and again (a crash that repeats) stops instead of spending tokens forever
    const [jt] = await tx.select({ tries: t.job.tries }).from(t.job).where(eq(t.job.id, j.id));
    if ((jt?.tries ?? 0) >= MAX_TRIES) {
      await tx.update(t.job).set({ state: 'FAILED' }).where(eq(t.job.id, j.id));
      await tx.update(t.blockAttempt).set({ status: 'FAILED', error: { code: 'JOB_RETRIES', message: `Bước bị bỏ dở ${jt.tries} lần (worker dừng giữa chừng); không chạy lại tự động.`, actions: ['RETRY'] }, finishedAt: new Date().toISOString() }).where(eq(t.blockAttempt.id, j.attempt_id));
      return { ...j, exhausted: true };
    }
    const now = new Date().toISOString();
    await tx.update(t.job).set({ state: 'RUNNING', lockedAt: now, tries: sql`${t.job.tries} + 1` }).where(eq(t.job.id, j.id));
    await tx.update(t.blockAttempt).set({ status: 'RUNNING', startedAt: now, finishedAt: null }).where(eq(t.blockAttempt.id, j.attempt_id));
    return j;
  });
  if (!claimed) return false;
  if ((claimed as any).exhausted) {
    const [att] = await db.select({ runId: t.blockAttempt.runId }).from(t.blockAttempt).where(eq(t.blockAttempt.id, claimed.attempt_id));
    const [run] = att ? await db.select().from(t.run).where(eq(t.run.id, att.runId)) : [];
    if (run) await advanceAuto(db, run.workspaceId, run.sessionId).catch(() => {});
    return true;
  }
  // keep the lock fresh while the block runs, so a long block is never taken over by another worker
  const renew = setInterval(() => void db.update(t.job).set({ lockedAt: new Date().toISOString() }).where(eq(t.job.id, claimed.id)).catch(() => {}), LOCK_RENEW_MS);
  let ok = false;
  try {
    ok = await runAttempt(db, runner, claimed.attempt_id);
  } finally {
    clearInterval(renew);
  }
  await db.update(t.job).set({ state: ok ? 'DONE' : 'FAILED' }).where(eq(t.job.id, claimed.id));
  const [att] = await db.select({ runId: t.blockAttempt.runId }).from(t.blockAttempt).where(eq(t.blockAttempt.id, claimed.attempt_id));
  const [run] = att ? await db.select().from(t.run).where(eq(t.run.id, att.runId)) : [];
  if (run) await advanceAuto(db, run.workspaceId, run.sessionId).catch((e) => console.error('[auto]', e?.message ?? e));
  return true;
}

/** At worker start: jobs left RUNNING by a worker that died are queued again (their attempt restarts; stored agent answers are reused). */
/** `all`: at the start of the only worker every RUNNING job is an orphan, however fresh its lock. */
export async function requeueOrphans(db: Db, opts: { all?: boolean } = {}): Promise<number> {
  const rows = (opts.all
    ? await db.execute(sql`update job set state = 'QUEUED', locked_at = null where state = 'RUNNING' returning attempt_id`)
    : await db.execute(sql`update job set state = 'QUEUED', locked_at = null where state = 'RUNNING' and (locked_at is null or locked_at < now() - ${sql.raw(`interval '${LOCK_STALE}'`)}) returning attempt_id`)) as unknown as { attempt_id: string }[];
  if (rows.length) await db.update(t.blockAttempt).set({ status: 'QUEUED' }).where(inArray(t.blockAttempt.id, rows.map((r) => r.attempt_id)));
  return rows.length;
}

/* ------------------------------------------------------------------ auto-run and structured stops */

/**
 * Auto-run: from "start" to the B8 candidate without a click per block. The worker acknowledges each block
 * that passed (actor "auto") and queues the next one. It stops by itself at a blocked gate, an error, STOP,
 * a usage limit, a budget or an anomaly, or after B8 — it never decides the candidate and never commits to the dictionary.
 */
export async function getAuto(db: Db, runId: string) {
  const [a] = await db.select().from(t.runAuto).where(eq(t.runAuto.runId, runId));
  return { on: !!a?.on, note: a?.note ?? '', stop: (a?.stop as RunStop | null) ?? null };
}
const putAuto = (db: Db, runId: string, on: boolean, note: string, stop: RunStop | null = null) => {
  const updatedAt = new Date().toISOString();
  return db.insert(t.runAuto).values({ runId, on, note, stop, updatedAt }).onConflictDoUpdate({ target: t.runAuto.runId, set: { on, note, stop, updatedAt } });
};

const STOP_OF_ERROR: Record<string, StopCode> = {
  AGENT_QUOTA: 'QUOTA',
  BUDGET_BLOCK: 'BUDGET',
  BUDGET_RUN: 'BUDGET',
  BUDGET_EXCEEDED: 'BUDGET',
  ANOMALY_INPUT: 'ANOMALY',
  ANOMALY_CALLS: 'ANOMALY',
};
const STOP_ACTIONS: Record<StopCode, StopAction[]> = {
  QUOTA: ['RESUME', 'SCHEDULE'],
  GATE: ['OPEN_STEP', 'NEW_RUN'],
  AI_ERROR: ['OPEN_STEP', 'RETRY'],
  PAUSED: ['RESUME'],
  BUDGET: ['ACCEPT_OVER', 'OPEN_STEP'],
  ANOMALY: ['ACCEPT_OVER', 'OPEN_STEP'],
  DONE: ['REVIEW_CANDIDATE'],
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Asia/Saigon' });

/** The structured stop for a failed attempt (error stored on the attempt) or a blocked gate. */
export function stopOf(block: BlockId, a: Pick<Attempt, 'status' | 'error' | 'gates'>, progress?: { done: number; total: number }): RunStop {
  const at = new Date().toISOString();
  if (a.status === 'BLOCKED' || a.status === 'NEEDS_INPUT') {
    const failed = ((a.gates as GateResult[]) ?? []).filter(gateBlocks);
    const g = failed[0];
    return { code: 'GATE', block, message: `Dừng ở ${block} · ${g ? `cổng "${g.name}" chặn. Cần ${g.criterion}; thực tế ${typeof g.actual === 'string' ? g.actual : JSON.stringify(g.actual)}` : 'cổng chặn'}.`, cause: g?.gate_id, actions: STOP_ACTIONS.GATE, details: { gates: failed.map((x) => ({ gate_id: x.gate_id, name: x.name, actual: x.actual, criterion: x.criterion })) }, at };
  }
  const err = (a.error ?? {}) as { code?: string; message?: string; details?: any };
  const code = STOP_OF_ERROR[err.code ?? ''] ?? 'AI_ERROR';
  const saved = progress ? ` ${progress.done}/${progress.total} lời gọi đã lưu.` : '';
  const until = err.details?.until ?? null;
  const message =
    code === 'QUOTA'
      ? `Dừng ở ${block} · hết hạn mức của Claude CLI.${saved}${until ? ` Hạn mức hồi lúc ${hhmm(until)}.` : ''}`
      : code === 'BUDGET'
        ? `Dừng ở ${block} · vượt ngân sách token. ${err.message ?? ''}`
        : code === 'ANOMALY'
          ? `Dừng ở ${block} · bất thường, chờ xác nhận. ${err.message ?? ''}`
          : `Dừng ở ${block} · lỗi ${err.code ?? ''}: ${err.message ?? ''}`;
  return { code, block, message: message.trim().slice(0, 600), cause: err.code, actions: STOP_ACTIONS[code], until, details: err.details ?? undefined, at };
}

export async function setAuto(db: Db, workspaceId: string, sessionId: string, on: boolean, actor: string) {
  const run = await currentRun(db, sessionId);
  if (!run || run.workspaceId !== workspaceId) throw new AppError('NO_RUN', 'Phiên chưa có lượt chạy. Thêm JD và tạo lượt trước.', 409, undefined, ['CREATE_RUN']);
  if (on) {
    const ws = await workerStatus(db);
    if (!ws.ok) throw new AppError('AGENT_CLI_UNAVAILABLE', ws.message, 503, undefined, ['RETRY']);
    const b = await readBreaker(db);
    if (b) throw breakerError(b);
  }
  const cur = on ? null : await currentAttempts(db, run.id);
  const next = cur ? (MAIN_BLOCK_IDS.find((b) => cur.get(b)?.status !== 'DONE') ?? null) : null;
  const paused: RunStop | null = on ? null : { code: 'PAUSED', block: next, message: `Tạm dừng theo yêu cầu${next ? `, trước khi xong ${next}` : ''}. Bước đang chạy (nếu có) vẫn chạy nốt.`, actions: STOP_ACTIONS.PAUSED, at: new Date().toISOString() };
  await putAuto(db, run.id, on, on ? 'Đang chạy tự động.' : paused!.message, paused);
  await appendEvent(db, { workspaceId, type: on ? 'AUTO_STARTED' : 'AUTO_STOPPED', actor, sessionId, runId: run.id, payload: on ? {} : { stop: paused } });
  if (on) await advanceAuto(db, workspaceId, sessionId);
  return getAuto(db, run.id);
}

export async function advanceAuto(db: Db, workspaceId: string, sessionId: string): Promise<void> {
  const run = await currentRun(db, sessionId);
  if (!run || !(await getAuto(db, run.id)).on) return;
  const halt = async (stop: RunStop) => {
    await putAuto(db, run.id, false, stop.message, stop);
    await appendEvent(db, { workspaceId, type: 'RUN_STOPPED', actor: 'auto', sessionId, runId: run.id, block: stop.block, payload: stop as any });
  };
  const at = () => new Date().toISOString();
  if (run.status === 'COMPLETE') return void (await halt({ code: 'DONE', block: 'B8', message: 'Lượt đã công bố.', actions: [], at: at() }));
  if (await getStop(db, workspaceId)) return void (await halt({ code: 'GATE', block: null, message: 'Dừng: workspace đang STOP.', cause: 'WORKSPACE_STOPPED', actions: ['OPEN_STEP'], at: at() }));
  const cur = await currentAttempts(db, run.id);
  const cs = await cursors(db, run.id);
  for (const [b, a] of cur) {
    if (a.status === 'STALE') continue;
    if (a.status === 'QUEUED' || a.status === 'RUNNING') return; // the worker comes back here when it finishes
    if (a.status === 'FAILED' || a.status !== 'DONE') return void (await halt(stopOf(b, a, await savedCalls(db, a.id))));
    if (!cs.get(b)?.acknowledgedAt) await acknowledge(db, workspaceId, sessionId, b, 'auto');
  }
  const next = MAIN_BLOCK_IDS.find((b) => cur.get(b)?.status !== 'DONE');
  if (!next) return void (await halt({ code: 'DONE', block: 'B8', message: 'Đã chạy xong B0–B8. Hồ sơ DỰ KIẾN chờ bạn duyệt để ghi vào từ điển.', actions: STOP_ACTIONS.DONE, at: at() }));
  try {
    await startAttempt(db, workspaceId, sessionId, next, `auto-${newId('k')}`, { actor: 'auto', reason: 'auto' });
  } catch (e: any) {
    const code: StopCode = e?.code === 'AGENT_QUOTA' ? 'QUOTA' : e?.code?.startsWith?.('AGENT_') ? 'AI_ERROR' : 'GATE';
    await halt({ code, block: next, message: `Dừng trước ${next}: ${e?.message ?? e}`.slice(0, 300), cause: e?.code, actions: STOP_ACTIONS[code], until: e?.details?.until ?? null, at: at() });
  }
}
/** Calls of an attempt that finished OK (answers stored), against all calls it issued. */
async function savedCalls(db: Db, attemptId: string) {
  const [p] = await db.select().from(t.attemptProgress).where(eq(t.attemptProgress.attemptId, attemptId));
  const steps = ((p?.steps as any[]) ?? []) as { total: number; done: number }[];
  return steps.length ? { done: steps.reduce((a, s) => a + s.done, 0), total: steps.reduce((a, s) => a + s.total, 0) } : undefined;
}

/**
 * "Chạy tiếp": turn auto-run back on and, if the run stopped on a failed block, queue that block again
 * (stored agent answers are reused, so only the missing calls go to the CLI). With `acceptOver` the check
 * that stopped the block (input anomaly, call anomaly or budget) is lifted for that one attempt, and the
 * confirmation is recorded as an event with the person who gave it.
 */
export async function resumeRun(db: Db, workspaceId: string, sessionId: string, opts: { actor: string; acceptOver?: boolean; runId?: string }) {
  const run = await currentRun(db, sessionId);
  if (!run || run.workspaceId !== workspaceId) throw new AppError('NO_RUN', 'Phiên chưa có lượt chạy.', 409, undefined, ['CREATE_RUN']);
  if (opts.runId && opts.runId !== run.id) throw new AppError('RUN_NOT_CURRENT', 'Lượt này không còn là lượt hiện tại của phiên.', 409);
  const b = await readBreaker(db);
  if (b) throw breakerError(b);
  const ws = await workerStatus(db);
  if (!ws.ok) throw new AppError('AGENT_CLI_UNAVAILABLE', ws.message, 503, undefined, ['RETRY']);
  const { stop } = await getAuto(db, run.id);
  const cur = await currentAttempts(db, run.id);
  const failed = MAIN_BLOCK_IDS.find((x) => cur.get(x)?.status === 'FAILED');
  let accept: AcceptOver | undefined;
  const cause = ((failed ? (cur.get(failed)!.error as any)?.code : stop?.cause) ?? '') as string;
  // a stop on budget or anomaly is never lifted by a plain resume (or a scheduled one): only by "accept over"
  if (!opts.acceptOver && /^(BUDGET_|ANOMALY_)/.test(cause)) throw new AppError('ACCEPT_OVER_REQUIRED', 'Lượt dừng vì ngân sách hoặc bất thường: cần "Chạy tiếp, chấp nhận vượt" có người xác nhận.', 409, { cause }, ['ACCEPT_OVER']);
  if (opts.acceptOver) {
    // what was accepted on the stopped attempt of this block stays accepted: otherwise a block over two limits
    // (calls and tokens) stops on the other one at every accept, endlessly (Data Engineer B6, 21/11/2026)
    const prev = ((failed ? (cur.get(failed)!.options as any)?.accept_over : null) ?? {}) as AcceptOver;
    accept = { input: cause === 'ANOMALY_INPUT' || !!prev.input, calls: cause === 'ANOMALY_CALLS' || !!prev.calls, budget: cause === 'BUDGET_BLOCK' || !!prev.budget, run: cause === 'BUDGET_RUN' || !!prev.run, run_calls: cause === 'BUDGET_EXCEEDED' || !!prev.run_calls, by: opts.actor, at: new Date().toISOString() };
    if (!accept.input && !accept.calls && !accept.budget && !accept.run && !accept.run_calls) throw new AppError('NOTHING_TO_ACCEPT', 'Lượt không dừng vì ngân sách hay bất thường nên không có gì để chấp nhận vượt.', 409);
    await appendEvent(db, { workspaceId, type: 'OVER_ACCEPTED', actor: opts.actor, sessionId, runId: run.id, block: failed ?? stop?.block ?? null, payload: { cause, accept, stop } });
  }
  // queue first, switch auto on only once that worked (a refused start must not leave auto on with nothing queued)
  if (failed) await startAttempt(db, workspaceId, sessionId, failed, `resume-${newId('k')}`, { actor: opts.actor, reason: 'resume', acceptOver: accept });
  await putAuto(db, run.id, true, 'Đang chạy tự động.', null);
  await appendEvent(db, { workspaceId, type: 'AUTO_STARTED', actor: opts.actor, sessionId, runId: run.id, payload: { resume: true, accept_over: !!accept } });
  if (!failed) await advanceAuto(db, workspaceId, sessionId);
  return getAuto(db, run.id);
}
export async function pauseRun(db: Db, workspaceId: string, sessionId: string, actor: string) {
  return setAuto(db, workspaceId, sessionId, false, actor);
}
/** Resume by itself when the usage limit resets (or at a given time). The worker checks scheduled runs in its loop. */
export async function scheduleRun(db: Db, workspaceId: string, sessionId: string, actor: string, at?: string | null) {
  const run = await currentRun(db, sessionId);
  if (!run || run.workspaceId !== workspaceId) throw new AppError('NO_RUN', 'Phiên chưa có lượt chạy.', 409);
  const auto = await getAuto(db, run.id);
  const when = at ?? auto.stop?.until ?? (await readBreaker(db))?.until ?? null;
  if (!when || Number.isNaN(Date.parse(when))) throw new AppError('NO_TIME', 'Không biết giờ hồi hạn mức; nhập giờ muốn chạy.', 422);
  const stop: RunStop = { ...(auto.stop ?? { code: 'PAUSED', block: null, message: 'Tạm dừng.', actions: ['RESUME'], at: new Date().toISOString() }), scheduled_for: new Date(when).toISOString(), scheduled_by: actor };
  await putAuto(db, run.id, false, `${stop.message} Hẹn chạy tiếp lúc ${hhmm(stop.scheduled_for!)}.`, stop);
  await appendEvent(db, { workspaceId, type: 'RUN_SCHEDULED', actor, sessionId, runId: run.id, payload: { at: stop.scheduled_for } });
  return getAuto(db, run.id);
}
/** Worker loop: resume runs whose scheduled time has come (one per call). */
export async function processScheduled(db: Db): Promise<boolean> {
  const rows = await db.select({ runId: t.runAuto.runId, stop: t.runAuto.stop }).from(t.runAuto).where(and(eq(t.runAuto.on, false), sql`(${t.runAuto.stop} ->> 'scheduled_for') is not null and (${t.runAuto.stop} ->> 'scheduled_for')::timestamptz <= now()`)).limit(1);
  const r = rows[0];
  if (!r) return false;
  const [run] = await db.select().from(t.run).where(eq(t.run.id, r.runId));
  const stop = r.stop as RunStop;
  // the schedule is consumed first, so it can never fire twice (and never for another run)
  const { scheduled_for: _sf, ...rest } = stop;
  await putAuto(db, r.runId, false, stop.message, rest as RunStop);
  if (!run) return true;
  try {
    await resumeRun(db, run.workspaceId, run.sessionId, { actor: stop.scheduled_by ?? 'schedule', runId: run.id });
  } catch (e: any) {
    const until = e?.code === 'AGENT_QUOTA' ? (e?.details?.until ?? null) : null;
    // still limited: move the schedule to the new reset time; otherwise drop it and say why
    await putAuto(db, run.id, false, `Hẹn giờ không chạy được: ${e?.message ?? e}`.slice(0, 300), { ...rest, ...(until ? { scheduled_for: until } : {}), message: `${stop.message} Hẹn giờ không chạy được: ${e?.message ?? e}`.slice(0, 600) } as RunStop);
  }
  return true;
}

/* ------------------------------------------------------------------ one block attempt */

async function attemptUsage(db: Db, attemptId: string) {
  const rows = await db.select({ usage: t.agentCall.usage, cost: t.agentCall.costUsd, cacheHit: t.agentCall.cacheHit, status: t.agentCall.status }).from(t.agentCall).where(eq(t.agentCall.attemptId, attemptId));
  return {
    calls: rows.filter((r) => !r.cacheHit).length,
    cached: rows.filter((r) => r.cacheHit).length,
    failed: rows.filter((r) => r.status !== 'OK').length,
    tokens: rows.reduce((a, r) => a + usageTokens(r.usage), 0),
    cost_usd: Math.round(rows.reduce((a, r) => a + (r.cost ?? 0), 0) * 10000) / 10000,
  };
}

export async function runAttempt(db: Db, runner: ClaudeCliRunner, attemptId: string): Promise<boolean> {
  const [att] = await db.select().from(t.blockAttempt).where(eq(t.blockAttempt.id, attemptId));
  if (!att) return false;
  const block = att.block as BlockId;
  const [run] = await db.select().from(t.run).where(eq(t.run.id, att.runId));
  const snapshot = run.snapshot as RunSnapshot;
  const started = att.startedAt ?? new Date().toISOString();
  if (!att.startedAt) await db.update(t.blockAttempt).set({ startedAt: started }).where(eq(t.blockAttempt.id, attemptId));
  const options = (att.options ?? {}) as { rerun?: Record<string, number>; reason?: string; accept_over?: AcceptOver };
  const abort = new AbortController();
  const stats = { blocked: 0, inflight: new Set<Promise<unknown>>() };
  const base = { workspaceId: att.workspaceId, sessionId: run.sessionId, runId: run.id, attemptId, block };
  let guard: BlockGuard | null = null;
  // beats and calculations are written while the block runs (a requeued attempt starts from a clean slate)
  await db.delete(t.traceEvent).where(eq(t.traceEvent.attemptId, attemptId));
  await db.delete(t.calcRecord).where(eq(t.calcRecord.attemptId, attemptId));
  let writes: Promise<unknown> = Promise.resolve();
  const chunks = <T,>(xs: T[], n = 500) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const unregister = registerTraceSink(attemptId, {
    beats: (rows: CompactBeat[]) =>
      (writes = writes.then(async () => {
        for (const part of chunks(rows)) await db.insert(t.traceEvent).values(part.map((r) => ({ attemptId, seq: r.seq, event: r }))).onConflictDoNothing();
      })) as Promise<void>,
    calcs: (rows: CalcRow[]) =>
      (writes = writes.then(async () => {
        for (const part of chunks(rows)) await db.insert(t.calcRecord).values(part.map((r) => ({ attemptId, seq: r.seq, step: r.step, substep: r.substep, itemRef: r.item_ref ?? null, formula: r.formula, inputs: r.inputs, output: r.output ?? null, decision: r.decision ?? null, seat: r.seat ?? null }))).onConflictDoNothing();
      })) as Promise<void>,
  });
  // waits until no more trace/calc writes are chained (a flush may chain another one while we wait)
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 0));
      const w = writes;
      await w.catch(() => {});
      if (w === writes) break;
    }
  };
  try {
    const docs = await loadDocs(db, att.workspaceId, snapshot.documents);
    const cur = await currentAttempts(db, run.id);
    const prev: BlockCtx['prev'] = {};
    const prevGates: BlockCtx['prevGates'] = {};
    for (const [b, a] of cur) if (a.status === 'DONE' && b !== block) (prev[b] = a.output as any), (prevGates[b] = a.gates as GateResult[]);
    const est = block === 'FAST' ? null : estimateRun(basisFromPrev(snapshot.documents.length, prev, { events: snapshot.events.length, rubric: snapshot.rubric.length, seats: snapshot.agent_config.seats.length }), snapshot.agent_config).blocks.find((x) => x.block === block)!;
    guard = await new BlockGuard(block, snapshot.budget, est?.calls ?? 0, options.accept_over).init(db, run.id, attemptId);
    await appendEvent(db, { ...base, type: 'BLOCK_STARTED', actor: 'worker', payload: { attempt_no: att.attemptNo, reason: options.reason ?? 'manual', started_at: started, items: est ? { calls: est.calls, tokens: est.tokens, tasks: est.tasks.map((x) => ({ task_id: x.task_id, calls: x.calls })) } : null, limits: guard.snapshot(), accept_over: options.accept_over ?? null } });
    const baseDict = await loadDictionary(db, att.workspaceId, snapshot.base_release_id);
    const status = await runner.status();
    const now = started;
    const ctx: BlockCtx = { block, attemptId, runId: run.id, workspaceId: att.workspaceId, snapshot, docs, base: baseDict, prev, prevGates, now, agent: { db, runner, config: snapshot.agent_config, workspaceId: att.workspaceId, runId: run.id, attemptId, sessionId: run.sessionId, rerun: options.rerun ?? {}, cliVersion: status.version, abort, stats, guard, ...(options.accept_over?.run_calls ? { maxCallsPerRun: Number(process.env.AGENT_MAX_CALLS_PER_RUN ?? 3000) * 2 } : {}) } };
    const inputHash = hashJson({ block, snapshot: hashJson(snapshot), prev: Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, hashJson(v)])) });
    const res = await RUNNERS[block](ctx);
    await settle();
    const output = { ...res.output, __view: res.view, __ai: res.ai };
    const outputHash = hashJson(res.output);
    const finished = new Date().toISOString();
    await db.update(t.blockAttempt).set({ status: res.status, inputHash, output, outputHash, gates: res.gates, trace: res.trace, error: null, computedAt: finished, finishedAt: finished }).where(eq(t.blockAttempt.id, attemptId));
    await appendEvent(db, { ...base, type: 'JOB_RESULT', actor: 'worker', inputHash, outputHash, versions: { policy: policyRef(snapshot.policy), agents: snapshot.agent_config.version, cli: status.version }, payload: { status: res.status, attempt_no: att.attemptNo, ai: res.ai, summary: res.view.handoff } });
    await appendEvent(db, { ...base, type: 'GATE_RESULT', actor: 'worker', payload: { gates: res.gates.map((g) => ({ gate_id: g.gate_id, name: g.name, status: g.status, actual: g.actual, criterion: g.criterion, required: g.required, reason: g.reason })) } });
    // P5.4: a failed audit in a batch puts every framework of the batch in the audit sample
    if (block === 'B7' && res.status !== 'DONE') await escalateBatchAudit(db, att.workspaceId, run.sessionId).catch(() => 0);
    const usage = await attemptUsage(db, attemptId);
    if (res.status === 'DONE') await appendEvent(db, { ...base, type: 'BLOCK_DONE', actor: 'worker', payload: { attempt_no: att.attemptNo, started_at: started, finished_at: finished, duration_ms: Date.parse(finished) - Date.parse(started), ...usage, gates: res.gates.map((g) => ({ gate_id: g.gate_id, status: g.status })) } });
    else await appendEvent(db, { ...base, type: 'BLOCK_STOPPED', actor: 'worker', payload: { attempt_no: att.attemptNo, started_at: started, finished_at: finished, duration_ms: Date.parse(finished) - Date.parse(started), ...usage, stop: stopOf(block, { status: res.status, error: null, gates: res.gates }) } });
    return true;
  } catch (e: any) {
    abort.abort(e); // calls still waiting for a CLI slot are dropped, not spawned
    const err = e instanceof AppError ? { code: e.code, message: scrubPaths(e.message), actions: e.actions, ...(e.details && typeof e.details === 'object' ? { details: e.details } : {}) } : { code: 'INTERNAL', message: scrubPaths(String(e?.message ?? e)).slice(0, 500), actions: ['RETRY'] };
    const finished = new Date().toISOString();
    // The draft of earlier blocks is untouched; this attempt just records why it stopped.
    await db.update(t.blockAttempt).set({ status: 'FAILED', error: err, computedAt: finished, finishedAt: finished }).where(eq(t.blockAttempt.id, attemptId));
    await appendEvent(db, { ...base, type: 'JOB_RESULT', actor: 'worker', payload: { status: 'FAILED', attempt_no: att.attemptNo, error: err } });
    // calls already spawned finish (or time out) before the stop is recorded, so its counts and the next attempt's budget are right
    await Promise.race([Promise.allSettled([...stats.inflight]), new Promise((r) => setTimeout(r, runner.timeoutMs + 5000))]);
    if (stats.blocked) await appendEvent(db, { ...base, type: 'CALLS_BLOCKED', actor: 'worker', payload: { blocked: stats.blocked, breaker: getBreaker()?.code ?? null } });
    const usage = await attemptUsage(db, attemptId);
    await appendEvent(db, { ...base, type: 'BLOCK_STOPPED', actor: 'worker', payload: { attempt_no: att.attemptNo, started_at: started, finished_at: finished, duration_ms: Date.parse(finished) - Date.parse(started), ...usage, blocked: stats.blocked, limits: guard?.snapshot() ?? null, stop: stopOf(block, { status: 'FAILED', error: err, gates: null }, await savedCalls(db, attemptId)) } });
    const b = getBreaker();
    if (b) await saveBreaker(db, b).catch(() => {});
    return false;
  } finally {
    unregister();
    await settle();
  }
}

/** Beats of an attempt written so far (also while it runs), from `since` (exclusive). */
export async function attemptTrace(db: Db, workspaceId: string, attemptId: string, since = -1) {
  const [a] = await db.select({ id: t.blockAttempt.id, block: t.blockAttempt.block, status: t.blockAttempt.status, workspaceId: t.blockAttempt.workspaceId }).from(t.blockAttempt).where(eq(t.blockAttempt.id, attemptId));
  if (!a || a.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không có lần chạy này.', 404);
  const rows = await db.select().from(t.traceEvent).where(and(eq(t.traceEvent.attemptId, attemptId), sql`${t.traceEvent.seq} > ${since}`)).orderBy(asc(t.traceEvent.seq)).limit(2000);
  return { attempt_id: a.id, block: a.block as BlockId, status: a.status, running: a.status === 'RUNNING' || a.status === 'QUEUED', beats: rows.map((r) => r.event as CompactBeat), next: rows.at(-1)?.seq ?? since };
}
/** Calculation records of an attempt, optionally for one sub-step. */
export async function attemptCalc(db: Db, workspaceId: string, attemptId: string, substep?: string) {
  const [a] = await db.select({ workspaceId: t.blockAttempt.workspaceId }).from(t.blockAttempt).where(eq(t.blockAttempt.id, attemptId));
  if (!a || a.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không có lần chạy này.', 404);
  const rows = await db.select().from(t.calcRecord).where(and(eq(t.calcRecord.attemptId, attemptId), ...(substep ? [eq(t.calcRecord.substep, substep)] : []))).orderBy(asc(t.calcRecord.seq)).limit(5000);
  const substeps = await db.select({ substep: t.calcRecord.substep, n: sql<number>`count(*)::int` }).from(t.calcRecord).where(eq(t.calcRecord.attemptId, attemptId)).groupBy(t.calcRecord.substep);
  return { attempt_id: attemptId, substeps, rows: rows.map((r) => ({ seq: r.seq, step: r.step, substep: r.substep, item_ref: r.itemRef, formula: r.formula, inputs: r.inputs, output: r.output, decision: r.decision, seat: r.seat })) };
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
  return { kind: 'AI', tasks: names.filter((n) => n !== 'T9' || (snapshot?.rubric.length ?? 0) > 0).map((n) => ({ task_id: TASKS[n].id, model: n === 'T9' || n === 'T11' ? (cfg?.seats ?? []).map((s) => shortModel(s.model)).join('/') || '3 ghế' : shortModel((cfg?.tasks[n] ?? DEFAULT_AGENT_CONFIG.tasks[n])?.model ?? ''), effort: (cfg?.tasks[n] ?? DEFAULT_AGENT_CONFIG.tasks[n])?.effort ?? '' })) };
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
  BLOCK_STARTED: (p) => `Bắt đầu (lần ${p.attempt_no}, ${p.reason === 'auto' ? 'tự động' : p.reason === 'resume' ? 'chạy tiếp' : p.reason === 'rerun' ? 'chạy lại' : 'bấm chạy'})${p.items?.calls ? ` · ước tính ${p.items.calls} lời gọi` : ''}.`,
  BLOCK_DONE: (p) => `Xong sau ${Math.round((p.duration_ms ?? 0) / 1000)} giây · ${p.calls} lời gọi mới, ${p.cached} dùng lại · ${Math.round((p.tokens ?? 0) / 1000)} nghìn token · ${p.cost_usd} USD.`,
  BLOCK_STOPPED: (p) => p.stop?.message ?? 'Bước dừng.',
  CALLS_BLOCKED: (p) => `Cầu dao chặn ${p.blocked} lời gọi (không sinh tiến trình claude).`,
  RUN_STOPPED: (p) => p.message ?? 'Lượt dừng.',
  RUN_SCHEDULED: (p) => `Hẹn chạy tiếp lúc ${p.at}.`,
  RUN_WARNING: (p) => `Cảnh báo ${p.code}: ${p.message ?? ''}`,
  OVER_ACCEPTED: (p) => `Người vận hành chấp nhận vượt (${p.cause}).`,
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
  const auto = run ? await getAuto(db, run.id) : { on: false, note: '', stop: null };
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
    auto: { on: auto.on, note: auto.note, stop: auto.stop, running: auto.on ? (pendingBlock ?? null) : null },
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
  if (!a) return staticDetail(block, 'not_run', run ? 'Block chưa chạy. Mở thẻ không tạo job và không gọi agent.' : 'Phiên chưa có lượt chạy.');
  return detailOf(block, a);
}
function detailOf(block: BlockId, a: Pick<Attempt, 'id' | 'status' | 'error' | 'output' | 'gates' | 'computedAt'>): BlockDetail {
  const m = BLOCK_META[block];
  if (a.status === 'QUEUED' || a.status === 'RUNNING') return { ...staticDetail(block, 'running', 'Worker đang tính block này…'), computed_at: undefined };
  if (a.status === 'FAILED') return { ...staticDetail(block, 'error', 'Lần chạy này lỗi. Bản nháp của các block trước được giữ nguyên.'), error: { code: (a.error as any)?.code ?? 'INTERNAL', message: (a.error as any)?.message ?? '', attempt_id: a.id } };
  const o = a.output as any;
  const v = o.__view;
  const { __view: _v, __ai: _a, ...raw } = o;
  return { id: block, name: m.name, agent: m.agent, method: m.method, state: block === 'FAST' && a.status === 'DONE' ? 'trial' : a.status === 'DONE' ? 'actual_pass' : 'actual_blocked', input: v.input, flow: [...m.flow], output: v.output, rows: v.rows, calc: v.calc, gates: a.gates as GateResult[], notes: [...v.notes, ...(a.status === 'STALE' ? ['Kết quả này đã cũ: một block trước đó được chạy lại.'] : [])], handoff: v.handoff, handoffTarget: m.target, visual: v.visual, raw, computed_at: a.computedAt ? new Date(a.computedAt).toISOString() : undefined };
}
/** Detail of any attempt (old runs, earlier attempts), for the step screen. */
export async function attemptDetail(db: Db, workspaceId: string, attemptId: string): Promise<BlockDetail> {
  const { trace: _trace, ...cols } = getTableColumns(t.blockAttempt);
  const [a] = await db.select(cols).from(t.blockAttempt).where(eq(t.blockAttempt.id, attemptId));
  if (!a || a.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không có lần chạy này.', 404);
  return detailOf(a.block as BlockId, a);
}

const LOG_TYPES = ['BLOCK_STARTED', 'BLOCK_DONE', 'BLOCK_STOPPED', 'CALLS_BLOCKED', 'RUN_STOPPED', 'RUN_SCHEDULED', 'RUN_WARNING', 'OVER_ACCEPTED', 'AUTO_STARTED', 'AUTO_STOPPED', 'JOB_RESULT', 'STOP_RAISED', 'STOP_CLEARED', 'RUN_CREATED', 'INPUT_LOCKED'];
const STOPPY = new Set(['BLOCK_STOPPED', 'CALLS_BLOCKED', 'RUN_STOPPED', 'RUN_WARNING', 'OVER_ACCEPTED', 'STOP_RAISED']);
/** The run's log, newest first; `stops` keeps only stops, errors and warnings (the "Khi lượt dừng" log). */
export async function runLog(db: Db, workspaceId: string, runId: string, filter: 'all' | 'stops' = 'all') {
  const [run] = await db.select({ workspaceId: t.run.workspaceId, runNo: t.run.runNo }).from(t.run).where(eq(t.run.id, runId));
  if (!run || run.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không có lượt này.', 404);
  const rows = await db.select().from(t.event).where(and(eq(t.event.runId, runId), inArray(t.event.type, LOG_TYPES))).orderBy(desc(t.event.seq)).limit(500);
  return rows
    .filter((e) => filter === 'all' || STOPPY.has(e.type) || (e.type === 'JOB_RESULT' && (e.payload as any)?.status === 'FAILED'))
    .filter((e) => e.type !== 'JOB_RESULT' || (e.payload as any)?.status === 'FAILED')
    .map((e) => ({ seq: e.seq, type: e.type, block: e.block, actor: e.actor, time: new Date(e.serverTime).toISOString(), summary: (EVENT_TEXT[e.type] ?? (() => e.type))(e.payload) }));
}

/** Beats of the current attempt. `null` while the worker is still computing. A block that has not run yields a short, number-free description. */
export async function getTrace(db: Db, workspaceId: string, sessionId: string, block: BlockId): Promise<BlockTrace | null> {
  await getSession(db, workspaceId, sessionId);
  const run = await currentRun(db, sessionId);
  const a = run ? (await currentAttempts(db, run.id)).get(block) : undefined;
  if (a && computed(a)) {
    const [row] = await db.select({ trace: t.blockAttempt.trace }).from(t.blockAttempt).where(eq(t.blockAttempt.id, a.id));
    return expandTrace(row.trace);
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
