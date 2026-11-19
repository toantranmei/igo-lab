import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { eq } from 'drizzle-orm';
import { buildBundle, commitImport, createExport, exportFramework, previewImport, readBundle } from '@cl/bundle';
import { sha256, t, verifyEventChain, type Db } from '@cl/db';
import { FsBlobStore } from '@cl/ingest';
import { getCandidate, getDetail, getState } from '@cl/pipeline';
import { commitCandidate, decideCandidate, loadDictionary, latestRelease } from '@cl/registry';
import { WS, closeTestDb, resetDb } from './helpers';
import { JD_A, JD_B, JD_C, doc, newSession, runThrough } from './fixtures';

let db: Db;
let blobs: FsBlobStore;
let log: string;
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);
async function seedWorkspace() {
  const s = await newSession(db, [doc('A', JD_A), doc('B', JD_B)]);
  await runThrough(db, s.sessionId);
  const c = (await getCandidate(db, WS, s.sessionId))!;
  await decideCandidate(db, WS, c.id, { decision: 'ACCEPT', reason: 'ok', actor: 'local' });
  const receipt = await commitCandidate(db, WS, c.id, { expected_base_release_id: null, actor: 'local' });
  return { ...s, receipt };
}
const rezip = (zip: Uint8Array, edit: (files: Record<string, Uint8Array>) => void, fixManifest = false) => {
  const files = unzipSync(zip);
  edit(files);
  if (fixManifest) {
    const m = JSON.parse(strFromU8(files['manifest.json']));
    m.files = m.files.map((f: any) => (files[f.path] ? { ...f, bytes: files[f.path].byteLength, sha256: sha256(files[f.path]) } : f));
    files['manifest.json'] = strToU8(JSON.stringify(m));
  }
  return zipSync(files);
};

beforeEach(async () => {
  db = await resetDb();
  blobs = new FsBlobStore(mkdtempSync(path.join(os.tmpdir(), 'cl-blobs-')));
  log = path.join(mkdtempSync(path.join(os.tmpdir(), 'cl-fake-')), 'calls.jsonl');
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.FAKE_CLAUDE_MODE = 'ok';
  process.env.AGENT_RETRY_DELAY_MS = '1';
});
afterAll(closeTestDb);

