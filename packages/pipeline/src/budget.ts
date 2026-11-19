import { and, eq, isNotNull } from 'drizzle-orm';
import { AppError, type BlockId } from '@cl/contract';
import { TASKS, type CallGuard, type TaskName } from '@cl/agents';
import { t, type Db } from '@cl/db';
import { BUDGET_FACTOR, inputLimitFor, inputTokensFromChars, usageTokens, type RunBudget } from './estimate';

/** What the operator accepted with "Chạy tiếp, chấp nhận vượt" for one attempt: the check that stopped the block, lifted once. */
export interface AcceptOver {
  input?: boolean;
  calls?: boolean;
  /** block token budget */
  budget?: boolean;
  /** run token budget */
  run?: boolean;
  /** per-run call cap (AGENT_MAX_CALLS_PER_RUN) */
  run_calls?: boolean;
  by?: string;
  at?: string;
}

/** Floor for the call-count anomaly so small blocks do not trip on one repair or retry. */
const MIN_CALLS_LIMIT = 10;

/**
 * Budget and anomaly checks for the real CLI calls of one block (spec P0.10, P0.11).
 * Usage and calls are counted over EVERY attempt of the block in the run, so a plain resume or rerun does not get a
 * fresh budget; "accept over" lifts exactly the check that stopped it, once, relative to what is already used.
 * Each call's estimated input is reserved before it is queued, so calls issued together are counted at once.
 */
export class BlockGuard implements CallGuard {
  private runUsed = 0;
  private blockUsed = 0;
  private reserved = 0;
  calls = 0;
  callLimit: number;
  runLimit: number | null;
  blockLimit: number | null;

  constructor(
    private block: BlockId,
    private budget: RunBudget | undefined,
    private estimatedCalls: number,
    private accept: AcceptOver = {},
  ) {
    this.callLimit = Math.max(MIN_CALLS_LIMIT, Math.ceil(estimatedCalls * BUDGET_FACTOR));
    this.blockLimit = budget?.block_tokens[block] ?? null;
    this.runLimit = budget ? budget.run_tokens : null;
  }

  /** Token use and calls already recorded for the run and for this block (all its attempts). */
  async init(db: Db, runId: string, _attemptId: string) {
    const atts = await db.select({ id: t.blockAttempt.id }).from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, runId), eq(t.blockAttempt.block, this.block)));
    const mine = new Set(atts.map((a) => a.id));
    const rows = await db.select({ attemptId: t.agentCall.attemptId, usage: t.agentCall.usage }).from(t.agentCall).where(and(eq(t.agentCall.runId, runId), eq(t.agentCall.cacheHit, false)));
    for (const r of rows) {
      const n = usageTokens(r.usage);
      this.runUsed += n;
      if (r.attemptId && mine.has(r.attemptId)) {
        this.blockUsed += n;
        this.calls++;
      }
    }
    // the lifted check gets one more allowance from where it stands now
    if (this.accept.calls) this.callLimit = this.calls + Math.max(MIN_CALLS_LIMIT, Math.ceil(this.estimatedCalls * BUDGET_FACTOR));
    if (this.accept.budget && this.blockLimit !== null) this.blockLimit = this.blockUsed + this.blockLimit;
    if (this.accept.run && this.runLimit !== null) this.runLimit = this.runUsed + Math.max(this.blockLimit ?? 0, Math.ceil((this.budget?.run_tokens ?? 0) / 2));
    return this;
  }

  before(task: TaskName, promptChars: number): number {
    const id = TASKS[task].id;
    const est = inputTokensFromChars(promptChars);
    const limit = inputLimitFor(task);
    if (!this.accept.input && est > limit)
      throw new AppError('ANOMALY_INPUT', `${this.block} · một lời gọi ${id} có đầu vào ≈ ${est.toLocaleString('vi-VN')} token, vượt ngưỡng bất thường ${limit.toLocaleString('vi-VN')} token. Chưa gọi.`, 409, { task_id: id, estimated_tokens: est, limit, block: this.block }, ['ACCEPT_OVER', 'OPEN_STEP']);
    if (this.calls + 1 > this.callLimit)
      throw new AppError('ANOMALY_CALLS', `${this.block} · số lời gọi AI đã vượt ${this.callLimit} (1,5 × ước tính). Dừng để kiểm tra.`, 409, { task_id: id, calls: this.calls, limit: this.callLimit, block: this.block }, ['ACCEPT_OVER', 'OPEN_STEP']);
    if (this.blockLimit !== null && this.blockUsed + this.reserved + est > this.blockLimit)
      throw new AppError('BUDGET_BLOCK', `${this.block} · đã dùng ≈ ${fmt(this.blockUsed + this.reserved)} token; lời gọi tiếp (≈ ${fmt(est)}) sẽ vượt trần của bước ${fmt(this.blockLimit)} token.`, 409, { task_id: id, used: this.blockUsed, reserved: this.reserved, next: est, limit: this.blockLimit, block: this.block }, ['ACCEPT_OVER', 'OPEN_STEP']);
    if (this.runLimit !== null && this.runUsed + this.reserved + est > this.runLimit)
      throw new AppError('BUDGET_RUN', `${this.block} · lượt đã dùng ≈ ${fmt(this.runUsed + this.reserved)} token; lời gọi tiếp (≈ ${fmt(est)}) sẽ vượt trần của lượt ${fmt(this.runLimit)} token.`, 409, { task_id: id, used: this.runUsed, reserved: this.reserved, next: est, limit: this.runLimit, block: this.block }, ['ACCEPT_OVER', 'NEW_RUN']);
    this.calls++;
    this.reserved += est;
    return est;
  }

  after(reserved: number, usage: unknown) {
    this.reserved -= reserved;
    const n = usageTokens(usage);
    this.runUsed += n;
    this.blockUsed += n;
  }

  snapshot() {
    return { calls: this.calls, call_limit: this.callLimit, block_tokens: this.blockUsed, block_limit: this.blockLimit, run_tokens: this.runUsed, run_limit: this.runLimit };
  }
}
const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
