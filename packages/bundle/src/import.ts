import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { AppError } from '@cl/contract';
import { appendEvent, hashJson, newId, sha256, t, type Db } from '@cl/db';
import { BUNDLE_FORMAT, DICT_FILES, EVENTS_FILE, RELEASES_FILE, RUN_TABLES, SCHEMA_VERSION, type Manifest } from './format';

export type ImportMode = 'RESTORE_EMPTY' | 'REAPPLY';
export interface ImportReport {
  ok: boolean;
  mode: ImportMode;
  export_kind: string;
  schema_version: string;
  exported_at: string;
  source_workspace_id: string;
  counts: Record<string, number>;
  duplicates: number;
  to_insert: number;
  conflicts: { ref: string; reason: string }[];
  errors: { code: string; message: string }[];
  redaction: Manifest['redaction'];
  lineage: { release_id: string; version_label: string; parent_release_id: string | null; restorable: boolean }[];
  completeness: string;
  preview_digest: string;
}

const MAX_TOTAL = 300 * 1024 * 1024;
const MAX_FILES = 5000;
const safePath = (p: string) => !!p && !p.startsWith('/') && !p.includes('\\') && !/^[A-Za-z]:/.test(p) && !p.split('/').some((s) => s === '..' || s === '.' || s === '') && !p.includes('\0');

interface Parsed {
  manifest: Manifest;
  rows: Map<string, any[]>;
  blobs: Map<string, Uint8Array>;
}

