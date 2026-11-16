'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/live-source';
import { useSession } from '@/lib/session';

interface Warning { code: string; severity: 'error' | 'warn' | 'info'; message: string }
interface Draft { key: string; name: string; text: string; source_ref: string; origin_group: string; blob_sha256: string | null; document_id?: string; warnings: Warning[]; ok: boolean; chars: number; segments: number; pages: number | null; pii: { kind: string; text: string }[]; existing: boolean }
interface Info {
  session: { name: string; role_title: string; purpose: string };
  jd_set: { revision: number; documents: { ref: string; document_id: string; name: string; text: string; source_ref: string; origin_group: string; chars: number; segments: number }[] } | null;
  events: { id: string; label: string; situation: string; action: string; outcome: string; source_ref: string }[];
  run: { run_no: number; status: string; jd_set_revision: number; base_version_label: string } | null;
  releases: { release_id: string; version_label: string }[];
  plan: { tasks: { task: string; task_id: string; block: string; title: string; model: string; effort: string; unit: string; calls: string; skip?: string }[]; estimate: { note: string }; disclosure: string };
  policy: { id: string; version: number; min_coverage: number; min_item_agreement: number; thresholds_status: string };
  limits: { maxFiles: number; maxFileMb: number; maxCharsPerDoc: number; extensions: string[] };
  worker: { ok: boolean; message: string };
  stop: { reason: string } | null;
}
const errText = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/** Live only: add JDs (paste or upload), preview and confirm the set, add real events, then the pre-run confirmation screen. */
export default function LiveInputsPanel() {
  const { sessionId, refresh, toast } = useSession();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [kept, setKept] = useState<string[] | null>(null);
  const [paste, setPaste] = useState({ name: '', text: '', source_ref: '', origin_group: '' });
  const [ev, setEv] = useState({ label: '', situation: '', action: '', outcome: '', source_ref: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [base, setBase] = useState<string>('latest');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const i = await api<Info>(`/sessions/${sessionId}`);
      setInfo(i);
      setKept((k) => k ?? i.jd_set?.documents.map((d) => d.ref) ?? []);
    } catch (e) {
      setErr(errText(e));
    }
  }, [sessionId]);
  useEffect(() => void load(), [load]);

  const preview = async () => {
    setErr('');
    const files = Array.from(fileRef.current?.files ?? []);
    const meta = paste.text.trim() ? [{ name: paste.name.trim() || `Bản dán ${drafts.length + 1}`, text: paste.text, source_ref: paste.source_ref, origin_group: paste.origin_group }] : [];
    if (!files.length && !meta.length) return setErr('Dán nội dung JD hoặc chọn file trước khi xem trước.');
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    for (const f of files) form.append('files', f);
    setBusy(true);
    try {
      const r = await api<{ documents: any[] }>(`/sessions/${sessionId}/jd-sets/preview`, { method: 'POST', body: form });
      setDrafts((d) => [
        ...d,
        ...r.documents.map((x, i) => ({ key: `${Date.now()}-${i}`, name: x.name, text: x.text, source_ref: x.source_kind === 'file' ? `upload://${x.name}` : paste.source_ref || `paste://${x.name}`, origin_group: x.source_kind === 'file' ? '' : paste.origin_group, blob_sha256: x.blob_sha256, warnings: x.warnings, ok: x.ok, chars: x.chars, segments: x.segments, pages: x.pages, pii: x.pii, existing: !!x.existing })),
      ]);
      setPaste({ name: '', text: '', source_ref: '', origin_group: '' });
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setErr('');
    const existing = (info?.jd_set?.documents ?? []).filter((d) => kept?.includes(d.ref)).map((d) => ({ name: d.name, text: d.text, source_ref: d.source_ref, origin_group: d.origin_group, document_id: d.document_id }));
    const fresh = drafts.filter((d) => d.ok).map((d) => ({ name: d.name, text: d.text, source_ref: d.source_ref, origin_group: d.origin_group, blob_sha256: d.blob_sha256 }));
    setBusy(true);
    try {
      const r = await api<{ revision: number }>(`/sessions/${sessionId}/jd-sets`, { method: 'POST', json: { documents: [...existing, ...fresh] } });
      setDrafts([]);
      setKept(null);
      await load();
      await refresh();
      toast(`Đã xác nhận bộ JD revision ${r.revision}.`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const addEvent = async () => {
    setErr('');
    try {
      await api(`/sessions/${sessionId}/events`, { method: 'POST', json: ev });
      setEv({ label: '', situation: '', action: '', outcome: '', source_ref: '' });
      await load();
      await refresh();
    } catch (e) {
      setErr(errText(e));
    }
  };
  const createRun = async () => {
    setErr('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { acknowledge_send: ack };
      if (base === 'empty') body.base_release_id = null;
      else if (base !== 'latest') body.base_release_id = base;
      const r = await api<{ run_no: number }>(`/sessions/${sessionId}/runs`, { method: 'POST', json: body });
      setAck(false);
      await load();
      await refresh();
      toast(`Đã tạo lượt ${String(r.run_no).padStart(2, '0')}. Bấm "Tiến 1 bước" để chạy B0.`);
      router.push(`/s/${sessionId}/line`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <div className="cl-card">{err ? <p className="cl-err" role="alert">{err}</p> : <p className="dim">Đang tải dữ liệu của phiên…</p>}</div>;
  const docs = info.jd_set?.documents ?? [];
  const dirty = drafts.some((d) => d.ok) || (kept !== null && kept.length !== docs.length);
  const total = (kept?.length ?? 0) + drafts.filter((d) => d.ok).length;
  const runIsCurrent = info.run && info.jd_set && info.run.jd_set_revision === info.jd_set.revision && info.run.status !== 'COMPLETE';
  return (
    <div className="cl-card" id="live-inputs" data-testid="live-inputs">
      <div className="eyebrow">DỮ LIỆU CỦA PHIÊN · LIVE</div>
      <h3>
        {info.session.name} <span className="dim">· {info.session.role_title}</span>
      </h3>
      <p className="dim">Mục đích: {info.session.purpose}</p>
      {info.stop ? <p className="cl-warn" role="alert">⚠ Workspace đang STOP: {info.stop.reason}. Xử lý ở tab Audit trước khi tạo lượt mới.</p> : null}
      {err ? <p className="cl-err" role="alert" data-testid="live-error">{err}</p> : null}

      <h4>1 · Bộ JD {info.jd_set ? <span className="pill">revision {info.jd_set.revision}</span> : <span className="pill">chưa có</span>}</h4>
      {docs.length ? (
        <div className="scroll-x">
          <table className="cl-table">
            <thead><tr><th>Giữ</th><th>Tài liệu</th><th>Nguồn</th><th>Tổ chức nguồn</th><th>Ký tự · đoạn</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.ref}>
                  <td><input type="checkbox" aria-label={`Giữ ${d.name}`} checked={kept?.includes(d.ref) ?? true} onChange={(e) => setKept((k) => (e.target.checked ? [...(k ?? []), d.ref] : (k ?? []).filter((x) => x !== d.ref)))} /></td>
                  <td>{d.name} <span className="cl-mono dim">{d.ref}</span></td>
                  <td>{d.source_ref || <span className="cl-warn">chưa nhập</span>}</td>
                  <td>{d.origin_group || <span className="dim">chưa xác định</span>}</td>
                  <td>{d.chars} · {d.segments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="dim">Phiên chưa có JD nào. Dán nội dung hoặc tải file bên dưới.</p>}

      <div className="cl-grid2">
        <div>
          <label className="cl-field">Dán nội dung JD
            <textarea id="jd-paste" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} placeholder="Dán nguyên văn một mô tả công việc…" />
          </label>
          <div className="cl-row">
            <label className="cl-field" style={{ flex: 1 }}>Tên tài liệu<input id="jd-name" value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.target.value })} /></label>
            <label className="cl-field" style={{ flex: 1 }}>Nguồn (nơi lấy JD)<input id="jd-source" value={paste.source_ref} onChange={(e) => setPaste({ ...paste, source_ref: e.target.value })} placeholder="ví dụ: trang tuyển dụng công ty A, 05/2026" /></label>
            <label className="cl-field" style={{ flex: 1 }}>Tổ chức nguồn<input id="jd-org" value={paste.origin_group} onChange={(e) => setPaste({ ...paste, origin_group: e.target.value })} /></label>
          </div>
        </div>
        <div>
          <label className="cl-field">Hoặc tải file
            <input id="jd-files" ref={fileRef} type="file" multiple accept={info.limits.extensions.join(',')} />
          </label>
          <p className="dim" data-testid="upload-limits">
            Hỗ trợ {info.limits.extensions.join(', ')} (PDF phải có lớp văn bản, không OCR). Tối đa {info.limits.maxFiles} tài liệu, {info.limits.maxFileMb} MB mỗi file, {info.limits.maxCharsPerDoc.toLocaleString('vi-VN')} ký tự mỗi tài liệu.
          </p>
          <button id="jd-preview" onClick={preview} disabled={busy}>Xem trước</button>
        </div>
      </div>

      {drafts.map((d) => (
        <div key={d.key} className="cl-card" data-testid="jd-draft" data-ok={d.ok}>
          <div className="cl-row">
            <b>{d.name}</b>
            <span className="pill">{d.ok ? 'Sẽ thêm' : 'Không dùng được'}</span>
            <span className="dim">{d.chars} ký tự · {d.segments} đoạn{d.pages ? ` · ${d.pages} trang` : ''}</span>
            <button className="ghost" onClick={() => setDrafts((x) => x.filter((y) => y.key !== d.key))}>Bỏ tài liệu</button>
          </div>
          {d.warnings.map((w, i) => <p key={i} className={w.severity === 'error' ? 'cl-err' : w.severity === 'warn' ? 'cl-warn' : 'dim'}>{w.severity === 'error' ? '⊘' : w.severity === 'warn' ? '⚠' : 'ℹ'} {w.message}</p>)}
          {d.pii.length ? <p className="dim">Phát hiện: {d.pii.map((p) => p.text).join(', ')}. Bạn có thể xóa trực tiếp trong ô văn bản dưới đây.</p> : null}
          <div className="cl-row">
            <label className="cl-field" style={{ flex: 1 }}>Nguồn<input value={d.source_ref} onChange={(e) => setDrafts((x) => x.map((y) => (y.key === d.key ? { ...y, source_ref: e.target.value } : y)))} /></label>
            <label className="cl-field" style={{ flex: 1 }}>Tổ chức nguồn<input value={d.origin_group} onChange={(e) => setDrafts((x) => x.map((y) => (y.key === d.key ? { ...y, origin_group: e.target.value } : y)))} /></label>
          </div>
          <label className="cl-field">Văn bản đã trích (sửa được trước khi xác nhận)
            <textarea value={d.text} onChange={(e) => setDrafts((x) => x.map((y) => (y.key === d.key ? { ...y, text: e.target.value, ok: y.ok || e.target.value.trim().length > 0 } : y)))} />
          </label>
        </div>
      ))}
      <div className="cl-row">
        <button id="jd-confirm" className="primary" onClick={confirm} disabled={busy || !dirty || total === 0}>Xác nhận bộ JD ({total} tài liệu)</button>
        {dirty ? <span className="cl-warn">Có thay đổi chưa xác nhận. Xác nhận tạo revision mới; revision cũ và các lượt đã chạy được giữ nguyên.</span> : null}
      </div>

      <h4>2 · Sự kiện thật (không bắt buộc)</h4>
      <p className="dim">Sự kiện công việc đã xảy ra, có nguồn. Agent chỉ kiểm sự kiện bạn nhập; giả thuyết do agent đề xuất luôn mang nhãn GIẢ THUYẾT và không được tính là bằng chứng.</p>
      {info.events.length ? <ul>{info.events.map((e) => <li key={e.id}><b>{e.label}</b> — {e.action} <span className="dim">· nguồn: {e.source_ref || 'thiếu'}</span> <button className="ghost" onClick={async () => { await api(`/sessions/${sessionId}/events/${e.id}`, { method: 'DELETE' }); await load(); await refresh(); }}>Xóa</button></li>)}</ul> : null}
      <div className="cl-row">
        <label className="cl-field" style={{ flex: 1 }}>Tên sự kiện<input id="ev-label" value={ev.label} onChange={(e) => setEv({ ...ev, label: e.target.value })} /></label>
        <label className="cl-field" style={{ flex: 2 }}>Tình huống<input value={ev.situation} onChange={(e) => setEv({ ...ev, situation: e.target.value })} /></label>
      </div>
      <div className="cl-row">
        <label className="cl-field" style={{ flex: 2 }}>Hành động<input id="ev-action" value={ev.action} onChange={(e) => setEv({ ...ev, action: e.target.value })} /></label>
        <label className="cl-field" style={{ flex: 1 }}>Kết quả<input value={ev.outcome} onChange={(e) => setEv({ ...ev, outcome: e.target.value })} /></label>
        <label className="cl-field" style={{ flex: 1 }}>Nguồn<input id="ev-source" value={ev.source_ref} onChange={(e) => setEv({ ...ev, source_ref: e.target.value })} /></label>
      </div>
      <button id="ev-add" onClick={addEvent} disabled={!ev.label.trim() || !ev.action.trim()}>Thêm sự kiện</button>
      {info.run ? <p className="dim">Sự kiện thêm sau khi tạo lượt chỉ có hiệu lực từ lượt kế tiếp.</p> : null}

      <h4 id="run-confirm">3 · Màn chốt trước khi chạy</h4>
      {info.run ? <p className="dim">Lượt hiện tại: {String(info.run.run_no).padStart(2, '0')} · bộ JD revision {info.run.jd_set_revision} · nền v{info.run.base_version_label} · {info.run.status === 'COMPLETE' ? 'đã công bố' : 'đang mở'}. Tạo lượt mới không sửa lượt cũ.</p> : null}
      <p data-testid="send-disclosure"><b>{info.plan.disclosure}</b></p>
      {!info.worker.ok ? <p className="cl-warn" role="alert" data-testid="worker-warning">⚠ {info.worker.message}</p> : <p className="cl-ok">✓ {info.worker.message}</p>}
      <details>
        <summary>Các tác vụ AI sẽ chạy, model và effort ({info.plan.tasks.length} tác vụ)</summary>
        <div className="scroll-x">
          <table className="cl-table" data-testid="plan-table">
            <thead><tr><th>Block</th><th>Tác vụ</th><th>Việc</th><th>Model</th><th>Effort</th><th>Đơn vị gọi</th><th>Số lần</th></tr></thead>
            <tbody>{info.plan.tasks.map((k) => <tr key={k.task}><td>{k.block}</td><td className="cl-mono">{k.task_id}</td><td>{k.title}{k.skip ? <span className="dim"> · {k.skip}</span> : null}</td><td className="cl-mono">{k.model}</td><td>{k.effort}</td><td>{k.unit}</td><td>{k.calls}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="dim">{info.plan.estimate.note}</p>
        <p className="dim">Nhập JD, B0, B7 và nhánh giao thử không gọi AI. Mọi phép đếm, công thức, cổng do code tính.</p>
      </details>
      <p className="dim">Policy {info.policy.id}@{info.policy.version}: coverage ≥ {Math.round(info.policy.min_coverage * 100)}%, đồng thuận chỉ báo ≥ {Math.round(info.policy.min_item_agreement * 100)}% — ngưỡng mặc định kỹ thuật, <b>{info.policy.thresholds_status}</b>.</p>
      <label className="cl-field">Release nền
        <select id="run-base" value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="latest">Mới nhất ({info.releases.at(-1)?.version_label ? 'v' + info.releases.at(-1)!.version_label : 'từ điển rỗng'})</option>
          {info.releases.slice(0, -1).map((r) => <option key={r.release_id} value={r.release_id}>v{r.version_label}</option>)}
          {info.releases.length ? <option value="empty">Từ điển rỗng (v0.0)</option> : null}
        </select>
      </label>
      <label className="cl-row"><input id="run-ack" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi hiểu nội dung JD và sự kiện sẽ được gửi tới Anthropic qua Claude CLI khi chạy các block có AI.</label>
      <div className="cl-row">
        <button id="run-create" className="primary" onClick={createRun} disabled={busy || !ack || !info.jd_set || dirty || !!info.stop}>{info.run ? 'Tạo lượt mới' : 'Tạo lượt đầu tiên'}</button>
        {!info.jd_set ? <span className="dim">Cần xác nhận bộ JD trước.</span> : dirty ? <span className="dim">Xác nhận thay đổi bộ JD trước.</span> : runIsCurrent ? <span className="dim">Lượt hiện tại đang dùng đúng bộ JD này; tạo lượt mới sẽ chạy lại từ B0 (kết quả agent cũ được dùng lại, không gọi lại).</span> : null}
      </div>
    </div>
  );
}
