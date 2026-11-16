import { NextRequest, NextResponse } from 'next/server';
import { asc, desc, eq } from 'drizzle-orm';
import { AppError } from '@cl/contract';
import { DEFAULT_AGENT_CONFIG, MIN_CLI_VERSION } from '@cl/agents';
import { commitImport, createExport, exportFramework, listExports, previewImport, type ImportMode } from '@cl/bundle';
import { DEFAULT_WORKSPACE_ID, getDb, t, verifyEventChain } from '@cl/db';
import { defaultBlobStore, fetchRows, uploadLimits, SUPPORTED_EXTENSIONS } from '@cl/ingest';
import {
  DEFAULT_POLICY, acknowledge, createSourceSearch, getSourceSearch, addUserEvent, assertBlock, confirmJdSet, createRun, createSession, currentRun, getCandidate, getDetail, getSession, getState, getTrace, latestJdSet, listSessions, listUserEvents, liveCatalog, loadDocs, localActor, previewDocuments, removeUserEvent, requirePermission, runPlan, setCursor, startAttempt, workerStatus,
  type DocInput, type Permission,
} from '@cl/pipeline';
import { commitCandidate, decideCandidate, decideLessons, getStop, listReleases, loadDictionary, raiseStop, reopenWorkspace, revertRelease, toDictView } from '@cl/registry';

