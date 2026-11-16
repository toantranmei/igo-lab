import { and, eq, sql } from 'drizzle-orm';
import { AppError, type ChangeItem } from '@cl/contract';
import { appendEvent, hashJson, newId, t, type Db, type DbOrTx } from '@cl/db';
import { latestRelease, loadRecords, versionLabelFor, type CData, type GData, type Member, type RData, type RecordKind, type WData } from './dictionary';

export interface CandidateItem {
  item_id: string;
  entity: RecordKind;
  id: string;
  action: 'ADD' | 'UPDATE' | 'REUSE' | 'NEEDS_REVIEW';
  name: string;
  before: string | null;
  after: string | null;
  reason: string;
  affected: string[];
  /** Version in the base release (null for ADD). */
  base_version: number | null;
  /** Record to write for ADD/UPDATE. */
  data: any | null;
  /** The competency this item belongs to; dropping that competency drops the item too. */
  depends_on: string | null;
  evidence_refs: string[];
}
export interface Decision {
  decision: 'ACCEPT' | 'REJECT';
  dropped_item_ids: string[];
  reason: string;
  decided_by: string;
  decided_at: string;
}
export interface Receipt {
  release_id: string;
  version_label: string;
  parent_release_id: string | null;
  counts: { ADD: number; UPDATE: number; REUSE: number };
  hash: string;
  decided_by: string;
  decided_at: string;
  replayed: boolean;
}

const isSynthetic = (v: any): boolean => {
  if (!v || typeof v !== 'object') return typeof v === 'string' && v.startsWith('seed://');
  if (Array.isArray(v)) return v.some(isSynthetic);
  if (v.synthetic === true) return true;
  return Object.values(v).some(isSynthetic);
};

