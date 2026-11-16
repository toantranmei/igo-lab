import { scrubPaths } from '@cl/contract';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { AppError } from '@cl/contract';
import { appendEvent, newId, sha256, t, type Db, type DbOrTx } from '@cl/db';
import { BUNDLE_FORMAT, BUNDLE_README, BUNDLE_SCHEMAS, EVENTS_FILE, RELEASES_FILE, RUN_TABLES, SCHEMA_VERSION, kindFile, type ExportKind, type Manifest } from './format';

export interface ExportOptions {
  kind: ExportKind;
  metadata_only?: boolean;
  include_blobs?: boolean;
  /** Backup only: limit run-side data to these sessions. */
  session_ids?: string[];
}
export interface BlobReader {
  get(sha256: string): Promise<Uint8Array | null>;
}

const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d\d-\d\d[ T]/.test(v) ? new Date(v).toISOString() : v);
const stamp = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, /At$|Time$/.test(k) ? iso(v) : v]));
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

/** Build the ZIP inside one REPEATABLE READ read-only transaction so every file sees the same snapshot. */
export async function buildBundle(db: Db, blobs: BlobReader | null, workspaceId: string, opts: ExportOptions): Promise<{ zip: Uint8Array; manifest: Manifest }> {
  const files = new Map<string, Uint8Array>();
  const counts: Record<string, number> = {};
  const redacted: string[] = [];
  const put = (path: string, rows: unknown[]) => {
    files.set(path, strToU8(jsonl(rows)));
    counts[path] = rows.length;
  };
  let releaseId: string | null = null, releaseVersion = '0.0';
  const blobShas = new Set<string>();
  await db.transaction(
    async (tx: DbOrTx) => {
      const records = await tx.select().from(t.dictRecord).where(eq(t.dictRecord.workspaceId, workspaceId)).orderBy(asc(t.dictRecord.kind), asc(t.dictRecord.id), asc(t.dictRecord.version));
      for (const kind of ['W', 'C', 'I', 'R', 'V', 'G'])
        put(
          kindFile(kind),
          records
            .filter((r) => r.kind === kind)
            .map((r) => {
              const base = { kind: r.kind, id: r.id, version: r.version, data: r.data as any, content_sha256: r.contentSha256, release_id: r.releaseId, created_at: iso(r.createdAt) };
              if (opts.metadata_only && kind === 'V') {
                redacted.push(`V:${r.id}@${r.version}`);
                return { ...base, data: { ...base.data, quote: '' }, redacted: true };
              }
              return base;
            }),
        );
      const releases = await tx.select().from(t.release).where(eq(t.release.workspaceId, workspaceId)).orderBy(asc(t.release.seq));
      put(RELEASES_FILE, releases.map((r) => ({ release_id: r.releaseId, seq: r.seq, parent_release_id: r.parentReleaseId, version_label: r.versionLabel, run_id: r.runId, candidate_id: r.candidateId, decided_by: r.decidedBy, decided_at: iso(r.decidedAt), diff: r.diff, members: r.members, receipt_hash: r.receiptHash, reverts: r.reverts, origin: r.origin })));
      releaseId = releases.at(-1)?.releaseId ?? null;
      releaseVersion = releases.at(-1)?.versionLabel ?? '0.0';
      if (opts.kind !== 'backup') return;

      const scope = opts.session_ids?.length ? opts.session_ids : null;
      const sessions = (await tx.select().from(t.session).where(eq(t.session.workspaceId, workspaceId))).filter((s) => !scope || scope.includes(s.id));
      const sids = sessions.map((s) => s.id);
      const runs = sids.length ? await tx.select().from(t.run).where(inArray(t.run.sessionId, sids)).orderBy(asc(t.run.createdAt)) : [];
      const rids = runs.map((r) => r.id);
      const jd = sids.length ? await tx.select().from(t.jdSetRevision).where(inArray(t.jdSetRevision.sessionId, sids)).orderBy(asc(t.jdSetRevision.jdSetId), asc(t.jdSetRevision.revision)) : [];
      const docKeys = new Set(jd.flatMap((j) => (j.documentRefs as any[]).map((d) => `${d.document_id}@${d.version}`)));
      const docs = (await tx.select().from(t.documentVersion).where(eq(t.documentVersion.workspaceId, workspaceId)).orderBy(asc(t.documentVersion.documentId), asc(t.documentVersion.version))).filter((d) => !scope || docKeys.has(`${d.documentId}@${d.version}`));
      const attempts = rids.length ? await tx.select().from(t.blockAttempt).where(inArray(t.blockAttempt.runId, rids)).orderBy(asc(t.blockAttempt.createdAt), asc(t.blockAttempt.id)) : [];
      const calls = rids.length ? await tx.select().from(t.agentCall).where(inArray(t.agentCall.runId, rids)).orderBy(asc(t.agentCall.startedAt), asc(t.agentCall.id)) : [];
      const keys = [...new Set(calls.map((c) => c.taskKey))];
      const results: (typeof t.agentResult.$inferSelect)[] = [];
      for (let i = 0; i < keys.length; i += 500) results.push(...(await tx.select().from(t.agentResult).where(inArray(t.agentResult.taskKey, keys.slice(i, i + 500)))));
      const rowsBy: Record<string, any[]> = {
        'runs/sessions.jsonl': sessions,
        'runs/documents.jsonl': docs.map((d) => {
          if (d.blobSha256) blobShas.add(d.blobSha256);
          if (!opts.metadata_only) return d;
          redacted.push(`document:${d.documentId}@${d.version}`);
          return { ...d, normalizedText: '', segments: (d.segments as any[]).map((s) => ({ ...s, text: '' })), redacted: true };
        }),
        'runs/jd_revisions.jsonl': jd,
        'runs/user_events.jsonl': sids.length ? await tx.select().from(t.userEvent).where(inArray(t.userEvent.sessionId, sids)).orderBy(asc(t.userEvent.createdAt)) : [],
        'runs/runs.jsonl': runs,
        'runs/attempts.jsonl': attempts.map((a) => ({ ...a, ...(opts.metadata_only ? { output: null, trace: null, redacted: true } : {}), error: a.error ? JSON.parse(scrubPaths(JSON.stringify(a.error))) : null })),
        'runs/view_cursors.jsonl': rids.length ? await tx.select().from(t.viewCursor).where(inArray(t.viewCursor.runId, rids)).orderBy(asc(t.viewCursor.runId), asc(t.viewCursor.block)) : [],
        'runs/candidates.jsonl': rids.length ? await tx.select().from(t.candidate).where(inArray(t.candidate.runId, rids)).orderBy(asc(t.candidate.createdAt)) : [],
        'runs/findings.jsonl': await tx.select().from(t.finding).where(eq(t.finding.workspaceId, workspaceId)).orderBy(asc(t.finding.createdAt), asc(t.finding.id)),
        'runs/lessons.jsonl': await tx.select().from(t.lesson).where(eq(t.lesson.workspaceId, workspaceId)).orderBy(asc(t.lesson.createdAt), asc(t.lesson.id)),
        'runs/agent_calls.jsonl': calls.map((c) => ({ ...c, error: c.error ? scrubPaths(c.error) : null })),
        'runs/agent_results.jsonl': opts.metadata_only ? [] : results.sort((a, b) => a.taskKey.localeCompare(b.taskKey)),
      };
      if (opts.metadata_only) for (const a of attempts) redacted.push(`attempt:${a.id}`);
      for (const def of RUN_TABLES) put(def.file, rowsBy[def.file].map(stamp));
      // The event log is exported whole (a partial chain could not be verified) unless the backup is scoped.
      const events = await tx.select().from(t.event).where(eq(t.event.workspaceId, workspaceId)).orderBy(asc(t.event.seq));
      put(EVENTS_FILE, (scope ? [] : events).map(stamp));
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  let includedBlobs = 0;
  if (opts.kind === 'backup' && opts.include_blobs && blobs)
    for (const sha of [...blobShas].sort()) {
      const b = await blobs.get(sha);
      if (b) {
        files.set(`blobs/${sha}`, b);
        includedBlobs++;
      }
    }
  counts.blobs = includedBlobs;
  for (const [p, schema] of Object.entries(BUNDLE_SCHEMAS)) files.set(p, strToU8(JSON.stringify(schema, null, 2)));
  files.set('README.md', strToU8(BUNDLE_README));
  const manifest: Manifest = {
    format: BUNDLE_FORMAT,
    schema_version: SCHEMA_VERSION,
    export_kind: opts.kind,
    exported_at: new Date().toISOString(),
    workspace_id: workspaceId,
    release_id: releaseId,
    release_version: releaseVersion,
    scope: {
      sessions: opts.kind === 'backup' ? (opts.session_ids?.length ? opts.session_ids : 'all') : 'none',
      includes_blobs: includedBlobs > 0,
      completeness: opts.kind === 'dictionary' ? 'Từ điển đã công bố (W/C/I/R/V/G + lịch sử release). Không có phiên, JD gốc, lượt chạy.' : opts.session_ids?.length ? 'Backup theo phạm vi phiên: từ điển đầy đủ + dữ liệu của các phiên đã chọn; không kèm nhật ký sự kiện nên không khôi phục được vào workspace rỗng với chuỗi kiểm toán đầy đủ.' : 'Backup đầy đủ: từ điển + mọi phiên, JD, lượt, nhật ký sự kiện, lời gọi agent.',
    },
    counts,
    files: [...files.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: sha256(bytes), ...(path.endsWith('.jsonl') ? { records: counts[path] ?? 0 } : {}) })),
    redaction: { metadata_only: !!opts.metadata_only, redacted_refs: redacted.sort() },
  };
  const entries: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
  for (const [p, b] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) entries[p] = b;
  return { zip: zipSync(entries, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') }), manifest };
}

export async function createExport(db: Db, blobs: { put(b: Uint8Array): Promise<string>; get(s: string): Promise<Uint8Array | null> }, workspaceId: string, opts: ExportOptions, actor: string) {
  const { zip, manifest } = await buildBundle(db, blobs, workspaceId, opts);
  const blobSha256 = await blobs.put(zip);
  const id = newId('exp');
  const fileName = `competence-lab-${opts.kind}-${manifest.release_version}-${manifest.exported_at.slice(0, 10)}.zip`;
  await db.insert(t.exportFile).values({ id, workspaceId, kind: opts.kind, blobSha256, fileName, manifest });
  await appendEvent(db, { workspaceId, type: 'EXPORT_CREATED', actor, outputHash: blobSha256, payload: { export_id: id, kind: opts.kind, metadata_only: !!opts.metadata_only, include_blobs: !!opts.include_blobs, files: manifest.files.length } });
  return { id, file_name: fileName, bytes: zip.byteLength, sha256: blobSha256, manifest };
}

/** One framework version as a single self-contained JSON: the R record plus exactly the C/I versions and tasks it locks. */
export async function exportFramework(db: Db, workspaceId: string, input: { framework_id?: string; role_id?: string; version_label?: string }) {
  const rows = await db.select().from(t.dictRecord).where(and(eq(t.dictRecord.workspaceId, workspaceId), eq(t.dictRecord.kind, 'R')));
  const mine = rows.filter((r) => (input.framework_id ? r.id === input.framework_id : input.role_id ? (r.data as any).role_id === input.role_id : true)).sort((a, b) => a.version - b.version);
  const r = input.version_label ? mine.find((x) => (x.data as any).version_label === input.version_label) : mine.at(-1);
  if (!r) throw new AppError('NOT_FOUND', 'Không tìm thấy phiên bản khung này trong từ điển đã công bố.', 404);
  const data = r.data as any;
  const one = async (kind: string, id: string, version: number) => (await db.select().from(t.dictRecord).where(and(eq(t.dictRecord.workspaceId, workspaceId), eq(t.dictRecord.kind, kind), eq(t.dictRecord.id, id), eq(t.dictRecord.version, version))))[0];
  const competencies = [], indicators = [], evidence = [];
  for (const q of data.requirements) {
    const c = await one('C', q.competency_id, q.competency_version);
    if (c) competencies.push({ id: c.id, version: c.version, ...(c.data as any) });
    for (const i of q.indicators) {
      const rec = await one('I', i.indicator_id, i.version);
      if (rec) indicators.push({ id: rec.id, version: rec.version, ...(rec.data as any) });
    }
    for (const e of q.evidence_ids) evidence.push(e);
  }
  const w = (await db.select().from(t.dictRecord).where(and(eq(t.dictRecord.workspaceId, workspaceId), eq(t.dictRecord.kind, 'W'), eq(t.dictRecord.id, `W-${data.role_id}`)))).filter((x) => x.releaseId === r.releaseId || x.createdAt <= r.createdAt).sort((a, b) => b.version - a.version)[0];
  const taskIds = new Set(data.requirements.flatMap((q: any) => q.task_ids));
  return {
    format: 'competence-lab-framework',
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    framework: { id: r.id, record_version: r.version, release_id: r.releaseId, content_sha256: r.contentSha256, ...data },
    competencies,
    indicators,
    tasks: ((w?.data as any)?.tasks ?? []).filter((k: any) => taskIds.has(k.task_id)),
    evidence_refs: [...new Set(evidence)].sort(),
    notes: ['Bậc yêu cầu nằm ở framework.requirements[].required_level; null = chưa xác định.', 'Mỗi requirement khóa competency_id@competency_version và indicator_id@version.'],
  };
}
