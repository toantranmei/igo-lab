import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '@cl/contract';
import { BLOCK_TASKS, DEFAULT_AGENT_CONFIG, TASKS, type AgentConfig, type TaskName } from '@cl/agents';
import { appendEvent, hashJson, newId, sha256, t, type Db } from '@cl/db';
import { NORMALIZER_VERSION, PARSER_VERSION, SEGMENTER_VERSION, crossCheck, parseFile, parsePasted, segmentId, uploadLimits, type BlobStore, type IngestWarning, type ParsedDocument } from '@cl/ingest';
import { getStop, latestRelease, safeLessons } from '@cl/registry';
import { DEFAULT_POLICY, type LoadedDoc, type RunSnapshot, type SnapDoc } from './types';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'role';

export async function createSession(db: Db, workspaceId: string, input: { name: string; role_title: string; purpose: string; context?: string; family?: string; industry?: string }, actor: string) {
  const name = input.name?.trim(), role = input.role_title?.trim(), purpose = input.purpose?.trim();
  const missing = [!name && 'tên phiên', !role && 'vị trí/role', !purpose && 'mục đích'].filter(Boolean);
  if (missing.length) throw new AppError('VALIDATION', `Thiếu: ${missing.join(', ')}.`, 422, { missing });
  const id = newId('ses');
  await db.insert(t.session).values({ id, workspaceId, name: name!, roleTitle: role!, roleId: slug(role!), purpose: purpose!, context: input.context?.trim() ?? '', family: input.family?.trim() || null, industry: input.industry?.trim() || null });
  await appendEvent(db, { workspaceId, type: 'SESSION_CREATED', actor, sessionId: id, payload: { name, role_title: role } });
  return { id };
}
export async function getSession(db: Db, workspaceId: string, id: string) {
  const [s] = await db.select().from(t.session).where(and(eq(t.session.id, id), eq(t.session.workspaceId, workspaceId)));
  if (!s) throw new AppError('NOT_FOUND', 'Không tìm thấy phiên.', 404);
  return s;
}
export async function listSessions(db: Db, workspaceId: string) {
  const sessions = await db.select().from(t.session).where(eq(t.session.workspaceId, workspaceId)).orderBy(desc(t.session.updatedAt));
  const runs = await db.select().from(t.run).where(eq(t.run.workspaceId, workspaceId)).orderBy(asc(t.run.runNo));
  return sessions.map((s) => ({
    id: s.id,
    mode: 'live' as const,
    name: s.name,
    roleTitle: s.roleTitle,
    updatedAt: new Date(s.updatedAt).toISOString(),
    runs: runs.filter((r) => r.sessionId === s.id).map((r) => ({ runNo: r.runNo, status: r.status, baseRelease: (r.snapshot as RunSnapshot).base_version_label, createdAt: new Date(r.createdAt).toISOString() })),
  }));
}

export interface DocInput {
  name: string;
  /** Pasted text, or text returned by a previous preview (possibly edited to remove personal data). */
  text?: string;
  /** Raw file bytes (preview only). */
  bytes?: Uint8Array;
  blob_sha256?: string | null;
  source_ref?: string;
  origin_group?: string;
  usage_note?: string;
  source_url?: string;
  /** Set when this is a new version of an existing document (edited text). */
  document_id?: string;
}
export interface DocPreview {
  name: string;
  source_kind: 'paste' | 'file';
  blob_sha256: string | null;
  text: string;
  chars: number;
  pages: number | null;
  segments: number;
  language: string;
  content_sha256: string;
  pii: ParsedDocument['pii'];
  warnings: IngestWarning[];
  ok: boolean;
  missing_fields: string[];
  existing: { document_id: string; version: number } | null;
}

async function existingDocs(db: Db, workspaceId: string) {
  return db.select({ documentId: t.documentVersion.documentId, version: t.documentVersion.version, contentSha256: t.documentVersion.contentSha256, blobSha256: t.documentVersion.blobSha256, name: t.documentVersion.originalName }).from(t.documentVersion).where(eq(t.documentVersion.workspaceId, workspaceId));
}