describe('export / import', () => {
  it('backup → môi trường sạch: khôi phục nguyên ID/version, chuỗi sự kiện, lượt mới kế thừa C và không gọi lại agent', async () => {
    const src = await seedWorkspace();
    const before = await getState(db, WS, src.sessionId);
    const b3 = (await getDetail(db, WS, src.sessionId, 'B3')).raw;
    const exp = await createExport(db, blobs, WS, { kind: 'backup', include_blobs: true }, 'local');
    const zip = (await blobs.get(exp.sha256))!;
    const text = Object.values(unzipSync(zip)).map((b) => strFromU8(b)).join('\n');
    for (const secret of ['cl_app_dev', 'cl_owner_dev', 'DATABASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', os.homedir(), process.cwd()]) expect(text).not.toContain(secret);
    expect(exp.manifest).toMatchObject({ format: 'competence-lab-bundle', schema_version: '1.0.0', export_kind: 'backup', release_id: src.receipt.release_id });
    for (const f of ['data/W.jsonl', 'data/C.jsonl', 'data/indicators.jsonl', 'data/R.jsonl', 'data/V.jsonl', 'data/G.jsonl', 'runs/sessions.jsonl', 'runs/jd_revisions.jsonl', 'runs/attempts.jsonl', 'runs/events.jsonl', 'runs/agent_calls.jsonl', 'runs/agent_results.jsonl', 'README.md', 'schemas/manifest.schema.json']) expect(exp.manifest.files.map((x) => x.path)).toContain(f);

    db = await resetDb(); // clean environment
    const callsBefore = calls();
    const pv = await previewImport(db, blobs, WS, zip, 'RESTORE_EMPTY');
    expect(pv.report).toMatchObject({ ok: true, duplicates: 0 });
    expect(pv.report.lineage).toEqual([{ release_id: src.receipt.release_id, version_label: '1.0.0', parent_release_id: null, restorable: true }]);
    expect(await db.select().from(t.dictRecord)).toHaveLength(0); // preview writes nothing to the registry
    await expect(commitImport(db, blobs, WS, pv.id, { preview_digest: 'wrong', actor: 'local' })).rejects.toMatchObject({ code: 'PREVIEW_DIGEST_MISMATCH' });
    const res = await commitImport(db, blobs, WS, pv.id, { preview_digest: pv.report.preview_digest, actor: 'local' });
    expect(res.inserted).toBe(pv.report.to_insert);
    expect(res.latest_release).toMatchObject({ release_id: src.receipt.release_id, version_label: '1.0.0' });
    const after = await getState(db, WS, src.sessionId);
    expect(after.dictionary).toEqual(before.dictionary);
    expect(after.history[0].receipt?.hash).toBe(src.receipt.hash);
    expect(after.position).toBe(9);
    expect((await getDetail(db, WS, src.sessionId, 'B3')).raw).toEqual(b3);
    expect((await verifyEventChain(db, WS)).ok).toBe(true);

    // same bundle again → idempotent, 0 changes
    const again = await previewImport(db, blobs, WS, zip, 'REAPPLY');
    expect(again.report).toMatchObject({ ok: true, to_insert: 0 });
    expect((await commitImport(db, blobs, WS, again.id, { preview_digest: again.report.preview_digest, actor: 'local' })).changes).toBe(0);
    expect((await previewImport(db, blobs, WS, zip, 'RESTORE_EMPTY')).report.errors[0].code).toBe('WORKSPACE_NOT_EMPTY');

    // a new Live run in the restored environment inherits the imported competencies and replays stored agent results
    const next = await newSession(db, [doc('A', JD_A), doc('B', JD_B), doc('C', JD_C)], 'Sau khôi phục');
    await runThrough(db, next.sessionId, 'B3');
    const nb3 = (await getDetail(db, WS, next.sessionId, 'B3')).raw as any;
    expect(nb3.counts).toMatchObject({ REUSE: 3, ADD: 1 });
    const fresh = (await db.select().from(t.agentCall).where(eq(t.agentCall.runId, next.runId))).filter((c) => !c.cacheHit).map((c) => c.taskId);
    // only the new JD is read again (A and B come from the per-JD memo of E1), plus the reviews whose input changed
    expect(fresh.filter((x) => x === 'E1.jd_read')).toHaveLength(1);
    const e1 = (await db.select().from(t.agentResult).where(eq(t.agentResult.taskId, 'E1.jd_read'))).map((r) => JSON.parse(r.inputCanonical).jds.length);
    expect(e1).toContain(1);
    expect(calls() - callsBefore).toBe(fresh.length);
  });

  it('sửa 1 byte, đường dẫn độc hại, schema mới hơn, ref thiếu, CONTENT_CONFLICT đều bị chặn và không ghi gì', async () => {
    await seedWorkspace();
    const { zip } = await buildBundle(db, blobs, WS, { kind: 'dictionary' });
    const tampered = rezip(zip, (f) => {
      const b = f['data/C.jsonl'].slice();
      b[20] ^= 1;
      f['data/C.jsonl'] = b;
    });
    expect(() => readBundle(tampered)).toThrowError(expect.objectContaining({ code: 'CHECKSUM_MISMATCH' }));
    const slip = rezip(zip, (f) => (f['../evil.txt'] = strToU8('x')));
    expect(() => readBundle(slip)).toThrowError(expect.objectContaining({ code: 'UNSAFE_PATH' }));
    const abs = rezip(zip, (f) => (f['/etc/passwd'] = strToU8('x')));
    expect(() => readBundle(abs)).toThrowError(expect.objectContaining({ code: 'UNSAFE_PATH' }));
    const newer = rezip(zip, (f) => {
      const m = JSON.parse(strFromU8(f['manifest.json']));
      m.schema_version = '2.3.0';
      f['manifest.json'] = strToU8(JSON.stringify(m));
    });
    expect(() => readBundle(newer)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA_VERSION', message: expect.stringContaining('2.3.0') }));
    expect(() => readBundle(new Uint8Array([1, 2, 3]))).toThrowError(expect.objectContaining({ code: 'BUNDLE_INVALID' }));

    // same id@version, different content (manifest re-signed so only the semantic check can catch it)
    const conflict = rezip(zip, (f) => {
      const lines = strFromU8(f['data/C.jsonl']).trim().split('\n').map((l) => JSON.parse(l));
      lines[0].data.definition = 'Định nghĩa khác hẳn';
      lines[0].content_sha256 = sha256(JSON.stringify(Object.fromEntries(Object.keys(lines[0].data).sort().map((k) => [k, lines[0].data[k]]))));
      f['data/C.jsonl'] = strToU8(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    }, true);
    const pv = await previewImport(db, blobs, WS, conflict, 'REAPPLY');
    expect(pv.report.ok).toBe(false);
    expect(pv.report.conflicts).toHaveLength(1);
    expect(pv.report.errors.map((e) => e.code)).toContain('CONTENT_CONFLICT');
    const count = (await db.select().from(t.dictRecord)).length;
    await expect(commitImport(db, blobs, WS, pv.id, { preview_digest: pv.report.preview_digest, actor: 'local' })).rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
    expect((await db.select().from(t.dictRecord)).length).toBe(count);

    const missing = rezip(zip, (f) => (f['data/indicators.jsonl'] = strToU8('')), true);
    db = await resetDb();
    const pm = await previewImport(db, blobs, WS, missing, 'RESTORE_EMPTY');
    expect(pm.report.errors.map((e) => e.code)).toContain('REFERENCE_MISSING');
    await expect(commitImport(db, blobs, WS, pm.id, { preview_digest: pm.report.preview_digest, actor: 'local' })).rejects.toMatchObject({ code: 'REFERENCE_MISSING' });
    expect(await latestRelease(db, WS)).toBeNull();
  });

  it('gói từ điển khôi phục được trên workspace rỗng; metadata_only lược câu trích và ghi manifest; xuất khung đúng phiên bản', async () => {
    const src = await seedWorkspace();
    const fw = await exportFramework(db, WS, { role_id: 'product-owner', version_label: '1.0' });
    expect(fw.framework.version_label).toBe('1.0.0'); // asked as 1.0: the old label is an alias
    expect(fw.competencies).toHaveLength(3);
    expect(fw.indicators).toHaveLength(18); // 3 competencies × levels 1, 3, 5 × 2 (29)
    expect(fw.tasks.length).toBeGreaterThan(0);
    await expect(exportFramework(db, WS, { role_id: 'product-owner', version_label: '9.9' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const full = await buildBundle(db, blobs, WS, { kind: 'dictionary' });
    const meta = await buildBundle(db, blobs, WS, { kind: 'dictionary', metadata_only: true });
    expect(full.manifest.files.some((f) => f.path.startsWith('runs/'))).toBe(false);
    expect(meta.manifest.redaction.metadata_only).toBe(true);
    expect(meta.manifest.redaction.redacted_refs.length).toBeGreaterThan(0);
    const v = strFromU8(unzipSync(meta.zip)['data/V.jsonl']);
    expect(v).not.toContain('Ưu tiên backlog');
    expect(strFromU8(unzipSync(full.zip)['data/V.jsonl'])).toContain('Ưu tiên backlog');
    db = await resetDb();
    const pv = await previewImport(db, blobs, WS, full.zip, 'RESTORE_EMPTY');
    expect(pv.report.ok).toBe(true);
    await commitImport(db, blobs, WS, pv.id, { preview_digest: pv.report.preview_digest, actor: 'local' });
    const d = await loadDictionary(db, WS, src.receipt.release_id);
    expect(d.C).toHaveLength(3);
    expect(d.R[0].data.version_label).toBe('1.0.0');
    // a Live run on top of the imported dictionary reuses its competencies
    const next = await newSession(db, [doc('A', JD_A)], 'Trên từ điển nhập');
    await runThrough(db, next.sessionId, 'B3');
    expect(((await getDetail(db, WS, next.sessionId, 'B3')).raw as any).counts).toMatchObject({ REUSE: 2, ADD: 0 });
  });
});
