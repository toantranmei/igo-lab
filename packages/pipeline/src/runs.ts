import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError, MAIN_BLOCK_IDS, gateBlocks, type BlockId, type GateResult, type ProgressStep, type RunStop } from '@cl/contract';
import { TASKS } from '@cl/agents';
import { t, type Db } from '@cl/db';
import { loadDictionary } from '@cl/registry';
import { BLOCK_META } from './meta';
import { currentRun } from './sessions';
import { getAuto, readBreaker, stopOf } from './runtime';
import type { RunSnapshot } from './types';

/**
 * Token and cost accounting (spec P0.8) and the read side of the "Lượt chạy" screen (P0.13–P0.16).
 * Everything here only reads: agent_call, block_attempt, attempt_progress, run_auto, event.
 */

/** Cost (API-price equivalent) at which the 16/11 run hit the 5-hour limit. The CLI does not report the share used in -p mode. */
export const QUOTA_MARK_USD = 39.5;

export interface TokenSplit {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
  total: number;
  cost_usd: number;
  calls: number;
  cached: number;
  failed: number;
}
const zero = (): TokenSplit => ({ input: 0, cache_write: 0, cache_read: 0, output: 0, total: 0, cost_usd: 0, calls: 0, cached: 0, failed: 0 });
export function splitOf(u: any): Pick<TokenSplit, 'input' | 'cache_write' | 'cache_read' | 'output' | 'total'> {
  const input = Number(u?.input_tokens) || 0, cache_write = Number(u?.cache_creation_input_tokens) || 0, cache_read = Number(u?.cache_read_input_tokens) || 0, output = Number(u?.output_tokens) || 0;
  return { input, cache_write, cache_read, output, total: input + cache_write + cache_read + output };
}
function add(acc: TokenSplit, row: { usage: unknown; costUsd: number | null; cacheHit: boolean; status: string }) {
  if (row.cacheHit) return void acc.cached++;
  const s = splitOf(row.usage);
  acc.input += s.input;
  acc.cache_write += s.cache_write;
  acc.cache_read += s.cache_read;
  acc.output += s.output;
  acc.total += s.total;
  acc.cost_usd += row.costUsd ?? 0;
  acc.calls++;
  if (row.status !== 'OK') acc.failed++;
}
const round = <T extends TokenSplit>(x: T): T => ({ ...x, cost_usd: Math.round(x.cost_usd * 10000) / 10000 });
const quotaShare = (usd: number) => ({ usd: Math.round(usd * 100) / 100, pct: Math.round((usd / QUOTA_MARK_USD) * 1000) / 10, mark_usd: QUOTA_MARK_USD, estimated: true as const, note: `Ước lượng: chi phí quy đổi so với mốc ${QUOTA_MARK_USD} USD mà lượt 16/11 chạm hạn mức 5 giờ. CLI không trả phần hạn mức đã dùng.` });

