import { and, eq, sql } from 'drizzle-orm';
import { AppError, canonicalJson } from '@cl/contract';
import { appendEvent, newId, sha256, t, type Db } from '@cl/db';
import type { AgentConfig, TaskModel } from './config';
import { ClaudeCliRunner } from './runner';
import { TASKS, outputJsonSchema, type TaskDef, type TaskInput, type TaskName, type TaskOutput } from './tasks';

export interface TaskContext {
  db: Db;
  runner: ClaudeCliRunner;
  config: AgentConfig;
  workspaceId: string;
  runId?: string | null;
  attemptId?: string | null;
  sessionId?: string | null;
  /** Tasks the user explicitly asked to re-run: bumps rerun_no so the cached answer is not reused. */
  rerun?: Partial<Record<TaskName, number>>;
  bypassCache?: boolean;
  cliVersion?: string | null;
  maxCallsPerRun?: number;
  maxInputChars?: number;
}

export interface TaskResult<O> {
  output: O;
  callId: string;
  cacheHit: boolean;
  taskKey: string;
  model: string;
  effort: string;
}

export function canonicalInput(input: unknown): string {
  return canonicalJson(input);
}

export function taskKey(name: TaskName, tm: TaskModel, inputCanonical: string, rerunNo = 0): string {
  const task = TASKS[name];
  return sha256(canonicalJson({ task_id: task.id, prompt_version: task.promptVersion, schema_version: task.schemaVersion, system_sha: sha256(task.system), model: tm.model, effort: tm.effort, rerun_no: rerunNo, input: inputCanonical }));
}

const userPrompt = (inputCanonical: string, repair?: string[]) =>
  `<task_input>\n${inputCanonical}\n</task_input>` +
  (repair?.length ? `\n\nLần trả lời trước KHÔNG hợp lệ vì:\n${repair.slice(0, 12).map((e) => '- ' + e).join('\n')}\nHãy trả lại JSON đúng schema và sửa đúng các lỗi trên.` : '');

/**
 * Run one agent task with content-addressed memoisation:
 * same task + prompt + schema + model + effort + canonical input ⇒ stored answer, zero CLI calls.
 */
