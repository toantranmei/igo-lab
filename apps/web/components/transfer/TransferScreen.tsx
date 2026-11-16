'use client';
import { useEffect, useRef, useState } from 'react';
import type { SessionListItem } from '@cl/contract';
import { Sidebar } from '@/components/shell/Shell';
import { ApiError, api } from '@/lib/live-source';

interface Exp { id: string; kind: string; file_name: string; created_at: string; manifest: { counts: Record<string, number>; scope: { completeness: string }; redaction: { metadata_only: boolean; redacted_refs: string[] }; release_version: string } }
interface Report { ok: boolean; mode: string; export_kind: string; schema_version: string; exported_at: string; counts: Record<string, number>; duplicates: number; to_insert: number; conflicts: { ref: string; reason: string }[]; errors: { code: string; message: string }[]; redaction: { metadata_only: boolean; redacted_refs: string[] }; lineage: { release_id: string; version_label: string; restorable: boolean }[]; completeness: string; preview_digest: string }
const msg = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));

export default function TransferScreen() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [releases, setReleases] = useState<{ release_id: string; version_label: string }[]>([]);
  const [exportsList, setExports] = useState<Exp[]>([]);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fw, setFw] = useState({ session: '', version: '' });
  const [dictMeta, setDictMeta] = useState(false);
  const [bk, setBk] = useState({ metadata_only: false, include_blobs: false, scope: [] as string[] });
  const [mode, setMode] = useState<'RESTORE_EMPTY' | 'REAPPLY'>('RESTORE_EMPTY');
  const [preview, setPreview] = useState<{ id: string; report: Report } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => {
    api<SessionListItem[]>('/sessions').then((s) => { setSessions(s); setFw((f) => ({ ...f, session: f.session || s[0]?.id || '' })); }).catch((e) => setErr(msg(e)));
    api<{ release_id: string; version_label: string }[]>('/releases').then(setReleases).catch(() => {});
    api<Exp[]>('/exports').then(setExports).catch(() => {});
  };
  useEffect(load, []);
  const doExport = async (body: Record<string, unknown>) => {
    setErr(''); setNote(''); setBusy(true);
    try {
      const r = await api<{ id: string; file_name: string }>('/exports', { method: 'POST', json: body });
      setNote(`Đã tạo ${r.file_name}.`);
      load();
      window.location.assign(`/api/exports/${r.id}/download`);
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const doPreview = async () => {
    setErr(''); setNote(''); setPreview(null);
    const f = fileRef.current?.files?.[0];
    if (!f) return setErr('Chọn file gói .zip trước.');
    const form = new FormData();
    form.set('file', f);
    form.set('mode', mode);
    setBusy(true);
    try { setPreview(await api<{ id: string; report: Report }>('/imports/preview', { method: 'POST', body: form })); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const doCommit = async () => {
    if (!preview) return;
    setErr(''); setBusy(true);
    try {
      const r = await api<{ inserted: number; duplicates: number; latest_release: { version_label: string } | null }>(`/imports/${preview.id}/commit`, { method: 'POST', json: { preview_digest: preview.report.preview_digest } });
      setNote(`Đã áp dụng: ${r.inserted} bản ghi mới, ${r.duplicates} bản ghi đã có (không đổi).${r.latest_release ? ` Từ điển hiện ở v${r.latest_release.version_label}.` : ''}`);
      setPreview(null);
      load();
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Sidebar sessionId={null} tab="transfer" />
      <main>
        <header><span>Competence Lab <span className="dim">/ Xuất và khôi phục</span></span></header>
        <section className="tab active" id="transfer">
          <div className="eyebrow">CHUYỂN HẠ TẦNG</div>
          <h2>Xuất và khôi phục</h2>
          <p className="dim">Áp dụng cho dữ liệu Live trên máy chủ. Phiên mẫu xuất JSON ngay trong từng tab của nó. Gói không chứa mật khẩu, token hay đường dẫn máy chủ.</p>
          {err ? <p className="cl-err" role="alert" data-testid="transfer-error">{err}</p> : null}
          {note ? <p className="cl-ok" role="status" data-testid="transfer-note">{note}</p> : null}
          <div className="cl-grid2">
            <div className="cl-card">
              <h3>1 · Xuất khung JSON</h3>
              <p className="dim"><b>Mức hoàn chỉnh:</b> một phiên bản khung (R) kèm đúng phiên bản năng lực, chỉ báo và nhiệm vụ mà nó khóa. Dùng khung ở hệ khác; không khôi phục được workspace.</p>
              <label className="cl-field">Phiên (role)<select id="fw-session" value={fw.session} onChange={(e) => setFw({ ...fw, session: e.target.value })}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.roleTitle}</option>)}</select></label>
              <label className="cl-field">Phiên bản khung (để trống = mới nhất)<input id="fw-version" value={fw.version} onChange={(e) => setFw({ ...fw, version: e.target.value })} placeholder="ví dụ 1.0" /></label>
              <a id="fw-export" className={'button' + (fw.session ? '' : ' disabled')} href={fw.session ? `/api/exports/framework?session=${fw.session}${fw.version ? `&version=${encodeURIComponent(fw.version)}` : ''}` : undefined}>↓ Xuất khung JSON</a>
            </div>
            <div className="cl-card">
              <h3>2 · Xuất từ điển đầy đủ</h3>
              <p className="dim"><b>Mức hoàn chỉnh:</b> W/C/R/V/G đã công bố, mọi phiên bản cần để resolve tham chiếu, alias, diff, quyết định và lịch sử release. Không có phiên, JD gốc hay lượt chạy. Khôi phục được từ điển trên workspace rỗng.</p>
              <label className="cl-row"><input id="dict-meta" type="checkbox" checked={dictMeta} onChange={(e) => setDictMeta(e.target.checked)} /> Bỏ câu trích JD (chỉ metadata; manifest ghi các mục đã lược)</label>
              <button id="dict-export" disabled={busy || !releases.length} onClick={() => doExport({ kind: 'dictionary', metadata_only: dictMeta })}>↓ Xuất từ điển (.zip)</button>
              {!releases.length ? <p className="dim">Chưa có release nào để xuất.</p> : <p className="dim">Release mới nhất: v{releases.at(-1)!.version_label}</p>}
            </div>
            <div className="cl-card">
              <h3>3 · Backup khôi phục</h3>
              <p className="dim"><b>Mức hoàn chỉnh:</b> toàn bộ gói từ điển, cùng phiên, revision bộ JD, lượt/block/attempt, review/audit/lesson, nhật ký sự kiện, lời gọi và kết quả agent. Khôi phục trên môi trường sạch và chạy lại không cần gọi lại AI. Coi là dữ liệu nội bộ.</p>
              <label className="cl-row"><input id="bk-blobs" type="checkbox" checked={bk.include_blobs} onChange={(e) => setBk({ ...bk, include_blobs: e.target.checked })} /> Bao gồm file gốc đã tải lên</label>
              <label className="cl-row"><input id="bk-meta" type="checkbox" checked={bk.metadata_only} onChange={(e) => setBk({ ...bk, metadata_only: e.target.checked })} /> Bỏ nội dung JD và output (chỉ metadata)</label>
              <fieldset><legend className="dim">Phạm vi phiên (không chọn = tất cả, kèm nhật ký sự kiện)</legend>
                {sessions.map((s) => <label key={s.id} className="cl-row"><input type="checkbox" checked={bk.scope.includes(s.id)} onChange={(e) => setBk({ ...bk, scope: e.target.checked ? [...bk.scope, s.id] : bk.scope.filter((x) => x !== s.id) })} /> {s.name}</label>)}
              </fieldset>
              <button id="bk-export" disabled={busy} onClick={() => doExport({ kind: 'backup', metadata_only: bk.metadata_only, include_blobs: bk.include_blobs, session_ids: bk.scope })}>↓ Tạo backup (.zip)</button>
            </div>
          </div>
          {exportsList.length ? (
            <div className="cl-card">
              <h3>Gói đã tạo</h3>
              <div className="scroll-x"><table className="cl-table"><thead><tr><th>File</th><th>Loại</th><th>Lúc</th><th>Mức hoàn chỉnh</th><th /></tr></thead>
                <tbody>{exportsList.map((e) => <tr key={e.id}><td className="cl-mono">{e.file_name}</td><td>{e.kind}{e.manifest.redaction.metadata_only ? ' · chỉ metadata' : ''}</td><td>{new Date(e.created_at).toLocaleString('vi-VN')}</td><td>{e.manifest.scope.completeness}</td><td><a href={`/api/exports/${e.id}/download`}>Tải</a></td></tr>)}</tbody></table></div>
            </div>
          ) : null}
          <div className="cl-card" id="import">
            <h3>Khôi phục từ gói</h3>
            <p className="dim">Hai pha: <b>nhập thử</b> (không ghi gì, báo trước số bản ghi, trùng, xung đột) rồi mới <b>áp dụng</b> trong một giao dịch. Hash sai, tham chiếu thiếu hoặc cùng ID/phiên bản khác nội dung đều chặn toàn bộ.</p>
            <label className="cl-field">File gói (.zip)<input id="imp-file" ref={fileRef} type="file" accept=".zip" /></label>
            <label className="cl-field">Chế độ
              <select id="imp-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="RESTORE_EMPTY">Khôi phục vào workspace rỗng (giữ nguyên ID/phiên bản)</option>
                <option value="REAPPLY">Tải lại cùng gói vào workspace đã nhập (kiểm idempotency)</option>
              </select>
            </label>
            <button id="imp-preview" disabled={busy} onClick={doPreview}>Nhập thử</button>
            {preview ? (
              <div data-testid="import-report" data-ok={preview.report.ok}>
                <h4>{preview.report.ok ? <span className="cl-ok">Có thể áp dụng</span> : <span className="cl-err">Bị chặn</span>} · gói {preview.report.export_kind} · schema {preview.report.schema_version} · xuất lúc {new Date(preview.report.exported_at).toLocaleString('vi-VN')}</h4>
                <p>{preview.report.to_insert} bản ghi sẽ thêm · {preview.report.duplicates} bản ghi đã có (giống hệt) · {preview.report.conflicts.length} xung đột</p>
                <p className="dim">{preview.report.completeness}</p>
                {preview.report.redaction.metadata_only ? <p className="cl-warn">Gói đã lược nội dung nguồn: {preview.report.redaction.redacted_refs.length} mục chỉ còn metadata.</p> : null}
                <p className="dim">Lịch sử release khôi phục được: {preview.report.lineage.filter((l) => l.restorable).map((l) => 'v' + l.version_label).join(' → ') || 'không có'}</p>
                {preview.report.errors.map((e, i) => <p key={i} className="cl-err"><b>{e.code}</b>: {e.message}</p>)}
                {preview.report.conflicts.length ? <ul>{preview.report.conflicts.map((c) => <li key={c.ref} className="cl-err">{c.ref}: {c.reason}</li>)}</ul> : null}
                <details><summary>Số đếm theo file</summary><pre className="cl-pre">{JSON.stringify(preview.report.counts, null, 2)}</pre></details>
                <button id="imp-commit" className="primary" disabled={busy || !preview.report.ok} onClick={doCommit}>Áp dụng</button>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