/** Parse + check, write nothing except content-addressed blobs of uploaded files. */
export async function previewDocuments(db: Db, blobs: BlobStore, workspaceId: string, inputs: DocInput[]): Promise<{ documents: DocPreview[]; limits: ReturnType<typeof uploadLimits> }> {
  const limits = uploadLimits();
  if (inputs.length > limits.maxFiles) throw new AppError('TOO_MANY_FILES', `Tối đa ${limits.maxFiles} tài liệu mỗi lần; bạn gửi ${inputs.length}.`, 413, { max: limits.maxFiles });
  const parsed: ParsedDocument[] = [];
  for (const i of inputs) parsed.push(i.bytes ? await parseFile(i.name, i.bytes, limits) : parsePasted(i.name, i.text ?? '', limits));
  for (let k = 0; k < inputs.length; k++) if (inputs[k].bytes && !parsed[k].warnings.some((w) => w.code === 'TOO_LARGE')) await blobs.put(inputs[k].bytes!);
  const existing = await existingDocs(db, workspaceId);
  const cross = crossCheck(parsed, existing.map((e) => ({ ref: `${e.name} (${e.documentId}@${e.version})`, content_sha256: e.contentSha256, blob_sha256: e.blobSha256 })));
  return {
    limits,
    documents: parsed.map((p, k) => {
      const missing_fields = [!inputs[k].source_ref?.trim() && 'nguồn', !inputs[k].origin_group?.trim() && 'tổ chức nguồn'].filter(Boolean) as string[];
      const warnings = [...p.warnings, ...cross[k], ...(missing_fields.length ? [{ code: 'MISSING_FIELD' as const, severity: 'info' as const, message: `Chưa nhập: ${missing_fields.join(', ')}.` }] : [])];
      const hit = existing.find((e) => e.contentSha256 === p.content_sha256) ?? null;
      return { name: p.original_name, source_kind: p.source_kind, blob_sha256: p.blob_sha256, text: p.normalized_text, chars: p.chars, pages: p.pages, segments: p.segments.length, language: p.language, content_sha256: p.content_sha256, pii: p.pii, warnings, ok: !warnings.some((w) => w.severity === 'error'), missing_fields, existing: hit ? { document_id: hit.documentId, version: hit.version } : null };
    }),
  };
}