async function loadRun(db: Db, workspaceId: string, runId: string) {
  const [run] = await db.select().from(t.run).where(eq(t.run.id, runId));
  if (!run || run.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không có lượt này.', 404);
  return run;
}
const attemptCols = { id: t.blockAttempt.id, block: t.blockAttempt.block, attemptNo: t.blockAttempt.attemptNo, status: t.blockAttempt.status, current: t.blockAttempt.current, options: t.blockAttempt.options, gates: t.blockAttempt.gates, error: t.blockAttempt.error, startedAt: t.blockAttempt.startedAt, finishedAt: t.blockAttempt.finishedAt, computedAt: t.blockAttempt.computedAt, createdAt: t.blockAttempt.createdAt, inputHash: t.blockAttempt.inputHash, outputHash: t.blockAttempt.outputHash };

/** Token split per call, task, block and run. */
export async function runUsage(db: Db, workspaceId: string, runId: string) {
  await loadRun(db, workspaceId, runId);
  const atts = await db.select({ id: t.blockAttempt.id, block: t.blockAttempt.block }).from(t.blockAttempt).where(eq(t.blockAttempt.runId, runId));
  const blockOf = new Map(atts.map((a) => [a.id, a.block as BlockId]));
  const calls = await db.select({ attemptId: t.agentCall.attemptId, taskId: t.agentCall.taskId, usage: t.agentCall.usage, costUsd: t.agentCall.costUsd, cacheHit: t.agentCall.cacheHit, status: t.agentCall.status }).from(t.agentCall).where(eq(t.agentCall.runId, runId));
  const run = zero();
  const byBlock = new Map<string, TokenSplit>();
  const byTask = new Map<string, TokenSplit & { task_id: string; block: string }>();
  for (const c of calls) {
    const b = (c.attemptId && blockOf.get(c.attemptId)) || '—';
    add(run, c);
    add(byBlock.get(b) ?? (byBlock.set(b, zero()), byBlock.get(b)!), c);
    const k = `${b}|${c.taskId}`;
    add(byTask.get(k) ?? (byTask.set(k, { ...zero(), task_id: c.taskId, block: b }), byTask.get(k)!), c);
  }
  return {
    run_id: runId,
    total: round(run),
    blocks: [...byBlock.entries()].map(([block, v]) => ({ block, ...round(v) })).sort((a, b) => a.block.localeCompare(b.block)),
    tasks: [...byTask.values()].map(round).sort((a, b) => b.cost_usd - a.cost_usd),
    quota: quotaShare(run.cost_usd),
  };
}

/** Calls of one attempt; identical errors collapse into one row with a count. */
export async function attemptCalls(db: Db, workspaceId: string, attemptId: string, f: { task?: string | null; status?: string | null; sort?: 'cost' | 'time' | 'tokens' } = {}) {
  const [a] = await db.select({ workspaceId: t.blockAttempt.workspaceId, block: t.blockAttempt.block }).from(t.blockAttempt).where(eq(t.blockAttempt.id, attemptId));
  if (!a || a.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không có lần chạy này.', 404);
  const rows = await db.select().from(t.agentCall).where(eq(t.agentCall.attemptId, attemptId)).orderBy(asc(t.agentCall.startedAt));
  const all = rows.map((r) => ({ id: r.id, task_id: r.taskId, status: r.cacheHit ? 'CACHED' : r.status, model: r.model, effort: r.effort, started_at: new Date(r.startedAt).toISOString(), duration_ms: r.durationMs, ...splitOf(r.usage), cost_usd: r.costUsd ?? 0, error: r.error, task_key: r.taskKey }));
  const filtered = all.filter((r) => (!f.task || r.task_id === f.task) && (!f.status || r.status === f.status));
  const ok = filtered.filter((r) => !r.error);
  const errs = new Map<string, (typeof all)[number] & { count: number; ids: string[] }>();
  for (const r of filtered.filter((x) => x.error)) {
    const key = `${r.task_id}|${r.status}|${(r.error ?? '').replace(/\d+/g, '#').slice(0, 160)}`;
    const g = errs.get(key);
    if (g) (g.count++, g.ids.push(r.id), (g.cost_usd += r.cost_usd), (g.total += r.total));
    else errs.set(key, { ...r, count: 1, ids: [r.id] });
  }
  const list = [...ok.map((r) => ({ ...r, count: 1, ids: [r.id] })), ...errs.values()];
  const by = f.sort ?? 'cost';
  list.sort((x, y) => (by === 'time' ? x.started_at.localeCompare(y.started_at) : by === 'tokens' ? y.total - x.total : y.cost_usd - x.cost_usd));
  const tasks = [...new Set(all.map((r) => r.task_id))].map((id) => {
    const xs = all.filter((r) => r.task_id === id);
    return { task_id: id, calls: xs.filter((r) => r.status !== 'CACHED').length, cached: xs.filter((r) => r.status === 'CACHED').length, failed: xs.filter((r) => r.error).length, cost_usd: Math.round(xs.reduce((s, r) => s + r.cost_usd, 0) * 10000) / 10000, tokens: xs.reduce((s, r) => s + r.total, 0) };
  });
  return { attempt_id: attemptId, block: a.block, total: all.length, tasks, rows: list.slice(0, 1000) };
}

/** All runs of a session, newest first (the "Lịch sử lượt" list). */
export async function listRuns(db: Db, workspaceId: string, sessionId: string) {
  const runs = await db.select().from(t.run).where(and(eq(t.run.sessionId, sessionId), eq(t.run.workspaceId, workspaceId))).orderBy(desc(t.run.runNo));
  if (!runs.length) return [];
  const ids = runs.map((r) => r.id);
  const atts = await db.select({ runId: t.blockAttempt.runId, block: t.blockAttempt.block, status: t.blockAttempt.status, current: t.blockAttempt.current, startedAt: t.blockAttempt.startedAt, finishedAt: t.blockAttempt.finishedAt }).from(t.blockAttempt).where(inArray(t.blockAttempt.runId, ids));
  const calls = await db.select({ runId: t.agentCall.runId, costUsd: t.agentCall.costUsd, usage: t.agentCall.usage, cacheHit: t.agentCall.cacheHit }).from(t.agentCall).where(inArray(t.agentCall.runId, ids));
  const autos = await db.select().from(t.runAuto).where(inArray(t.runAuto.runId, ids));
  const releases = await db.select({ runId: t.release.runId, versionLabel: t.release.versionLabel }).from(t.release).where(inArray(t.release.runId, ids));
  return runs.map((r) => {
    const snap = r.snapshot as RunSnapshot;
    const mine = atts.filter((a) => a.runId === r.id);
    const cur = mine.filter((a) => a.current);
    const done = MAIN_BLOCK_IDS.filter((b) => cur.find((a) => a.block === b)?.status === 'DONE').length;
    const starts = mine.map((a) => a.startedAt).filter(Boolean).map((x) => Date.parse(x!));
    const ends = mine.map((a) => a.finishedAt).filter(Boolean).map((x) => Date.parse(x!));
    const cs = calls.filter((c) => c.runId === r.id && !c.cacheHit);
    const auto = autos.find((a) => a.runId === r.id);
    const running = cur.some((a) => a.status === 'RUNNING' || a.status === 'QUEUED');
    const rel = releases.find((x) => x.runId === r.id);
    return {
      id: r.id,
      run_no: r.runNo,
      created_at: new Date(r.createdAt).toISOString(),
      started_at: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
      finished_at: !running && ends.length ? new Date(Math.max(...ends)).toISOString() : null,
      jd_count: snap.documents.length,
      jd_set_revision: snap.jd_set.revision,
      base_version_label: snap.base_version_label,
      progress: { done, total: MAIN_BLOCK_IDS.length },
      running,
      cost_usd: Math.round(cs.reduce((s, c) => s + (c.costUsd ?? 0), 0) * 10000) / 10000,
      tokens: cs.reduce((s, c) => s + splitOf(c.usage).total, 0),
      status: r.status,
      result: rel ? `Đã công bố ${rel.versionLabel}` : running ? 'Đang chạy' : ((auto?.stop as RunStop | null)?.message ?? (done === 9 ? 'Chờ duyệt hồ sơ dự kiến' : `Dừng sau ${done}/9 bước`)),
      stop_code: (auto?.stop as RunStop | null)?.code ?? null,
    };
  });
}

export interface OverviewStep {
  block: BlockId;
  name: string;
  status: 'idle' | 'queued' | 'running' | 'done' | 'blocked' | 'failed' | 'stale';
  attempt_id: string | null;
  attempt_no: number | null;
  gates: { gate_id: string; name: string; status: string; blocking: boolean; deviation: boolean }[];
  /** P2.6: the independent check of the step in one line (κ, r_wg, retranslation, seats). */
  crosscheck: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  calls: number;
  cached: number;
  failed: number;
  tokens: number;
  cost_usd: number;
  estimate: { calls: number; tokens: number } | null;
  budget_tokens: number | null;
  substeps: ProgressStep[];
  error: { code: string; message: string } | null;
}

/** The "Lượt chạy" screen: 9 steps, live sub-steps, the stop reason and the six headline numbers. */
export async function runOverview(db: Db, workspaceId: string, runId: string) {
  const run = await loadRun(db, workspaceId, runId);
  const snap = run.snapshot as RunSnapshot;
  const atts = await db.select(attemptCols).from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, runId), eq(t.blockAttempt.current, true)));
  const calls = await db.select({ attemptId: t.agentCall.attemptId, usage: t.agentCall.usage, costUsd: t.agentCall.costUsd, cacheHit: t.agentCall.cacheHit, status: t.agentCall.status }).from(t.agentCall).where(eq(t.agentCall.runId, runId));
  const live = atts.filter((a) => a.status === 'RUNNING' || a.status === 'QUEUED' || a.status === 'FAILED');
  const progress = live.length ? await db.select().from(t.attemptProgress).where(inArray(t.attemptProgress.attemptId, live.map((a) => a.id))) : [];
  const startedEvents = await db.select({ payload: t.event.payload, attemptId: t.event.attemptId }).from(t.event).where(and(eq(t.event.runId, runId), eq(t.event.type, 'BLOCK_STARTED')));
  const estOf = new Map(startedEvents.map((e) => [e.attemptId, (e.payload as any)?.items ?? null]));
  // cross-check figures, read straight from the outputs of the steps that have an independent check
  const checkAtts = atts.filter((a) => ['B3', 'B5', 'B6', 'B7'].includes(a.block) && (a.status === 'DONE' || a.status === 'BLOCKED'));
  const checkRows = checkAtts.length ? await db.select({ id: t.blockAttempt.id, block: t.blockAttempt.block, recode: sql<any>`${t.blockAttempt.output} -> 'recode'`, minRwg: sql<any>`${t.blockAttempt.output} -> 'min_rwg'`, fleiss: sql<any>`${t.blockAttempt.output} -> 'fleiss'`, inds: sql<any>`jsonb_array_length(coalesce(${t.blockAttempt.output} -> 'indicators', '[]'::jsonb))`, rewritten: sql<any>`${t.blockAttempt.output} -> 'rewritten'`, independent: sql<any>`${t.blockAttempt.output} -> 'independent_audit'`, vars: sql<any>`${t.blockAttempt.output} -> 'audit' -> 'variables'` }).from(t.blockAttempt).where(inArray(t.blockAttempt.id, checkAtts.map((a) => a.id))) : [];
  const seatModels = [...new Set((snap.agent_config.seats ?? []).map((x) => x.model.replace('claude-', '')))].join('/');
  const checks = new Map<string, string>(checkRows.map((r) => [r.id, r.block === 'B3' ? (r.recode ? `κ ${r.recode.kappa} (${r.recode.sample}/${r.recode.of} câu, ${snap.agent_config.tasks.E9?.model.replace('claude-', '') ?? ''})` : '—') : r.block === 'B5' ? `r_wg nhỏ nhất ${r.minRwg ?? '—'} · 3 ghế ${seatModels}` : r.block === 'B6' ? `${r.inds} chỉ báo đạt, ${r.rewritten ?? 0} viết lại · κ lớp ${r.fleiss?.kappa ?? '—'}` : `${(r.vars ?? []).filter((v: any) => v.result === 'PASS').length}/10 biến · ${r.independent ? 'độc lập' : 'cùng model một bước'}`]));
  const now = Date.now();
  const steps: OverviewStep[] = MAIN_BLOCK_IDS.map((block) => {
    const a = atts.find((x) => x.block === block);
    const acc = zero();
    for (const c of calls.filter((c) => a && c.attemptId === a.id)) add(acc, c);
    const status: OverviewStep['status'] = !a ? 'idle' : a.status === 'QUEUED' ? 'queued' : a.status === 'RUNNING' ? 'running' : a.status === 'DONE' ? 'done' : a.status === 'FAILED' ? 'failed' : a.status === 'STALE' ? 'stale' : 'blocked';
    const gates = ((a?.gates as GateResult[] | null) ?? []).map((g) => ({ gate_id: g.gate_id, name: g.name, status: g.status, blocking: gateBlocks(g), deviation: !!g.deviation }));
    const s = a?.startedAt ? Date.parse(a.startedAt) : null;
    const f = a?.finishedAt ? Date.parse(a.finishedAt) : null;
    const est = a ? estOf.get(a.id) : null;
    return {
      block,
      name: BLOCK_META[block].name,
      status,
      attempt_id: a?.id ?? null,
      attempt_no: a?.attemptNo ?? null,
      gates,
      started_at: a?.startedAt ? new Date(a.startedAt).toISOString() : null,
      finished_at: a?.finishedAt ? new Date(a.finishedAt).toISOString() : null,
      duration_ms: s ? (f ?? (status === 'running' ? now : s)) - s : null,
      calls: acc.calls,
      cached: acc.cached,
      failed: acc.failed,
      tokens: acc.total,
      cost_usd: Math.round(acc.cost_usd * 10000) / 10000,
      estimate: est ? { calls: est.calls, tokens: est.tokens } : null,
      budget_tokens: snap.budget?.block_tokens[block] ?? null,
      substeps: ((progress.find((p) => p.attemptId === a?.id)?.steps as ProgressStep[]) ?? []),
      error: a?.status === 'FAILED' ? { code: (a.error as any)?.code ?? 'INTERNAL', message: (a.error as any)?.message ?? '' } : null,
      crosscheck: a ? (checks.get(a.id) ?? null) : null,
    };
  });
  const total = zero();
  for (const c of calls) add(total, c);
  const auto = await getAuto(db, runId);
  const isCurrent = (await currentRun(db, run.sessionId))?.id === runId;
  // the stored stop, or one derived from the steps when the run was driven by hand
  let stop: RunStop | null = auto.stop;
  if (!stop && !auto.on) {
    const bad = steps.find((x) => x.status === 'failed' || x.status === 'blocked');
    const a = bad ? atts.find((x) => x.block === bad.block)! : null;
    if (a) stop = stopOf(bad!.block, a as any);
    else if (steps.every((x) => x.status === 'done')) stop = { code: 'DONE', block: 'B8', message: 'Đã chạy xong B0–B8. Hồ sơ DỰ KIẾN chờ duyệt.', actions: ['REVIEW_CANDIDATE'], at: steps[8].finished_at ?? new Date().toISOString() };
  }
  const starts = steps.map((x) => x.started_at).filter(Boolean).map((x) => Date.parse(x!));
  const running = steps.some((x) => x.status === 'running' || x.status === 'queued');
  const ends = steps.map((x) => x.finished_at).filter(Boolean).map((x) => Date.parse(x!));
  const breaker = await readBreaker(db);
  return {
    run: { id: run.id, run_no: run.runNo, session_id: run.sessionId, status: run.status, created_at: new Date(run.createdAt).toISOString(), jd_count: snap.documents.length, base_version_label: snap.base_version_label, current: isCurrent, read_only: !isCurrent || run.status === 'COMPLETE' },
    auto: { on: auto.on, note: auto.note },
    running,
    stop,
    breaker,
    steps,
    metrics: {
      steps_done: steps.filter((x) => x.status === 'done').length,
      steps_total: steps.length,
      elapsed_ms: starts.length ? (running ? now : Math.max(...ends, Math.min(...starts))) - Math.min(...starts) : 0,
      calls: total.calls,
      cached: total.cached,
      failed: total.failed,
      tokens: total.total,
      split: { input: total.input, cache_write: total.cache_write, cache_read: total.cache_read, output: total.output },
      cost_usd: Math.round(total.cost_usd * 10000) / 10000,
      quota: quotaShare(total.cost_usd),
    },
    budget: snap.budget ?? null,
    poll_ms: running || auto.on ? 2000 : 30000,
  };
}