/** Unpack and validate everything that can be validated without the database. Throws AppError on a blocking problem. */
export function readBundle(zip: Uint8Array): Parsed {
  let entries: Record<string, Uint8Array>;
  let total = 0, n = 0;
  try {
    entries = unzipSync(zip, {
      filter(f) {
        n++;
        total += f.originalSize;
        if (n > MAX_FILES || total > MAX_TOTAL) throw new AppError('BUNDLE_TOO_LARGE', `Gói vượt giới hạn (${MAX_FILES} file, ${MAX_TOTAL / 1048576} MB sau giải nén).`, 413);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('BUNDLE_INVALID', 'File không phải ZIP hợp lệ.', 422);
  }
  const names = Object.keys(entries).filter((p) => !p.endsWith('/'));
  const bad = names.filter((p) => !safePath(p));
  if (bad.length) throw new AppError('UNSAFE_PATH', `Gói chứa đường dẫn không an toàn: ${bad.slice(0, 3).join(', ')}`, 422);
  if (!entries['manifest.json']) throw new AppError('BUNDLE_INVALID', 'Thiếu manifest.json.', 422);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json']));
  } catch {
    throw new AppError('BUNDLE_INVALID', 'manifest.json không phải JSON hợp lệ.', 422);
  }
  if (manifest.format !== BUNDLE_FORMAT) throw new AppError('BUNDLE_INVALID', `Định dạng "${manifest.format}" không phải ${BUNDLE_FORMAT}.`, 422);
  const [maj, min] = String(manifest.schema_version).split('.').map(Number);
  const [cMaj, cMin] = SCHEMA_VERSION.split('.').map(Number);
  if (!(maj === cMaj && min <= cMin)) throw new AppError('UNSUPPORTED_SCHEMA_VERSION', `Gói dùng schema_version ${manifest.schema_version}; bản này hỗ trợ tới ${SCHEMA_VERSION}.`, 422, { bundle: manifest.schema_version, supported: SCHEMA_VERSION });
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  for (const p of names) if (p !== 'manifest.json' && !listed.has(p)) throw new AppError('BUNDLE_INVALID', `File ${p} không có trong manifest.`, 422);
  for (const f of manifest.files) {
    if (!safePath(f.path)) throw new AppError('UNSAFE_PATH', `Manifest chứa đường dẫn không an toàn: ${f.path}`, 422);
    const b = entries[f.path];
    if (!b) throw new AppError('BUNDLE_INVALID', `Thiếu file ${f.path} đã khai trong manifest.`, 422);
    if (b.byteLength !== f.bytes || sha256(b) !== f.sha256) throw new AppError('CHECKSUM_MISMATCH', `File ${f.path} không khớp sha256 trong manifest.`, 422, { path: f.path });
  }
  const rows = new Map<string, any[]>();
  const blobs = new Map<string, Uint8Array>();
  for (const f of manifest.files) {
    if (f.path.endsWith('.jsonl')) {
      try {
        rows.set(f.path, strFromU8(entries[f.path]).split('\n').filter(Boolean).map((l) => JSON.parse(l)));
      } catch {
        throw new AppError('BUNDLE_INVALID', `File ${f.path} có dòng không phải JSON.`, 422);
      }
    } else if (f.path.startsWith('blobs/')) {
      const sha = f.path.slice(6);
      if (!/^[0-9a-f]{64}$/.test(sha) || sha256(entries[f.path]) !== sha) throw new AppError('CHECKSUM_MISMATCH', `Blob ${f.path} không khớp tên sha256.`, 422);
      blobs.set(sha, entries[f.path]);
    }
  }
  for (const p of [...DICT_FILES, RELEASES_FILE]) if (!rows.has(p)) throw new AppError('BUNDLE_INVALID', `Thiếu ${p}.`, 422);
  return { manifest, rows, blobs };
}

const recKey = (r: any) => `${r.kind}|${r.id}|${r.version}`;

/** Structural checks inside the bundle: schema of records, duplicate ids, content hashes, references and release lineage. */
function checkBundle(p: Parsed): { errors: ImportReport['errors']; records: any[]; releases: any[] } {
  const errors: ImportReport['errors'] = [];
  const records = DICT_FILES.flatMap((f) => p.rows.get(f)!);
  const releases = p.rows.get(RELEASES_FILE)!;
  const seen = new Set<string>();
  for (const r of records) {
    if (typeof r.kind !== 'string' || typeof r.id !== 'string' || !Number.isInteger(r.version) || typeof r.data !== 'object' || typeof r.content_sha256 !== 'string') {
      errors.push({ code: 'SCHEMA_INVALID', message: `Bản ghi sai schema: ${JSON.stringify(r).slice(0, 80)}` });
      continue;
    }
    if (seen.has(recKey(r))) errors.push({ code: 'DUPLICATE_ID', message: `Trùng ${r.kind} ${r.id}@${r.version} trong gói.` });
    seen.add(recKey(r));
    if (!r.redacted && hashJson(r.data) !== r.content_sha256) errors.push({ code: 'CHECKSUM_MISMATCH', message: `Nội dung ${r.kind} ${r.id}@${r.version} không khớp content_sha256.` });
  }
  const has = (k: string, id: string, v: number) => seen.has(`${k}|${id}|${v}`);
  for (const r of records.filter((x) => x.kind === 'R'))
    for (const q of r.data.requirements ?? []) {
      if (!has('C', q.competency_id, q.competency_version)) errors.push({ code: 'REFERENCE_MISSING', message: `Khung ${r.id}@${r.version} thiếu năng lực ${q.competency_id}@${q.competency_version}.` });
      for (const i of q.indicators ?? []) if (!has('I', i.indicator_id, i.version)) errors.push({ code: 'REFERENCE_MISSING', message: `Khung ${r.id}@${r.version} thiếu chỉ báo ${i.indicator_id}@${i.version}.` });
      for (const e of q.evidence_ids ?? []) if (!records.some((x) => x.kind === 'V' && x.id === e)) errors.push({ code: 'REFERENCE_MISSING', message: `Khung ${r.id}@${r.version} thiếu bằng chứng ${e}.` });
    }
  const relIds = new Set(releases.map((r) => r.release_id));
  for (const r of releases) {
    if (r.parent_release_id && !relIds.has(r.parent_release_id)) errors.push({ code: 'LINEAGE_BROKEN', message: `Release ${r.release_id} trỏ tới release cha không có trong gói.` });
    for (const m of r.members ?? []) if (!has(m.kind, m.id, m.version)) errors.push({ code: 'REFERENCE_MISSING', message: `Release ${r.version_label} thiếu bản ghi ${m.kind} ${m.id}@${m.version}.` });
  }
  for (const r of records) if (!relIds.has(r.release_id)) errors.push({ code: 'REFERENCE_MISSING', message: `Bản ghi ${r.kind} ${r.id}@${r.version} thuộc release không có trong gói.` });
  return { errors: errors.slice(0, 50), records, releases };
}

async function analyse(db: Db, workspaceId: string, p: Parsed, mode: ImportMode, digest: string): Promise<ImportReport> {
  const { errors, records, releases } = checkBundle(p);
  const conflicts: ImportReport['conflicts'] = [];
  let duplicates = 0, toInsert = 0;
  const existing = await db.select().from(t.dictRecord).where(eq(t.dictRecord.workspaceId, workspaceId));
  const exMap = new Map(existing.map((r) => [recKey(r), r]));
  for (const r of records) {
    const e = exMap.get(recKey(r));
    if (!e) toInsert++;
    else if (e.contentSha256 === r.content_sha256) duplicates++;
    else conflicts.push({ ref: `${r.kind} ${r.id}@${r.version}`, reason: 'Cùng id@version nhưng khác nội dung.' });
  }
  const exRel = await db.select().from(t.release).where(eq(t.release.workspaceId, workspaceId));
  for (const r of releases) {
    const e = exRel.find((x) => x.releaseId === r.release_id);
    if (!e) {
      toInsert++;
      if (exRel.some((x) => x.seq === r.seq)) conflicts.push({ ref: `release ${r.version_label}`, reason: 'Workspace đã có một release khác ở cùng vị trí lịch sử.' });
    } else if (e.receiptHash === r.receipt_hash) duplicates++;
    else conflicts.push({ ref: `release ${r.release_id}`, reason: 'Cùng release_id nhưng khác receipt_hash.' });
  }
  for (const def of RUN_TABLES) {
    const rows = p.rows.get(def.file) ?? [];
    if (!rows.length) continue;
    const have = new Set((await db.select().from(def.table as any)).map((x: any) => def.key(x)));
    for (const r of rows) (have.has(def.key(r)) ? duplicates++ : toInsert++);
  }
  const events = p.rows.get(EVENTS_FILE) ?? [];
  if (events.length) {
    const have = new Set((await db.select({ id: t.event.id }).from(t.event).where(eq(t.event.workspaceId, workspaceId))).map((e) => e.id));
    for (const e of events) (have.has(e.id) ? duplicates++ : toInsert++);
  }
  const [{ n: sessionCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.session).where(eq(t.session.workspaceId, workspaceId));
  const [{ n: eventCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.event).where(eq(t.event.workspaceId, workspaceId));
  if (mode === 'RESTORE_EMPTY' && (existing.length || exRel.length || sessionCount || (events.length && eventCount)))
    errors.push({ code: 'WORKSPACE_NOT_EMPTY', message: 'Chế độ "Khôi phục vào workspace rỗng" yêu cầu workspace chưa có từ điển, phiên hay nhật ký. Dùng "Tải lại cùng gói" để kiểm idempotency, hoặc khôi phục trên môi trường sạch.' });
  if (mode === 'REAPPLY' && toInsert > 0 && !conflicts.length) errors.push({ code: 'REAPPLY_MISMATCH', message: `Gói có ${toInsert} bản ghi chưa có trong workspace này: đây không phải workspace đã nhập gói. Hợp nhất hai workspace độc lập chưa được hỗ trợ.` });
  if (conflicts.length) errors.push({ code: 'CONTENT_CONFLICT', message: `${conflicts.length} bản ghi cùng id@version nhưng khác nội dung. Không ghi gì.` });
  const relIds = new Set(releases.map((r) => r.release_id));
  return {
    ok: !errors.length,
    mode,
    export_kind: p.manifest.export_kind,
    schema_version: p.manifest.schema_version,
    exported_at: p.manifest.exported_at,
    source_workspace_id: p.manifest.workspace_id,
    counts: p.manifest.counts,
    duplicates,
    to_insert: toInsert,
    conflicts: conflicts.slice(0, 50),
    errors,
    redaction: p.manifest.redaction,
    lineage: releases.map((r) => ({ release_id: r.release_id, version_label: r.version_label, parent_release_id: r.parent_release_id, restorable: !r.parent_release_id || relIds.has(r.parent_release_id) })),
    completeness: p.manifest.scope?.completeness ?? '',
    preview_digest: digest,
  };
}

export async function previewImport(db: Db, blobs: { put(b: Uint8Array): Promise<string> }, workspaceId: string, zip: Uint8Array, mode: ImportMode) {
  const parsed = readBundle(zip);
  const digest = sha256(zip);
  const report = await analyse(db, workspaceId, parsed, mode, digest);
  const blobSha256 = await blobs.put(zip);
  const id = newId('imp');
  await db.insert(t.importPreview).values({ id, workspaceId, digest, blobSha256, mode, report });
  return { id, report };
}

const fromIso = (row: Record<string, any>) => {
  const { redacted: _r, ...rest } = row;
  return rest;
};

/** Apply a previewed bundle in one transaction. Re-validates against the current workspace state first. */
export async function commitImport(db: Db, blobs: { get(s: string): Promise<Uint8Array | null>; put(b: Uint8Array): Promise<string> }, workspaceId: string, previewId: string, input: { preview_digest: string; actor: string }) {
  const [pv] = await db.select().from(t.importPreview).where(and(eq(t.importPreview.id, previewId), eq(t.importPreview.workspaceId, workspaceId)));
  if (!pv) throw new AppError('NOT_FOUND', 'Không tìm thấy bản nhập thử.', 404);
  if (pv.digest !== input.preview_digest) throw new AppError('PREVIEW_DIGEST_MISMATCH', 'preview_digest không khớp bản nhập thử.', 409);
  const zip = await blobs.get(pv.blobSha256);
  if (!zip || sha256(zip) !== pv.digest) throw new AppError('CHECKSUM_MISMATCH', 'Gói đã lưu không còn khớp digest của bản nhập thử.', 409);
  const parsed = readBundle(zip);
  const mode = pv.mode as ImportMode;
  const report = await analyse(db, workspaceId, parsed, mode, pv.digest);
  if (!report.ok) throw new AppError(report.errors[0].code, report.errors[0].message, 409, { errors: report.errors, conflicts: report.conflicts });
  let inserted = 0;
  if (mode === 'RESTORE_EMPTY') {
    for (const [sha, bytes] of parsed.blobs) if ((await blobs.put(bytes)) !== sha) throw new AppError('CHECKSUM_MISMATCH', `Blob ${sha} không khớp.`, 422);
    await db.transaction(async (tx) => {
      const records = DICT_FILES.flatMap((f) => parsed.rows.get(f)!);
      for (let i = 0; i < records.length; i += 200)
        await tx.insert(t.dictRecord).values(records.slice(i, i + 200).map((r) => ({ workspaceId, kind: r.kind, id: r.id, version: r.version, data: r.redacted ? { ...r.data, redacted: true } : r.data, contentSha256: r.content_sha256, releaseId: r.release_id, createdAt: r.created_at })));
      inserted += records.length;
      const releases = parsed.rows.get(RELEASES_FILE)!;
      // candidate_id/run_id only survive when the run-side rows come along (backup); otherwise they would dangle.
      const withRuns = parsed.manifest.export_kind === 'backup';
      for (const r of releases) await tx.insert(t.release).values({ releaseId: r.release_id, workspaceId, seq: r.seq, parentReleaseId: r.parent_release_id, versionLabel: r.version_label, runId: withRuns ? r.run_id : null, candidateId: withRuns ? r.candidate_id : null, decidedBy: r.decided_by, decidedAt: r.decided_at, diff: r.diff, members: r.members, receiptHash: r.receipt_hash, reverts: r.reverts ?? null, origin: withRuns ? r.origin : 'IMPORT' });
      inserted += releases.length;
      for (const def of RUN_TABLES) {
        const rows = (parsed.rows.get(def.file) ?? []).map((r) => ({ ...fromIso(r), ...('workspaceId' in r ? { workspaceId } : {}) }));
        for (let i = 0; i < rows.length; i += 100) await tx.insert(def.table as any).values(rows.slice(i, i + 100) as any);
        inserted += rows.length;
      }
      const events = parsed.rows.get(EVENTS_FILE) ?? [];
      // Same order, same hashes: the restored chain verifies exactly like the original.
      for (let i = 0; i < events.length; i += 200) await tx.insert(t.event).values(events.slice(i, i + 200).map(({ seq: _s, ...e }: any) => ({ ...e })));
      inserted += events.length;
      await appendEvent(tx, { workspaceId, type: 'IMPORT_COMMITTED', actor: input.actor, inputHash: pv.digest, payload: { preview_id: previewId, mode, inserted, source_workspace_id: parsed.manifest.workspace_id, export_kind: parsed.manifest.export_kind, exported_at: parsed.manifest.exported_at } });
    });
  } else {
    await appendEvent(db, { workspaceId, type: 'IMPORT_COMMITTED', actor: input.actor, inputHash: pv.digest, payload: { preview_id: previewId, mode, inserted: 0, duplicates: report.duplicates } });
  }
  const [latest] = await db.select().from(t.release).where(eq(t.release.workspaceId, workspaceId)).orderBy(desc(t.release.seq)).limit(1);
  return { mode, inserted, duplicates: report.duplicates, changes: inserted, latest_release: latest ? { release_id: latest.releaseId, version_label: latest.versionLabel } : null };
}

export async function listExports(db: Db, workspaceId: string) {
  return db.select().from(t.exportFile).where(eq(t.exportFile.workspaceId, workspaceId)).orderBy(asc(t.exportFile.createdAt));
}