/** Confirm a JD set: stores immutable document versions and a new jd_set revision. */
export async function confirmJdSet(db: Db, workspaceId: string, sessionId: string, docs: DocInput[], actor: string) {
  const session = await getSession(db, workspaceId, sessionId);
  const limits = uploadLimits();
  if (!docs.length) throw new AppError('VALIDATION', 'Bộ JD cần ít nhất một tài liệu.', 422);
  if (docs.length > limits.maxFiles) throw new AppError('TOO_MANY_FILES', `Tối đa ${limits.maxFiles} tài liệu.`, 413);
  const parsed = docs.map((d) => ({ d, p: parsePasted(d.name, d.text ?? '', limits) }));
  const bad = parsed.filter(({ p }) => p.warnings.some((w) => w.severity === 'error'));
  if (bad.length) throw new AppError('DOCUMENT_INVALID', `Tài liệu không hợp lệ: ${bad.map(({ p }) => `${p.original_name} (${p.warnings.find((w) => w.severity === 'error')!.message})`).join('; ')}`, 422);
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(t.documentVersion).where(eq(t.documentVersion.workspaceId, workspaceId));
    const refs: { document_id: string; version: number }[] = [];
    for (const { d, p } of parsed) {
      const source_ref = d.source_ref?.trim() || '';
      const same = existing.find((e) => e.contentSha256 === p.content_sha256 && e.sourceRef === source_ref && (e.originGroup ?? '') === (d.origin_group?.trim() ?? ''));
      if (same) {
        if (!refs.some((r) => r.document_id === same.documentId)) refs.push({ document_id: same.documentId, version: same.version });
        continue;
      }
      const documentId = d.document_id && existing.some((e) => e.documentId === d.document_id) ? d.document_id : 'doc_' + sha256(`${workspaceId}|${p.original_name}|${p.content_sha256}`).slice(0, 14);
      const version = Math.max(0, ...existing.filter((e) => e.documentId === documentId).map((e) => e.version)) + 1;
      const row = { workspaceId, documentId, version, sourceKind: d.blob_sha256 ? 'file' : 'paste', sourceRef: source_ref, originalName: p.original_name, contentSha256: p.content_sha256, blobSha256: d.blob_sha256 ?? null, normalizedText: p.normalized_text, normalizerVersion: NORMALIZER_VERSION, parserVersion: PARSER_VERSION, segmenterVersion: SEGMENTER_VERSION, segments: p.segments, originGroup: d.origin_group?.trim() || null, submittedBy: actor, roleId: session.roleId, language: p.language, checkStatus: p.warnings.some((w) => w.severity === 'warn') ? 'WARN' : 'OK', usageNote: d.usage_note?.trim() || null, sourceUrl: d.source_url?.trim() || null, meta: { chars: p.chars, pii: p.pii.length } };
      await tx.insert(t.documentVersion).values(row);
      existing.push({ ...row, submittedAt: new Date().toISOString() } as any);
      refs.push({ document_id: documentId, version });
    }
    const [prev] = await tx.select().from(t.jdSetRevision).where(eq(t.jdSetRevision.sessionId, sessionId)).orderBy(desc(t.jdSetRevision.revision)).limit(1);
    const jdSetId = prev?.jdSetId ?? newId('jds');
    const revision = (prev?.revision ?? 0) + 1;
    await tx.insert(t.jdSetRevision).values({ jdSetId, revision, workspaceId, sessionId, parentRevision: prev?.revision ?? null, documentRefs: refs, confirmedBy: actor });
    await tx.update(t.session).set({ updatedAt: new Date().toISOString() }).where(eq(t.session.id, sessionId));
    await appendEvent(tx, { workspaceId, type: 'JD_SET_CONFIRMED', actor, sessionId, payload: { jd_set_id: jdSetId, revision, documents: refs.length } });
    return { jd_set_id: jdSetId, revision, document_refs: refs };
  });
}

export async function latestJdSet(db: Db, sessionId: string) {
  const [r] = await db.select().from(t.jdSetRevision).where(eq(t.jdSetRevision.sessionId, sessionId)).orderBy(desc(t.jdSetRevision.revision)).limit(1);
  return r ?? null;
}
export async function loadDocs(db: Db, workspaceId: string, refs: { document_id: string; version: number }[]): Promise<LoadedDoc[]> {
  // One query for the whole set: per-document queries made the session state take seconds with 100+ JDs.
  const out: LoadedDoc[] = [];
  const ids = [...new Set(refs.map((r) => r.document_id))];
  const rows = ids.length ? await db.select().from(t.documentVersion).where(and(eq(t.documentVersion.workspaceId, workspaceId), inArray(t.documentVersion.documentId, ids))) : [];
  const byRef = new Map(rows.map((d) => [`${d.documentId}@${d.version}`, d]));
  for (const r of refs) {
    const d = byRef.get(`${r.document_id}@${r.version}`);
    if (!d) continue;
    out.push({ ref: `${d.documentId}@${d.version}`, document_id: d.documentId, version: d.version, original_name: d.originalName, content_sha256: sha256(d.normalizedText), source_kind: d.sourceKind, source_ref: d.sourceRef, origin_group: d.originGroup, check_status: d.checkStatus, language: d.language, usage_note: d.usageNote, source_url: d.sourceUrl, text: d.normalizedText, segments: (d.segments as any[]).map((s) => ({ id: segmentId(d.documentId, d.version, s.n), n: s.n, start: s.start, end: s.end, text: s.text })) });
  }
  return out;
}

