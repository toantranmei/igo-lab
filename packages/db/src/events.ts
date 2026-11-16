import { desc, eq, sql } from 'drizzle-orm';
import { canonicalJson } from '@cl/contract';
import type { DbOrTx } from './client';
import { event } from './schema';
import { newId, sha256 } from './ids';

export type EventType =
  | 'INPUT_LOCKED'
  | 'JOB_RESULT'
  | 'AGENT_CALL'
  | 'GATE_RESULT'
  | 'CANDIDATE_READY'
  | 'AUDIT'
  | 'APPROVAL'
  | 'RELEASE_COMMITTED'
  | 'ACKNOWLEDGED'
  | 'AUTO_STARTED'
  | 'AUTO_STOPPED'
  | 'STOP_RAISED'
  | 'STOP_CLEARED'
  | 'LESSON_DECIDED'
  | 'IMPORT_COMMITTED'
  | 'EXPORT_CREATED'
  | 'SESSION_CREATED'
  | 'JD_SET_CONFIRMED'
  | 'RUN_CREATED';

export interface NewEvent {
  workspaceId: string;
  type: EventType;
  actor: string;
  sessionId?: string | null;
  runId?: string | null;
  attemptId?: string | null;
  block?: string | null;
  versions?: Record<string, unknown>;
  inputHash?: string | null;
  outputHash?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Append one event to the workspace hash chain. The advisory lock serialises appends per workspace
 * so prev_event_hash always points at the immediately preceding event.
 */
export async function appendEvent(db: DbOrTx, e: NewEvent): Promise<string> {
  const run = async (tx: DbOrTx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'event:' + e.workspaceId}))`);
    const [last] = await tx.select({ h: event.eventHash }).from(event).where(eq(event.workspaceId, e.workspaceId)).orderBy(desc(event.seq)).limit(1);
    const id = newId('ev');
    const serverTime = new Date().toISOString();
    const body = {
      id,
      workspaceId: e.workspaceId,
      sessionId: e.sessionId ?? null,
      runId: e.runId ?? null,
      attemptId: e.attemptId ?? null,
      block: e.block ?? null,
      serverTime,
      actor: e.actor,
      type: e.type,
      versions: e.versions ?? {},
      inputHash: e.inputHash ?? null,
      outputHash: e.outputHash ?? null,
      payload: e.payload ?? {},
      prevEventHash: last?.h ?? null,
    };
    const eventHash = sha256(canonicalJson(body));
    await tx.insert(event).values({ ...body, eventHash });
    return id;
  };
  // Nested transaction (savepoint) when already inside one; otherwise a fresh transaction.
  return (db as { transaction: (fn: (tx: DbOrTx) => Promise<string>) => Promise<string> }).transaction(run);
}

/** Recompute the chain and report the first broken link, if any. */
export async function verifyEventChain(db: DbOrTx, workspaceId: string): Promise<{ ok: boolean; count: number; brokenAt?: string }> {
  const rows = await db.select().from(event).where(eq(event.workspaceId, workspaceId)).orderBy(event.seq);
  let prev: string | null = null;
  for (const r of rows) {
    const body = {
      id: r.id,
      workspaceId: r.workspaceId,
      sessionId: r.sessionId,
      runId: r.runId,
      attemptId: r.attemptId,
      block: r.block,
      serverTime: new Date(r.serverTime).toISOString(),
      actor: r.actor,
      type: r.type,
      versions: r.versions,
      inputHash: r.inputHash,
      outputHash: r.outputHash,
      payload: r.payload,
      prevEventHash: r.prevEventHash,
    };
    if (r.prevEventHash !== prev || sha256(canonicalJson(body)) !== r.eventHash) return { ok: false, count: rows.length, brokenAt: r.id };
    prev = r.eventHash;
  }
  return { ok: true, count: rows.length };
}