const WS = DEFAULT_WORKSPACE_ID;
type H = (c: { req: NextRequest; p: Record<string, string>; q: URLSearchParams; body: () => Promise<any>; actor: ReturnType<typeof localActor> }) => Promise<unknown>;
const routes: { method: string; pattern: string[]; perm: Permission; h: H }[] = [];
const on = (method: string, path: string, perm: Permission, h: H) => routes.push({ method, pattern: path.split('/').filter(Boolean), perm, h });
const db = () => getDb();
const blobs = () => defaultBlobStore();
const file = (bytes: Uint8Array, name: string, type: string) => new NextResponse(Buffer.from(bytes), { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name.replace(/[^\w.\-]+/g, '_')}"`, 'cache-control': 'no-store' } });

// ---- sessions ----
on('GET', '/sessions', 'VIEW', () => listSessions(db(), WS));
on('POST', '/sessions', 'OPERATE', async ({ body, actor }) => createSession(db(), WS, await body(), actor.id));
on('GET', '/sessions/:id', 'VIEW', async ({ p }) => {
  const s = await getSession(db(), WS, p.id);
  const jd = await latestJdSet(db(), p.id);
  const docs = jd ? await loadDocs(db(), WS, jd.documentRefs as any[]) : [];
  const run = await currentRun(db(), p.id);
  const releases = await listReleases(db(), WS);
  const events = await listUserEvents(db(), p.id);
  return {
    session: { id: s.id, name: s.name, role_title: s.roleTitle, purpose: s.purpose, context: s.context, family: s.family, industry: s.industry },
    jd_set: jd ? { id: jd.jdSetId, revision: jd.revision, documents: docs.map((d) => ({ ref: d.ref, document_id: d.document_id, name: d.original_name, text: d.text, source_ref: d.source_ref, origin_group: d.origin_group ?? '', usage_note: d.usage_note ?? '', source_url: d.source_url ?? '', chars: Array.from(d.text).length, segments: d.segments.length })) } : null,
    events: events.map((e) => ({ id: e.id, label: e.label, situation: e.situation, action: e.action, outcome: e.outcome, source_ref: e.sourceRef })),
    run: run ? { id: run.id, run_no: run.runNo, status: run.status, jd_set_revision: (run.snapshot as any).jd_set.revision, base_version_label: (run.snapshot as any).base_version_label } : null,
    releases: releases.map((r) => ({ release_id: r.releaseId, version_label: r.versionLabel, decided_at: new Date(r.decidedAt).toISOString() })),
    plan: runPlan(docs.length, DEFAULT_AGENT_CONFIG, events.length),
    policy: DEFAULT_POLICY,
    limits: { ...uploadLimits(), extensions: SUPPORTED_EXTENSIONS },
    worker: await workerStatus(db()),
    stop: await getStop(db(), WS),
  };
});
on('GET', '/limits', 'VIEW', async () => ({ ...uploadLimits(), extensions: SUPPORTED_EXTENSIONS }));
// Public Hugging Face datasets as a JD source: an AI scan (queued here, run by the worker) finds the rows of a
// role; the rows the user picks are then read and go through the normal preview below.
on('POST', '/sources/huggingface/searches', 'OPERATE', async ({ body, actor }) => createSourceSearch(db(), WS, await body(), actor.id));
on('GET', '/sources/huggingface/searches/:id', 'VIEW', ({ p }) => getSourceSearch(db(), WS, p.id));
on('POST', '/sources/huggingface/rows', 'OPERATE', async ({ body }) => {
  const b = await body();
  return fetchRows(String(b.link ?? ''), Array.isArray(b.rows) ? b.rows.map(Number) : []);
});
on('POST', '/sessions/:id/jd-sets/preview', 'OPERATE', async ({ req, p }) => {
  await getSession(db(), WS, p.id);
  const form = await req.formData();
  const meta = JSON.parse(String(form.get('meta') ?? '[]')) as Partial<DocInput>[];
  const inputs: DocInput[] = [];
  for (const m of meta) inputs.push({ name: m.name ?? 'Bản dán', text: m.text ?? '', source_ref: m.source_ref, origin_group: m.origin_group, blob_sha256: m.blob_sha256 });
  for (const f of form.getAll('files')) if (f instanceof File) inputs.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  return previewDocuments(db(), blobs(), WS, inputs);
});
on('POST', '/sessions/:id/jd-sets', 'OPERATE', async ({ p, body, actor }) => confirmJdSet(db(), WS, p.id, (await body()).documents ?? [], actor.id));
on('POST', '/sessions/:id/events', 'OPERATE', async ({ p, body, actor }) => addUserEvent(db(), WS, p.id, await body(), actor.id));
on('DELETE', '/sessions/:id/events/:eid', 'OPERATE', async ({ p }) => (await removeUserEvent(db(), p.id, p.eid), { ok: true }));
on('POST', '/sessions/:id/runs', 'OPERATE', async ({ p, body, actor }) => {
  const b = await body();
  const ws = await workerStatus(db());
  return createRun(db(), WS, p.id, { acknowledge_send: !!b.acknowledge_send, base_release_id: b.base_release_id, jd_set_revision: b.jd_set_revision, cli_version: ws.cliVersion }, actor.id);
});
on('GET', '/sessions/:id/state', 'VIEW', ({ p }) => getState(db(), WS, p.id));
on('GET', '/sessions/:id/catalog', 'VIEW', ({ p }) => liveCatalog(db(), WS, p.id));
on('GET', '/sessions/:id/candidate', 'VIEW', ({ p }) => getCandidate(db(), WS, p.id));
on('GET', '/sessions/:id/current/blocks/:block/detail', 'VIEW', ({ p }) => getDetail(db(), WS, p.id, assertBlock(p.block)));
on('GET', '/sessions/:id/current/blocks/:block/trace', 'VIEW', ({ p }) => getTrace(db(), WS, p.id, assertBlock(p.block)));
on('POST', '/sessions/:id/current/blocks/:block/attempts', 'OPERATE', async ({ req, p, body, actor }) => startAttempt(db(), WS, p.id, assertBlock(p.block), req.headers.get('idempotency-key') ?? '', { rerun_tasks: (await body()).rerun_tasks, actor: actor.id }));
on('PUT', '/sessions/:id/current/blocks/:block/cursor', 'VIEW', async ({ p, body }) => (await setCursor(db(), p.id, assertBlock(p.block), Number((await body()).cursor ?? 0)), { ok: true }));
on('POST', '/sessions/:id/current/blocks/:block/ack', 'OPERATE', async ({ p, actor }) => (await acknowledge(db(), WS, p.id, assertBlock(p.block), actor.id), { ok: true }));

// ---- publish / governance (decisions of an authorised person, never automatic) ----
on('POST', '/candidates/:id/decision', 'APPROVE', async ({ p, body, actor }) => decideCandidate(db(), WS, p.id, { ...(await body()), actor: actor.id }));
on('POST', '/candidates/:id/commit', 'APPROVE', async ({ p, body, actor }) => commitCandidate(db(), WS, p.id, { expected_base_release_id: (await body()).expected_base_release_id ?? null, actor: actor.id }));
on('POST', '/workspace/stop', 'APPROVE', async ({ body, actor }) => {
  const b = await body();
  if (!b.reason?.trim()) throw new AppError('REASON_REQUIRED', 'Cần nhập lý do STOP.', 422);
  return raiseStop(db(), WS, { reason: b.reason.trim(), actor: actor.id });
});
on('POST', '/workspace/reopen', 'APPROVE', async ({ body, actor }) => reopenWorkspace(db(), WS, { reason: (await body()).reason, actor: actor.id }));
on('POST', '/lessons/decision', 'APPROVE', async ({ body, actor }) => {
  const b = await body();
  return decideLessons(db(), WS, { lesson_ids: b.lesson_ids, decision: b.decision === 'REJECTED' ? 'REJECTED' : 'SAFE', reason: b.reason, actor: actor.id });
});
on('POST', '/lessons/:id/decision', 'APPROVE', async ({ p, body, actor }) => {
  const b = await body();
  return decideLessons(db(), WS, { lesson_ids: [p.id], decision: b.decision === 'REJECTED' ? 'REJECTED' : 'SAFE', reason: b.reason, actor: actor.id });
});
on('GET', '/workspace', 'VIEW', async ({ actor }) => ({ stop: await getStop(db(), WS), permissions: actor.permissions, actor: actor.id, event_chain: await verifyEventChain(db(), WS), worker: await workerStatus(db()) }));

// ---- dictionary ----
on('GET', '/releases', 'VIEW', async () => (await listReleases(db(), WS)).map((r) => ({ release_id: r.releaseId, seq: r.seq, version_label: r.versionLabel, parent_release_id: r.parentReleaseId, decided_by: r.decidedBy, decided_at: new Date(r.decidedAt).toISOString(), counts: (r.diff as any).counts, receipt_hash: r.receiptHash, reverts: r.reverts, origin: r.origin })));
on('GET', '/releases/:id/:part', 'VIEW', async ({ p }) => {
  const d = await loadDictionary(db(), WS, p.id);
  if (!d.releaseId) throw new AppError('NOT_FOUND', 'Không tìm thấy release.', 404);
  if (p.part === 'competencies') return d.C.map((c) => ({ id: c.id, version: c.version, ...c.data }));
  if (p.part === 'frameworks') return d.RAll.map((f) => ({ id: f.id, record_version: f.version, ...f.data }));
  if (p.part === 'graph') return toDictView(db(), WS, d);
  throw new AppError('NOT_FOUND', 'Không có phần này.', 404);
});
on('POST', '/releases/:id/revert', 'APPROVE', async ({ p, body, actor }) => revertRelease(db(), WS, { release_id: p.id, reason: (await body()).reason, actor: actor.id }));

// ---- agents ----
on('GET', '/agents/status', 'VIEW', async () => ({ ...(await workerStatus(db())), min_cli_version: MIN_CLI_VERSION, config: DEFAULT_AGENT_CONFIG, plan: runPlan(0) }));

// ---- export / import ----
on('GET', '/exports', 'VIEW', async () => (await listExports(db(), WS)).map((e) => ({ id: e.id, kind: e.kind, file_name: e.fileName, created_at: new Date(e.createdAt).toISOString(), manifest: e.manifest })).reverse());
on('POST', '/exports', 'BACKUP_ADMIN', async ({ body, actor }) => {
  const b = await body();
  if (b.kind !== 'dictionary' && b.kind !== 'backup') throw new AppError('VALIDATION', 'kind phải là dictionary hoặc backup.', 422);
  return createExport(db(), blobs(), WS, { kind: b.kind, metadata_only: !!b.metadata_only, include_blobs: !!b.include_blobs, session_ids: Array.isArray(b.session_ids) ? b.session_ids : undefined }, actor.id);
});
on('GET', '/exports/framework', 'VIEW', async ({ q }) => {
  const sid = q.get('session');
  const s = sid ? await getSession(db(), WS, sid) : null;
  const data = await exportFramework(db(), WS, { role_id: s?.roleId, framework_id: q.get('framework') ?? undefined, version_label: q.get('version') ?? undefined });
  return file(new TextEncoder().encode(JSON.stringify(data, null, 2)), `framework-${data.framework.role_id}-${data.framework.version_label}.json`, 'application/json');
});
on('GET', '/exports/:id/download', 'BACKUP_ADMIN', async ({ p }) => {
  const [e] = await db().select().from(t.exportFile).where(eq(t.exportFile.id, p.id));
  const bytes = e ? await blobs().get(e.blobSha256) : null;
  if (!e || !bytes) throw new AppError('NOT_FOUND', 'Không tìm thấy gói export.', 404);
  return file(bytes, e.fileName, 'application/zip');
});
on('POST', '/imports/preview', 'BACKUP_ADMIN', async ({ req }) => {
  const form = await req.formData();
  const f = form.get('file');
  if (!(f instanceof File)) throw new AppError('VALIDATION', 'Thiếu file gói.', 422);
  const mode = (String(form.get('mode') ?? 'RESTORE_EMPTY') === 'REAPPLY' ? 'REAPPLY' : 'RESTORE_EMPTY') as ImportMode;
  return previewImport(db(), blobs(), WS, new Uint8Array(await f.arrayBuffer()), mode);
});
on('POST', '/imports/:id/commit', 'BACKUP_ADMIN', async ({ p, body, actor }) => commitImport(db(), blobs(), WS, p.id, { preview_digest: (await body()).preview_digest, actor: actor.id }));
on('GET', '/events', 'VIEW', async ({ q }) => {
  const rows = await db().select().from(t.event).where(eq(t.event.workspaceId, WS)).orderBy(q.get('order') === 'asc' ? asc(t.event.seq) : desc(t.event.seq)).limit(Math.min(500, Number(q.get('limit') ?? 100)));
  return rows.map((e) => ({ seq: e.seq, id: e.id, type: e.type, actor: e.actor, block: e.block, run_id: e.runId, time: new Date(e.serverTime).toISOString(), payload: e.payload }));
});

export async function handle(req: NextRequest, path: string[]): Promise<Response> {
  try {
    const hit = routes
      .map((r) => {
        if (r.method !== req.method || r.pattern.length !== path.length) return null;
        const p: Record<string, string> = {};
        for (let i = 0; i < path.length; i++) {
          if (r.pattern[i].startsWith(':')) p[r.pattern[i].slice(1)] = decodeURIComponent(path[i]);
          else if (r.pattern[i] !== path[i]) return null;
        }
        return { r, p, literal: r.pattern.filter((s) => !s.startsWith(':')).length };
      })
      .filter(Boolean)
      .sort((a, b) => b!.literal - a!.literal)[0];
    if (!hit) throw new AppError('NOT_FOUND', 'Không có API này.', 404);
    const actor = localActor();
    requirePermission(actor, hit.r.perm);
    let cached: any;
    const body = async () => (cached ??= await req.json().catch(() => ({})));
    const out = await hit.r.h({ req, p: hit.p, q: req.nextUrl.searchParams, body, actor });
    if (out instanceof Response) return out;
    return NextResponse.json(out ?? null, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    if (e instanceof AppError || (e && typeof e.code === 'string' && typeof e.status === 'number')) return NextResponse.json({ code: e.code, message: e.message, details: e.details ?? null, actions: e.actions ?? [] }, { status: e.status });
    const down = /ECONNREFUSED|connect|CONNECTION/i.test(String(e?.code ?? e?.message ?? ''));
    console.error('[api]', req.method, path.join('/'), e?.message ?? e);
    return NextResponse.json({ code: down ? 'DB_UNAVAILABLE' : 'INTERNAL', message: down ? 'Không kết nối được Postgres. Chạy `pnpm db:up` rồi `pnpm db:migrate`.' : 'Lỗi máy chủ không mong đợi. Xem log của web để biết chi tiết.', details: null, actions: ['RETRY'] }, { status: down ? 503 : 500 });
  }
}