export async function addUserEvent(db: Db, workspaceId: string, sessionId: string, input: { label: string; situation?: string; action?: string; outcome?: string; source_ref?: string }, actor: string) {
  await getSession(db, workspaceId, sessionId);
  if (!input.label?.trim() || !input.action?.trim()) throw new AppError('VALIDATION', 'Sự kiện cần tên và hành động.', 422);
  const id = newId('evt');
  await db.insert(t.userEvent).values({ id, workspaceId, sessionId, label: input.label.trim(), situation: input.situation?.trim() ?? '', action: input.action.trim(), outcome: input.outcome?.trim() ?? '', sourceRef: input.source_ref?.trim() ?? '', submittedBy: actor });
  return { id };
}
export const listUserEvents = (db: Db, sessionId: string) => db.select().from(t.userEvent).where(eq(t.userEvent.sessionId, sessionId)).orderBy(asc(t.userEvent.createdAt));
export async function removeUserEvent(db: Db, sessionId: string, id: string) {
  await db.delete(t.userEvent).where(and(eq(t.userEvent.id, id), eq(t.userEvent.sessionId, sessionId)));
}

/** What a run will send and call, shown on the confirmation screen before anything is sent. */
export function runPlan(jdCount: number, config: AgentConfig = DEFAULT_AGENT_CONFIG, eventCount = 0, hasRubric = false) {
  const m = (k: TaskName) => config.tasks[k];
  const row = (k: TaskName, unit: string, calls: string, skip?: string) => ({ task: k, task_id: TASKS[k].id, block: TASKS[k].block, title: TASKS[k].title, model: m(k).model, effort: m(k).effort, unit, calls, skip });
  const seats = config.seats.map((s) => s.model.replace('claude-', '')).join(' / ');
  return {
    tasks: [
      row('T1', 'mỗi JD', String(jdCount)),
      row('T2', 'mỗi JD hợp lệ', `≤ ${jdCount}`),
      row('T3', '1 lần/lượt; chia lô 100 khi nhiều hơn', '1+', 'bỏ qua nếu chỉ có 1 nhiệm vụ'),
      row('T4', 'mỗi JD hợp lệ', `≤ ${jdCount}`),
      row('T5', '1 lần/lượt; chia lô 100 khi nhiều hơn', '1+', 'bỏ qua nếu chỉ có 1 ứng viên'),
      row('T6', 'mỗi nhóm ứng viên có năng lực nền gần giống', 'K', 'bỏ qua khi từ điển nền rỗng'),
      row('T7', 'mỗi sự kiện thật', String(eventCount), eventCount ? undefined : 'bỏ qua: không có sự kiện thật'),
      row('T13', 'mỗi nhóm chưa có sự kiện thật', 'G'),
      row('T8', 'mỗi nhiệm vụ', 'T'),
      { ...row('T9', 'mỗi năng lực × 3 ghế', hasRubric ? '3C' : '0', hasRubric ? undefined : 'bỏ qua: không có rubric bậc'), model: seats },
      row('T10', 'mỗi năng lực', 'C', 'thêm một vòng viết lại cho chỉ báo dưới ngưỡng'),
      { ...row('T11', '3 ghế, mỗi ghế 1 lần', '3'), model: seats },
      row('T12', '1 lần/lượt', '1'),
    ],
    estimate: { fixed: jdCount * 3 + 2 + 3 + 1 + eventCount, note: `≈ ${jdCount * 3 + 6 + eventCount} + T + 2G + C lời gọi (T = số nhiệm vụ, G = số nhóm ứng viên, C = số năng lực). Ví dụ 8 JD, 6 nhiệm vụ, 6 nhóm: khoảng 48 lời gọi. Chạy lại cùng dữ liệu: 0 lời gọi.` },
    disclosure: 'Nội dung JD và sự kiện bạn nhập sẽ được gửi tới Anthropic qua Claude CLI bằng tài khoản đang đăng nhập trên máy chạy worker. Không có lời gọi nào trước khi bạn xác nhận ở bước này.',
    block_tasks: BLOCK_TASKS,
  };
}