/** Every attempt of one block in a run (the "Các lần chạy" tab). */
export async function blockAttempts(db: Db, workspaceId: string, runId: string, block: BlockId) {
  await loadRun(db, workspaceId, runId);
  const atts = await db.select(attemptCols).from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, runId), eq(t.blockAttempt.block, block))).orderBy(desc(t.blockAttempt.attemptNo));
  const calls = atts.length ? await db.select({ attemptId: t.agentCall.attemptId, usage: t.agentCall.usage, costUsd: t.agentCall.costUsd, cacheHit: t.agentCall.cacheHit, status: t.agentCall.status }).from(t.agentCall).where(inArray(t.agentCall.attemptId, atts.map((a) => a.id))) : [];
  return atts.map((a) => {
    const acc = zero();
    for (const c of calls.filter((c) => c.attemptId === a.id)) add(acc, c);
    const o = (a.options ?? {}) as any;
    return {
      id: a.id,
      attempt_no: a.attemptNo,
      current: a.current,
      reason: o.reason ?? 'manual',
      accept_over: o.accept_over ?? null,
      status: a.status,
      started_at: a.startedAt ? new Date(a.startedAt).toISOString() : null,
      finished_at: a.finishedAt ? new Date(a.finishedAt).toISOString() : null,
      duration_ms: a.startedAt && a.finishedAt ? Date.parse(a.finishedAt) - Date.parse(a.startedAt) : null,
      gates: ((a.gates as GateResult[] | null) ?? []).map((g) => ({ gate_id: g.gate_id, name: g.name, status: g.status })),
      error: a.error ? { code: (a.error as any).code, message: (a.error as any).message } : null,
      ...round(acc),
      input_hash: a.inputHash,
      output_hash: a.outputHash,
    };
  });
}