/** Lock per workspace for the whole transaction, so two commits can never interleave. */
async function lockWorkspace(tx: DbOrTx, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'registry:' + workspaceId}))`);
}

/** Items that survive the user's decision, with R/W payloads filtered for dropped competencies. */
export function effectiveItems(items: CandidateItem[], dropped: string[]): CandidateItem[] {
  const dropSet = new Set(dropped);
  const droppedC = new Set(items.filter((i) => i.entity === 'C' && (dropSet.has(i.item_id) || i.action === 'NEEDS_REVIEW')).map((i) => i.id));
  return items
    .filter((i) => !dropSet.has(i.item_id) && i.action !== 'NEEDS_REVIEW' && !(i.depends_on && droppedC.has(i.depends_on)) && !(i.entity === 'C' && droppedC.has(i.id)))
    .map((i) => {
      if (!i.data || !droppedC.size) return i;
      if (i.entity === 'R') return { ...i, data: { ...i.data, requirements: (i.data as RData).requirements.filter((q) => !droppedC.has(q.competency_id)) } };
      if (i.entity === 'W') return { ...i, data: { ...i.data, tasks: (i.data as WData).tasks.map((k) => ({ ...k, competency_ids: k.competency_ids.filter((c) => !droppedC.has(c)) })) } };
      if (i.entity === 'V') return { ...i, data: { ...i.data, competency_ids: (i.data.competency_ids ?? []).filter((c: string) => !droppedC.has(c)) } };
      return i;
    });
}

export async function decideCandidate(db: Db, workspaceId: string, candidateId: string, input: { decision: 'ACCEPT' | 'REJECT'; dropped_item_ids?: string[]; reason: string; actor: string }) {
  if (!input.reason?.trim()) throw new AppError('REASON_REQUIRED', 'Cần nhập lý do cho quyết định.', 422);
  const [c] = await db.select().from(t.candidate).where(and(eq(t.candidate.id, candidateId), eq(t.candidate.workspaceId, workspaceId)));
  if (!c) throw new AppError('NOT_FOUND', 'Không tìm thấy hồ sơ ứng viên.', 404);
  if (c.status === 'COMMITTED') throw new AppError('ALREADY_COMMITTED', 'Hồ sơ đã được ghi; không đổi quyết định được.', 409);
  const items = c.items as CandidateItem[];
  const dropped = (input.dropped_item_ids ?? []).filter((id) => items.some((i) => i.item_id === id));
  const decision: Decision = { decision: input.decision, dropped_item_ids: dropped, reason: input.reason.trim(), decided_by: input.actor, decided_at: new Date().toISOString() };
  await db.update(t.candidate).set({ decision, status: 'DECIDED' }).where(eq(t.candidate.id, candidateId));
  await appendEvent(db, { workspaceId, type: 'APPROVAL', actor: input.actor, runId: c.runId, block: 'B8', payload: { candidate_id: candidateId, decision: input.decision, dropped: dropped.length, reason: decision.reason } });
  return decision;
}

/**
 * Atomic publish. One SERIALIZABLE transaction: STOP check, base check, idempotency, reference check,
 * record writes, release row and the RELEASE_COMMITTED event either all happen or none do.
 */
export async function commitCandidate(db: Db, workspaceId: string, candidateId: string, input: { expected_base_release_id: string | null; actor: string; failAfterWrites?: boolean }): Promise<Receipt> {
  const run = () =>
    db.transaction(
      async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const [cand] = await tx.select().from(t.candidate).where(and(eq(t.candidate.id, candidateId), eq(t.candidate.workspaceId, workspaceId)));
        if (!cand) throw new AppError('NOT_FOUND', 'Không tìm thấy hồ sơ ứng viên.', 404);
        const [done] = await tx.select().from(t.release).where(and(eq(t.release.workspaceId, workspaceId), eq(t.release.candidateId, candidateId)));
        if (done) return receiptOf(done, true);
        const [ws] = await tx.select().from(t.workspace).where(eq(t.workspace.id, workspaceId));
        if (ws?.stopState) throw new AppError('WORKSPACE_STOPPED', 'Workspace đang STOP: không ghi được vào từ điển cho tới khi được mở lại.', 423, ws.stopState, ['OPEN_AUDIT']);
        const decision = cand.decision as Decision | null;
        if (!decision || decision.decision !== 'ACCEPT') throw new AppError('DECISION_REQUIRED', 'Cần quyết định chấp nhận (kèm lý do) trước khi ghi.', 409, undefined, ['DECIDE']);
        const latest = await latestRelease(tx, workspaceId);
        const latestId = latest?.releaseId ?? null;
        if (latestId !== (input.expected_base_release_id ?? null) || latestId !== (cand.baseReleaseId ?? null))
          throw new AppError('BASE_CHANGED', 'Từ điển đã có release mới hơn nền của hồ sơ này. Cần so lại thay đổi trên nền mới (tạo lượt mới).', 409, { latest_release_id: latestId, candidate_base: cand.baseReleaseId, expected: input.expected_base_release_id }, ['NEW_RUN']);

        const items = effectiveItems(cand.items as CandidateItem[], decision.dropped_item_ids);
        if (items.some((i) => isSynthetic(i.data))) throw new AppError('SYNTHETIC_REJECTED', 'Bản ghi seed/tổng hợp không được ghi vào từ điển Live.', 422);

        const baseMembers = (latest?.members as Member[] | undefined) ?? [];
        const members = new Map(baseMembers.map((m) => [`${m.kind}|${m.id}`, m]));
        const seq = (latest?.seq ?? 0) + 1;
        const versionLabel = versionLabelFor(seq);
        const releaseId = newId('rel');
        const writes: { kind: RecordKind; id: string; version: number; data: any; hash: string }[] = [];
        const codeCount = [...members.values()].filter((m) => m.kind === 'C').length;
        let newCodes = 0;
        for (const it of items) {
          const key = `${it.entity}|${it.id}`;
          const cur = members.get(key);
          if (it.action === 'REUSE') {
            if (!cur) throw new AppError('REFERENCE_MISSING', `REUSE trỏ tới ${it.entity} ${it.id} không có trong release nền.`, 409);
            continue;
          }
          if (it.action === 'UPDATE' && (!cur || cur.version !== it.base_version)) throw new AppError('BASE_CHANGED', `${it.entity} ${it.id} đã đổi phiên bản so với nền của hồ sơ.`, 409, undefined, ['NEW_RUN']);
          if (it.action === 'ADD' && cur) throw new AppError('BASE_CHANGED', `${it.entity} ${it.id} đã tồn tại trong từ điển.`, 409, undefined, ['NEW_RUN']);
          const version = (cur?.version ?? 0) + 1;
          let data = it.data;
          if (it.entity === 'C' && it.action === 'ADD') data = { ...data, display_code: 'C' + String(codeCount + ++newCodes).padStart(2, '0') } satisfies CData;
          if (it.entity === 'R') data = { ...data, version_label: `1.${version - 1}` } satisfies RData;
          writes.push({ kind: it.entity, id: it.id, version, data, hash: hashJson(data) });
          members.set(key, { kind: it.entity, id: it.id, version });
        }
        // Reference check: every framework requirement must resolve inside the new release.
        const has = (k: RecordKind, id: string, v?: number) => {
          const m = members.get(`${k}|${id}`);
          return !!m && (v === undefined || m.version === v);
        };
        for (const w of writes) {
          if (w.kind === 'R')
            for (const q of (w.data as RData).requirements) {
              if (!has('C', q.competency_id)) throw new AppError('REFERENCE_MISSING', `Khung ${w.id} trỏ tới năng lực ${q.competency_id} không có trong release.`, 409);
              q.competency_version = members.get(`C|${q.competency_id}`)!.version;
              for (const ir of q.indicators) {
                if (!has('I', ir.indicator_id)) throw new AppError('REFERENCE_MISSING', `Khung ${w.id} trỏ tới chỉ báo ${ir.indicator_id} không có trong release.`, 409);
                ir.version = members.get(`I|${ir.indicator_id}`)!.version;
              }
              for (const e of q.evidence_ids) if (!has('V', e)) throw new AppError('REFERENCE_MISSING', `Khung ${w.id} trỏ tới bằng chứng ${e} không có trong release.`, 409);
            }
          if (w.kind === 'I' && !has('C', w.data.competency_id)) throw new AppError('REFERENCE_MISSING', `Chỉ báo ${w.id} trỏ tới năng lực không có trong release.`, 409);
          if (w.kind === 'R' || w.kind === 'I') w.hash = hashJson(w.data);
        }
        const changes: ChangeItem[] = items
          .filter((i) => i.entity !== 'V')
          .map((i) => ({ entity: i.entity, id: i.id, name: i.name, action: i.action, before: i.before, after: i.after, reason: i.reason, affected: i.affected }));
        const counts = { ADD: changes.filter((c) => c.action === 'ADD').length, UPDATE: changes.filter((c) => c.action === 'UPDATE').length, REUSE: changes.filter((c) => c.action === 'REUSE').length };
        const gId = `G-${String(seq).padStart(4, '0')}`;
        const gData: GData = { release_seq: seq, version_label: versionLabel, run_id: cand.runId, policy: 'jd-only-draft@1', decided_by: decision.decided_by, changes, note: decision.reason };
        writes.push({ kind: 'G', id: gId, version: 1, data: gData, hash: hashJson(gData) });
        members.set(`G|${gId}`, { kind: 'G', id: gId, version: 1 });

        if (writes.length) await tx.insert(t.dictRecord).values(writes.map((w) => ({ workspaceId, kind: w.kind, id: w.id, version: w.version, data: w.data, contentSha256: w.hash, releaseId })));
        const memberList = [...members.values()].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
        const diff = { counts, changes, dropped: decision.dropped_item_ids, written: writes.map((w) => ({ kind: w.kind, id: w.id, version: w.version, sha256: w.hash })) };
        const receiptHash = hashJson({ members: memberList, written: diff.written, parent: latestId, seq });
        const decidedAt = new Date().toISOString();
        await tx.insert(t.release).values({ releaseId, workspaceId, seq, parentReleaseId: latestId, versionLabel, runId: cand.runId, candidateId, decidedBy: decision.decided_by, decidedAt, diff, members: memberList, receiptHash, origin: 'B8' });
        await tx.update(t.candidate).set({ status: 'COMMITTED' }).where(eq(t.candidate.id, candidateId));
        await tx.update(t.run).set({ status: 'COMPLETE' }).where(eq(t.run.id, cand.runId));
        if (input.failAfterWrites) throw new AppError('INJECTED_FAILURE', 'Lỗi giả lập sau khi ghi (chỉ dùng trong test).', 500);
        await appendEvent(tx, { workspaceId, type: 'RELEASE_COMMITTED', actor: input.actor, runId: cand.runId, block: 'B8', outputHash: receiptHash, payload: { release_id: releaseId, version_label: versionLabel, counts, candidate_id: candidateId } });
        return { release_id: releaseId, version_label: versionLabel, parent_release_id: latestId, counts, hash: receiptHash, decided_by: decision.decided_by, decided_at: decidedAt, replayed: false } satisfies Receipt;
      },
      { isolationLevel: 'serializable' },
    );
  let receipt: Receipt | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      receipt = await run();
      break;
    } catch (e: any) {
      // serialization failure / unique race → retry; a replay then returns the stored receipt
      if ((e?.code === '40001' || e?.code === '23505' || e?.cause?.code === '40001' || e?.cause?.code === '23505') && attempt < 3) continue;
      throw e;
    }
  }
  await verifyReceipt(db, workspaceId, receipt.release_id);
  return receipt;
}

function receiptOf(r: typeof t.release.$inferSelect, replayed: boolean): Receipt {
  const d = r.diff as { counts: Receipt['counts'] };
  return { release_id: r.releaseId, version_label: r.versionLabel, parent_release_id: r.parentReleaseId, counts: d.counts, hash: r.receiptHash, decided_by: r.decidedBy, decided_at: new Date(r.decidedAt).toISOString(), replayed };
}

/** Post-commit reconciliation: what the receipt says was written must be what is stored. */
export async function verifyReceipt(db: DbOrTx, workspaceId: string, releaseId: string) {
  const [r] = await db.select().from(t.release).where(eq(t.release.releaseId, releaseId));
  if (!r) throw new AppError('RECEIPT_MISMATCH', 'Không tìm thấy release vừa ghi.', 500);
  const written = ((r.diff as any).written ?? []) as { kind: RecordKind; id: string; version: number; sha256: string }[];
  const recs = await loadRecords(db, workspaceId, written);
  for (const w of written) {
    const rec = recs.find((x) => x.kind === w.kind && x.id === w.id && x.version === w.version);
    if (!rec || rec.contentSha256 !== w.sha256 || hashJson(rec.data) !== w.sha256) throw new AppError('RECEIPT_MISMATCH', `Bản ghi ${w.kind} ${w.id}@${w.version} không khớp receipt.`, 500);
  }
  const all = await loadRecords(db, workspaceId, r.members as Member[]);
  if (all.length !== (r.members as Member[]).length) throw new AppError('RECEIPT_MISMATCH', 'Release tham chiếu bản ghi không tồn tại.', 500);
  return true;
}

/** Restore = a new release that points back at an older member set. History is never deleted. */
export async function revertRelease(db: Db, workspaceId: string, input: { release_id: string; reason: string; actor: string }): Promise<Receipt> {
  if (!input.reason?.trim()) throw new AppError('REASON_REQUIRED', 'Cần nhập lý do khôi phục.', 422);
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const [ws] = await tx.select().from(t.workspace).where(eq(t.workspace.id, workspaceId));
    if (ws?.stopState) throw new AppError('WORKSPACE_STOPPED', 'Workspace đang STOP.', 423);
    const latest = await latestRelease(tx, workspaceId);
    const [target] = await tx.select().from(t.release).where(and(eq(t.release.releaseId, input.release_id), eq(t.release.workspaceId, workspaceId)));
    if (!latest || !target) throw new AppError('NOT_FOUND', 'Không tìm thấy release.', 404);
    const [parent] = target.parentReleaseId ? await tx.select().from(t.release).where(eq(t.release.releaseId, target.parentReleaseId)) : [];
    const seq = latest.seq + 1;
    const releaseId = newId('rel');
    const versionLabel = versionLabelFor(seq);
    const gId = `G-${String(seq).padStart(4, '0')}`;
    const gData: GData = { release_seq: seq, version_label: versionLabel, run_id: null, policy: 'revert', decided_by: input.actor, changes: [], note: `Khôi phục về trước ${target.versionLabel}: ${input.reason.trim()}` };
    const keepG = (latest.members as Member[]).filter((m) => m.kind === 'G');
    const members = [...((parent?.members as Member[] | undefined) ?? []).filter((m) => m.kind !== 'G'), ...keepG, { kind: 'G' as const, id: gId, version: 1 }].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
    const gHash = hashJson(gData);
    await tx.insert(t.dictRecord).values({ workspaceId, kind: 'G', id: gId, version: 1, data: gData, contentSha256: gHash, releaseId });
    const counts = { ADD: 0, UPDATE: 0, REUSE: 0 };
    const diff = { counts, changes: [], dropped: [], written: [{ kind: 'G', id: gId, version: 1, sha256: gHash }] };
    const receiptHash = hashJson({ members, written: diff.written, parent: latest.releaseId, seq });
    const decidedAt = new Date().toISOString();
    await tx.insert(t.release).values({ releaseId, workspaceId, seq, parentReleaseId: latest.releaseId, versionLabel, runId: null, candidateId: null, decidedBy: input.actor, decidedAt, diff, members, receiptHash, reverts: target.releaseId, origin: 'REVERT' });
    await appendEvent(tx, { workspaceId, type: 'RELEASE_COMMITTED', actor: input.actor, outputHash: receiptHash, payload: { release_id: releaseId, reverts: target.releaseId, reason: input.reason.trim() } });
    return { release_id: releaseId, version_label: versionLabel, parent_release_id: latest.releaseId, counts, hash: receiptHash, decided_by: input.actor, decided_at: decidedAt, replayed: false };
  });
}