export async function runTask<K extends TaskName>(ctx: TaskContext, name: K, rawInput: TaskInput<K>, override?: TaskModel): Promise<TaskResult<TaskOutput<K>>> {
  const task = TASKS[name] as unknown as TaskDef;
  const tm = override ?? ctx.config.tasks[name];
  const input = task.input.parse(rawInput);
  const inputCanonical = canonicalInput(input);
  const maxChars = ctx.maxInputChars ?? Number(process.env.AGENT_MAX_INPUT_CHARS ?? 120000);
  if (inputCanonical.length > maxChars) throw new AppError('AGENT_INPUT_TOO_LARGE', `Input của ${task.id} dài ${inputCanonical.length} ký tự, vượt giới hạn ${maxChars}.`, 422, { task_id: task.id }, ['SPLIT_INPUT']);
  const key = taskKey(name, tm, inputCanonical, ctx.rerun?.[name] ?? 0);
  const base = { workspaceId: ctx.workspaceId, runId: ctx.runId ?? null, attemptId: ctx.attemptId ?? null, taskId: task.id, taskKey: key, model: tm.model, effort: tm.effort, promptVersion: task.promptVersion, schemaVersion: task.schemaVersion, cliVersion: ctx.cliVersion ?? null };

  if (!ctx.bypassCache) {
    const [hit] = await ctx.db.select().from(t.agentResult).where(eq(t.agentResult.taskKey, key)).limit(1);
    if (hit) {
      const callId = newId('call');
      await ctx.db.insert(t.agentCall).values({ id: callId, ...base, cacheHit: true, status: 'OK', durationMs: 0 });
      return { output: hit.output as TaskOutput<K>, callId, cacheHit: true, taskKey: key, model: tm.model, effort: tm.effort };
    }
  }

  if (ctx.runId) {
    const limit = ctx.maxCallsPerRun ?? Number(process.env.AGENT_MAX_CALLS_PER_RUN ?? 400);
    const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(t.agentCall).where(and(eq(t.agentCall.runId, ctx.runId), eq(t.agentCall.cacheHit, false)));
    if (n >= limit) throw new AppError('BUDGET_EXCEEDED', `Lượt đã dùng ${n} lời gọi agent, đạt ngân sách ${limit}.`, 429, { limit }, ['RAISE_BUDGET', 'NEW_RUN']);
  }

  const schema = outputJsonSchema(task);
  let repair: string[] | undefined;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const callId = newId('call');
    let res = await ctx.runner.run({ system: task.system, user: userPrompt(inputCanonical, repair), schema, model: tm.model, effort: tm.effort });
    // transient CLI failures: one retry with a short back-off
    if (!res.ok && (res.errorCode === 'CLI_ERROR' || res.errorCode === 'TIMEOUT' || res.errorCode === 'NO_STRUCTURED_OUTPUT')) {
      await new Promise((r) => setTimeout(r, Number(process.env.AGENT_RETRY_DELAY_MS ?? 1500)));
      const again = await ctx.runner.run({ system: task.system, user: userPrompt(inputCanonical, repair), schema, model: tm.model, effort: tm.effort });
      if (again.ok || res.errorCode !== 'TIMEOUT') res = again;
    }
    if (!res.ok) {
      const status = res.errorCode === 'TIMEOUT' ? 'TIMEOUT' : 'CLI_ERROR';
      await ctx.db.insert(t.agentCall).values({ id: callId, ...base, cacheHit: false, status, durationMs: res.durationMs, usage: res.usage ?? null, costUsd: res.costUsd ?? null, error: `${res.errorCode}: ${res.errorMessage ?? ''}`.slice(0, 500) });
      const code = res.errorCode === 'CLI_NOT_FOUND' ? 'AGENT_CLI_UNAVAILABLE' : res.errorCode === 'NOT_LOGGED_IN' ? 'AGENT_NOT_LOGGED_IN' : res.errorCode === 'TIMEOUT' ? 'AGENT_TIMEOUT' : 'AGENT_CLI_ERROR';
      throw new AppError(code, `${task.id}: ${res.errorMessage ?? res.errorCode}`, 502, { task_id: task.id, call_id: callId }, ['RETRY']);
    }
    const parsed = task.output.safeParse(res.structured);
    const errors = parsed.success ? task.check(input, parsed.data) : parsed.error.issues.map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`);
    if (parsed.success && !errors.length) {
      const output = task.normalize(input, parsed.data) as TaskOutput<K>;
      await ctx.db.insert(t.agentCall).values({ id: callId, ...base, cacheHit: false, status: 'OK', durationMs: res.durationMs, usage: res.usage ?? null, costUsd: res.costUsd ?? null });
      await ctx.db.insert(t.agentResult).values({ taskKey: key, taskId: task.id, inputCanonical, output, firstCallId: callId }).onConflictDoNothing();
      await appendEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'AGENT_CALL', actor: `agent:${task.agent}`, sessionId: ctx.sessionId, runId: ctx.runId, attemptId: ctx.attemptId, block: task.block, versions: { task_id: task.id, model: tm.model, effort: tm.effort, prompt: task.promptVersion, schema: task.schemaVersion, cli: ctx.cliVersion ?? null }, inputHash: sha256(inputCanonical), outputHash: sha256(canonicalJson(output)), payload: { call_id: callId, task_key: key, repaired: attempt > 0 } });
      return { output, callId, cacheHit: false, taskKey: key, model: tm.model, effort: tm.effort };
    }
    lastError = errors.slice(0, 6).join('; ');
    await ctx.db.insert(t.agentCall).values({ id: callId, ...base, cacheHit: false, status: parsed.success ? 'REJECTED' : 'SCHEMA_INVALID', durationMs: res.durationMs, usage: res.usage ?? null, costUsd: res.costUsd ?? null, error: lastError.slice(0, 500) });
    repair = errors;
  }
  throw new AppError('AGENT_SCHEMA_INVALID', `${task.id}: output không hợp lệ sau một lần sửa (${lastError}).`, 502, { task_id: task.id }, ['RETRY']);
}