/** The current-run actions take a run id; they only apply to the session's current run. */
export async function sessionOfCurrentRun(db: Db, workspaceId: string, runId: string) {
  const run = await loadRun(db, workspaceId, runId);
  const cur = await currentRun(db, run.sessionId);
  if (cur?.id !== runId) throw new AppError('RUN_NOT_CURRENT', 'Lượt này không còn là lượt hiện tại của phiên: chỉ xem được, không chạy tiếp.', 409);
  return run.sessionId;
}

/** Technical facts of an attempt: task ids, hashes, versions (the "Kỹ thuật" tab). */
export async function attemptTech(db: Db, workspaceId: string, attemptId: string) {
  const [a] = await db.select({ ...attemptCols, workspaceId: t.blockAttempt.workspaceId, runId: t.blockAttempt.runId, output: t.blockAttempt.output }).from(t.blockAttempt).where(eq(t.blockAttempt.id, attemptId));
  if (!a || a.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không có lần chạy này.', 404);
  const [run] = await db.select().from(t.run).where(eq(t.run.id, a.runId));
  const snap = run.snapshot as RunSnapshot;
  const { __view: _v, __ai: ai, ...raw } = (a.output ?? {}) as any;
  return {
    attempt_id: a.id,
    block: a.block,
    attempt_no: a.attemptNo,
    input_hash: a.inputHash,
    output_hash: a.outputHash,
    tasks: (ai ?? []) as unknown[],
    task_defs: (ai ?? []).map((x: any) => Object.values(TASKS).find((d) => d.id === x.task_id)).filter(Boolean).map((d: any) => ({ id: d.id, prompt_version: d.promptVersion, schema_version: d.schemaVersion })),
    versions: { policy: `${snap.policy.id}@${snap.policy.version}`, agents: snap.agent_config.version, cli: snap.cli_version, ...snap.versions },
    options: a.options,
    error: a.error,
    raw,
  };
}

/**
 * P3.11 "Khung bị ảnh hưởng": frameworks of the published dictionary that pin an older version of a competency this
 * run's candidate changes. Q4: listed with a "create a review run" action, never run automatically.
 */
export async function affectedFrameworks(db: Db, workspaceId: string, sessionId: string) {
  const run = await currentRun(db, sessionId);
  if (!run) return [];
  const [cand] = await db.select().from(t.candidate).where(and(eq(t.candidate.runId, run.id), eq(t.candidate.workspaceId, workspaceId))).orderBy(desc(t.candidate.createdAt)).limit(1);
  if (!cand) return [];
  const changed = (cand.items as any[]).filter((i) => i.entity === 'C' && i.action === 'UPDATE');
  if (!changed.length) return [];
  const dict = await loadDictionary(db, workspaceId, (run.snapshot as RunSnapshot).base_release_id);
  const sessions = await db.select({ id: t.session.id, name: t.session.name }).from(t.session).where(eq(t.session.workspaceId, workspaceId));
  return dict.R.flatMap((f) =>
    changed
      .filter((c) => f.data.requirements.some((q) => q.competency_id === c.id))
      .map((c) => ({
        framework_id: f.id,
        role_title: f.data.role_title,
        version_label: f.data.version_label,
        session_id: f.data.session_id,
        session_name: sessions.find((x) => x.id === f.data.session_id)?.name ?? null,
        competency_id: c.id,
        competency: c.name,
        pinned: f.data.requirements.find((q) => q.competency_id === c.id)!.competency_version,
        change: c.change_types ?? [],
        bump: c.bump ?? null,
        to_version: c.to_version ?? null,
        same_session: f.data.session_id === sessionId,
      })),
  );
}
