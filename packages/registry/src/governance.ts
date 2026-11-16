import { and, eq, inArray } from 'drizzle-orm';
import { AppError } from '@cl/contract';
import { appendEvent, t, type Db, type DbOrTx } from '@cl/db';

export interface StopState {
  since: string;
  finding_refs: string[];
  reason: string;
  scope: string;
  raised_by: string;
}

export async function getStop(db: DbOrTx, workspaceId: string): Promise<StopState | null> {
  const [ws] = await db.select().from(t.workspace).where(eq(t.workspace.id, workspaceId));
  return (ws?.stopState as StopState | null) ?? null;
}

export async function raiseStop(db: Db, workspaceId: string, input: { reason: string; finding_refs?: string[]; actor: string; runId?: string | null }) {
  const existing = await getStop(db, workspaceId);
  if (existing) return existing;
  const stop: StopState = { since: new Date().toISOString(), finding_refs: input.finding_refs ?? [], reason: input.reason, scope: 'workspace', raised_by: input.actor };
  await db.update(t.workspace).set({ stopState: stop }).where(eq(t.workspace.id, workspaceId));
  await appendEvent(db, { workspaceId, type: 'STOP_RAISED', actor: input.actor, runId: input.runId, payload: { ...stop } });
  return stop;
}

/** Re-open needs a reason and every lesson tied to the STOP findings to be decided (SAFE/APPLIED/REJECTED). */
export async function reopenWorkspace(db: Db, workspaceId: string, input: { reason: string; actor: string }) {
  if (!input.reason?.trim()) throw new AppError('REASON_REQUIRED', 'Cần nhập lý do mở lại.', 422);
  const stop = await getStop(db, workspaceId);
  if (!stop) return { reopened: false };
  const lessons = await db.select().from(t.lesson).where(eq(t.lesson.workspaceId, workspaceId));
  const tied = lessons.filter((l) => ((l.data as any).finding_refs ?? []).some((f: string) => stop.finding_refs.includes(f)));
  const pending = tied.filter((l) => l.status === 'PENDING');
  if (pending.length) throw new AppError('LESSON_PENDING', `Còn ${pending.length} lesson gắn với STOP chưa được quyết định. Xác nhận An toàn hoặc Loại trước khi mở lại.`, 409, { lesson_ids: pending.map((l) => l.id) }, ['OPEN_AUDIT']);
  await db.update(t.workspace).set({ stopState: null }).where(eq(t.workspace.id, workspaceId));
  await appendEvent(db, { workspaceId, type: 'STOP_CLEARED', actor: input.actor, payload: { reason: input.reason.trim(), lesson_refs: tied.map((l) => l.id), finding_refs: stop.finding_refs } });
  return { reopened: true };
}

export async function decideLessons(db: Db, workspaceId: string, input: { lesson_ids?: string[]; decision: 'SAFE' | 'REJECTED'; reason: string; actor: string }) {
  if (!input.reason?.trim()) throw new AppError('REASON_REQUIRED', 'Cần nhập lý do cho quyết định về lesson.', 422);
  const where = input.lesson_ids?.length ? and(eq(t.lesson.workspaceId, workspaceId), inArray(t.lesson.id, input.lesson_ids)) : and(eq(t.lesson.workspaceId, workspaceId), eq(t.lesson.status, 'PENDING'));
  const rows = (await db.select().from(t.lesson).where(where)).filter((l) => l.status === 'PENDING');
  const now = new Date().toISOString();
  for (const l of rows) {
    await db.update(t.lesson).set({ status: input.decision, decidedBy: input.actor, decidedAt: now, decisionReason: input.reason.trim() }).where(eq(t.lesson.id, l.id));
    await appendEvent(db, { workspaceId, type: 'LESSON_DECIDED', actor: input.actor, payload: { lesson_id: l.id, decision: input.decision, reason: input.reason.trim() } });
  }
  return { decided: rows.length };
}

/** Lessons a new run may load: only those a person confirmed SAFE. */
export async function safeLessons(db: DbOrTx, workspaceId: string) {
  return db.select().from(t.lesson).where(and(eq(t.lesson.workspaceId, workspaceId), eq(t.lesson.status, 'SAFE')));
}