export async function createRun(db: Db, workspaceId: string, sessionId: string, input: { acknowledge_send: boolean; base_release_id?: string | null; jd_set_revision?: number; cli_version?: string | null }, actor: string) {
  const session = await getSession(db, workspaceId, sessionId);
  if (!input.acknowledge_send) throw new AppError('CONFIRM_REQUIRED', 'Cần xác nhận màn chốt trước khi chạy: nội dung JD sẽ được gửi tới Anthropic qua Claude CLI.', 422, undefined, ['CONFIRM']);
  if (await getStop(db, workspaceId)) throw new AppError('WORKSPACE_STOPPED', 'Workspace đang STOP: không tạo lượt mới cho tới khi được mở lại.', 423, undefined, ['OPEN_AUDIT']);
  const sets = await db.select().from(t.jdSetRevision).where(eq(t.jdSetRevision.sessionId, sessionId)).orderBy(desc(t.jdSetRevision.revision));
  const jd = input.jd_set_revision ? sets.find((s) => s.revision === input.jd_set_revision) : sets[0];
  if (!jd) throw new AppError('NO_JD_SET', 'Phiên chưa có bộ JD được xác nhận.', 409, undefined, ['ADD_JD']);
  const docs = await loadDocs(db, workspaceId, jd.documentRefs as any[]);
  const latest = await latestRelease(db, workspaceId);
  let base: typeof latest | null = latest;
  if (input.base_release_id !== undefined && input.base_release_id !== (latest?.releaseId ?? null)) {
    if (input.base_release_id === null) base = null;
    else {
      const [r] = await db.select().from(t.release).where(and(eq(t.release.releaseId, input.base_release_id), eq(t.release.workspaceId, workspaceId)));
      if (!r) throw new AppError('NOT_FOUND', 'Không tìm thấy release nền.', 404);
      base = r;
    }
  }
  const events = await listUserEvents(db, sessionId);
  const lessons = await safeLessons(db, workspaceId);
  const snapshot: RunSnapshot = {
    schema: 1,
    session: { id: session.id, name: session.name, role_title: session.roleTitle, role_id: session.roleId, purpose: session.purpose, context: session.context, family: session.family, industry: session.industry },
    jd_set: { id: jd.jdSetId, revision: jd.revision },
    documents: docs.map(({ text: _t, segments: _s, ...d }): SnapDoc => d),
    events: events.map((e) => ({ id: e.id, label: e.label, situation: e.situation, action: e.action, outcome: e.outcome, source_ref: e.sourceRef })),
    base_release_id: base?.releaseId ?? null,
    base_version_label: base?.versionLabel ?? '0.0',
    policy: DEFAULT_POLICY,
    agent_config: DEFAULT_AGENT_CONFIG,
    cli_version: input.cli_version ?? null,
    lessons_loaded: lessons.map((l) => ({ id: l.id, fingerprint: l.fingerprint, text: (l.data as any).text })),
    rubric: [],
    versions: { normalizer: NORMALIZER_VERSION, segmenter: SEGMENTER_VERSION, parser: PARSER_VERSION },
  };
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${t.run.runNo}), 0)::int` }).from(t.run).where(eq(t.run.sessionId, sessionId));
    const id = newId('run');
    await tx.insert(t.run).values({ id, workspaceId, sessionId, runNo: n + 1, snapshot, status: 'OPEN', createdBy: actor });
    await tx.update(t.session).set({ updatedAt: new Date().toISOString() }).where(eq(t.session.id, sessionId));
    await appendEvent(tx, { workspaceId, type: 'INPUT_LOCKED', actor, sessionId, runId: id, inputHash: hashJson(snapshot), versions: { policy: `${snapshot.policy.id}@${snapshot.policy.version}`, agents: snapshot.agent_config.version, cli: snapshot.cli_version }, payload: { run_no: n + 1, documents: snapshot.documents.map((d) => ({ ref: d.ref, sha256: d.content_sha256 })), base_release_id: snapshot.base_release_id, jd_set: snapshot.jd_set, lessons_loaded: snapshot.lessons_loaded.map((l) => l.id) } });
    return { id, run_no: n + 1 };
  });
}
export async function currentRun(db: Db, sessionId: string) {
  const [r] = await db.select().from(t.run).where(eq(t.run.sessionId, sessionId)).orderBy(desc(t.run.runNo)).limit(1);
  return r ?? null;
}
