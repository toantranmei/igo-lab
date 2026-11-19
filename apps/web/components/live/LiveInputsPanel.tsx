'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/live-source';
import { useSession } from '@/lib/session';
import Modal from '@/components/ui/Modal';

interface Warning { code: string; severity: 'error' | 'warn' | 'info'; message: string }
interface Draft { key: string; name: string; text: string; source_ref: string; origin_group: string; posted_at: string; blob_sha256: string | null; document_id?: string; warnings: Warning[]; ok: boolean; chars: number; segments: number; pages: number | null; pii: { kind: string; text: string }[]; existing: boolean }
interface Doc { ref: string; document_id: string; name: string; text: string; source_ref: string; origin_group: string; posted_at: string; chars: number; segments: number }
interface Info {
  session: { name: string; role_title: string; purpose: string; policy?: { id: string; rigor: 'A' | 'B' | 'C'; min_valid_jd: number } };
  jd_set: { revision: number; documents: Doc[] } | null;
  events: { id: string; label: string; situation: string; action: string; outcome: string; source_ref: string; person_code?: string | null; person_group?: string | null }[];
  ai_tool?: { provider: string; channel: string; account_type: string; retention: string; no_training: boolean } | null;
  run: { run_no: number; status: string; jd_set_revision: number; base_version_label: string; lessons_loaded?: { id: string; text: string }[]; policy?: string | null } | null;
  releases: { release_id: string; version_label: string }[];
  plan: { tasks: { task: string; task_id: string; block: string; title: string; model: string; effort: string; unit: string; calls: string; skip?: string }[]; estimate: { note: string }; disclosure: string };
  policy: { id: string; version: number; min_coverage: number; min_item_agreement: number; thresholds_status: string };
  limits: { maxFiles: number; maxFileMb: number; maxCharsPerDoc: number; extensions: string[] };
  worker: { ok: boolean; message: string };
  stop: { reason: string } | null;
}
interface HfDataset { id: string; state: 'QUEUED' | 'DOWNLOADING' | 'READY' | 'FAILED'; progress: string; error: { code: string; message: string } | null; rows: number | null; bytes: number | null; license: string | null; revision: string | null; downloaded_at: string | null }
interface HfRow { row: number; title: string; org: string; text: string; chars: number; source_ref: string; posted_at?: string | null }
interface HfScan { id: string; state: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'; progress: string; role?: string; error: { code: string; message: string } | null; result: { dataset: string; license: string | null; dataset_rows: number; keywords: string[]; candidate_titles: number; candidate_rows: number; judged_titles: number; truncated: boolean; total_rows: number; hits: { row: number; title: string }[] } | null }
const errText = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/** SOP: postings older than 24 months are dropped at B1 (same rule as the pipeline, shown before the run). */
const MAX_AGE_MONTHS = 24;
const tooOld = (d: string) => !!d && (Date.now() - Date.parse(d)) / (30.44 * 86400000) > MAX_AGE_MONTHS;
const fmtDate = (d: string) => (d ? d.split('-').reverse().join('/') : '');
const host = (s: string) => {
  try {
    return /^https?:\/\//.test(s) ? new URL(s).hostname.replace(/^www\./, '') : s;
  } catch {
    return s;
  }
};
const RIGOR: Record<string, string> = { A: 'Mức A · BEI và khảo sát', B: 'Mức B · sự kiện viết', C: 'Mức C · JD và từ điển' };

function DateChip({ d }: { d: string }) {
  if (!d) return <span className="chip dim" title="Không rõ ngày đăng: vẫn dùng làm bằng chứng, điểm độ mới D = 0">không rõ · D = 0</span>;
  if (tooOld(d)) return <span className="chip warn" title={`Đăng quá ${MAX_AGE_MONTHS} tháng: B1 loại trước khi gửi AI (SOP)`}>⊘ {fmtDate(d)} · quá 24 tháng</span>;
  return <span className="chip">{fmtDate(d)}</span>;
}

/** Live only: a three-step wizard — the JD set, data from people, then the estimate and the run. */
export default function LiveInputsPanel() {
  const { sessionId, refresh, toast } = useSession();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [kept, setKept] = useState<string[] | null>(null);
  const [adding, setAdding] = useState<null | 'paste' | 'file' | 'dataset'>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'event' | 'survey' | 'estimate'>(null);
  const [paste, setPaste] = useState({ name: '', text: '', source_ref: '', origin_group: '', posted_at: '' });
  const EV0 = { label: '', situation: '', action: '', outcome: '', source_ref: '', person_code: '', person_group: '', kind: 'WRITTEN', consent_ref: '' };
  const [ev, setEv] = useState(EV0);
  const [proposal, setProposal] = useState<Record<string, string> | null>(null);
  const [survey, setSurvey] = useState({ text: '', consent_ref: '' });
  const [err, setErr] = useState('');
  const [modalErr, setModalErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [autoRun, setAutoRun] = useState(true);
  const [base, setBase] = useState<string>('latest');
  const fileRef = useRef<HTMLInputElement>(null);
  const [hf, setHf] = useState({ link: '', dataset: '', role: '' });
  const [datasets, setDatasets] = useState<HfDataset[]>([]);
  const [scan, setScan] = useState<HfScan | null>(null);
  const [hfPick, setHfPick] = useState<number[]>([]);
  const [hfText, setHfText] = useState<Record<number, string>>({});
  const [hfShown, setHfShown] = useState(50);

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

  const toDraft = (x: any, i: number, meta: { source_ref: string; origin_group: string; posted_at: string }): Draft => ({ key: `${Date.now()}-${i}`, name: x.name, text: x.text, ...meta, blob_sha256: x.blob_sha256, warnings: x.warnings, ok: x.ok, chars: x.chars, segments: x.segments, pages: x.pages, pii: x.pii, existing: !!x.existing });
  const preview = async () => {
    setModalErr('');
    const files = Array.from(fileRef.current?.files ?? []);
    const meta = adding === 'paste' && paste.text.trim() ? [{ name: paste.name.trim() || `Bản dán ${drafts.length + 1}`, text: paste.text, source_ref: paste.source_ref, origin_group: paste.origin_group, posted_at: paste.posted_at }] : [];
    if (!files.length && !meta.length) return setModalErr(adding === 'file' ? 'Chọn ít nhất một file.' : 'Dán nội dung JD trước.');
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    for (const f of files) form.append('files', f);
    setBusy(true);
    try {
      const r = await api<{ documents: any[] }>(`/sessions/${sessionId}/jd-sets/preview`, { method: 'POST', body: form });
      setDrafts((d) => [...d, ...r.documents.map((x, i) => toDraft(x, i, x.source_kind === 'file' ? { source_ref: `upload://${x.name}`, origin_group: '', posted_at: '' } : { source_ref: paste.source_ref || `paste://${x.name}`, origin_group: paste.origin_group, posted_at: paste.posted_at }))]);
      setPaste({ name: '', text: '', source_ref: '', origin_group: '', posted_at: '' });
      setAdding(null);
      toast(`Đã thêm ${r.documents.length} tài liệu vào danh sách chờ xác nhận.`);
    } catch (e) {
      setModalErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  // Datasets downloaded to the server (the worker downloads; polled while one is in progress).
  const loadDatasets = useCallback(async () => {
    try {
      const d = await api<HfDataset[]>('/sources/datasets');
      setDatasets(d);
      setHf((h) => (h.dataset && d.some((x) => x.id === h.dataset && x.rows) ? h : { ...h, dataset: d.find((x) => x.rows)?.id ?? '' }));
    } catch {
      /* the list is optional */
    }
  }, []);
  useEffect(() => void loadDatasets(), [loadDatasets]);
  const downloading = datasets.some((d) => d.state === 'QUEUED' || d.state === 'DOWNLOADING');
  useEffect(() => {
    if (!downloading) return;
    const t = setInterval(() => void loadDatasets(), 2000);
    return () => clearInterval(t);
  }, [downloading, loadDatasets]);
  const hfDownload = async (link: string) => {
    setModalErr('');
    try {
      await api('/sources/datasets', { method: 'POST', json: { link } });
      setHf((h) => ({ ...h, link: '' }));
      await loadDatasets();
    } catch (e) {
      setModalErr(errText(e));
    }
  };
  const hfRemove = async (id: string) => {
    if (!window.confirm(`Xóa bản tải về của ${id} khỏi máy chủ? JD đã đưa vào phiên không bị ảnh hưởng.`)) return;
    try {
      await api(`/sources/datasets/${id}`, { method: 'DELETE' });
      await loadDatasets();
    } catch (e) {
      setModalErr(errText(e));
    }
  };
  // AI scan of a downloaded dataset: queued on the server, run by the worker, polled here.
  const hfScan = async () => {
    setModalErr('');
    setScan(null);
    setHfPick([]);
    setHfText({});
    setHfShown(50);
    try {
      const { id } = await api<{ id: string }>('/sources/searches', { method: 'POST', json: { dataset: hf.dataset, role: hf.role.trim() || info?.session.role_title } });
      setScan({ id, state: 'QUEUED', progress: 'Đang chờ worker…', result: null, error: null });
    } catch (e) {
      setModalErr(errText(e));
    }
  };
  const scanId = scan?.id;
  const scanActive = scan?.state === 'QUEUED' || scan?.state === 'RUNNING';
  useEffect(() => {
    if (!scanId || !scanActive) return;
    const t = setInterval(() => void api<HfScan>(`/sources/searches/${scanId}`).then(setScan).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [scanId, scanActive]);
  const hfRoom = Math.max(0, (info?.limits.maxFiles ?? 20) - (kept?.length ?? 0) - drafts.filter((d) => d.ok).length);
  const hfOpen = async (row: number) => {
    if (hfText[row] !== undefined) return;
    setHfText((m) => ({ ...m, [row]: 'Đang tải…' }));
    try {
      const [h] = await api<HfRow[]>('/sources/rows', { method: 'POST', json: { dataset: scan?.result?.dataset, rows: [row] } });
      setHfText((m) => ({ ...m, [row]: h?.text ?? 'Không đọc được dòng này.' }));
    } catch (e) {
      setHfText((m) => ({ ...m, [row]: errText(e) }));
    }
  };
  const hfAdd = async () => {
    setModalErr('');
    setBusy(true);
    try {
      const picked = await api<HfRow[]>('/sources/rows', { method: 'POST', json: { dataset: scan?.result?.dataset, rows: hfPick } });
      const form = new FormData();
      form.set('meta', JSON.stringify(picked.map((h) => ({ name: `${h.title}${h.org ? ` — ${h.org}` : ''} (HF #${h.row})`, text: h.text, source_ref: h.source_ref, origin_group: h.org, posted_at: h.posted_at ?? '' }))));
      const r = await api<{ documents: any[] }>(`/sessions/${sessionId}/jd-sets/preview`, { method: 'POST', body: form });
      setDrafts((d) => [...d, ...r.documents.map((x, i) => toDraft(x, i, { source_ref: picked[i]?.source_ref ?? '', origin_group: picked[i]?.org ?? '', posted_at: picked[i]?.posted_at ?? '' }))]);
      setHfPick([]);
      setAdding(null);
      toast(`Đã thêm ${r.documents.length} tin từ dataset vào danh sách chờ xác nhận.`);
    } catch (e) {
      setModalErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setErr('');
    const existing = (info?.jd_set?.documents ?? []).filter((d) => kept?.includes(d.ref)).map((d) => ({ name: d.name, text: d.text, source_ref: d.source_ref, origin_group: d.origin_group, posted_at: d.posted_at || null, document_id: d.document_id }));
    const fresh = drafts.filter((d) => d.ok).map((d) => ({ name: d.name, text: d.text, source_ref: d.source_ref, origin_group: d.origin_group, posted_at: d.posted_at || null, blob_sha256: d.blob_sha256 }));
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
    setModalErr('');
    try {
      await api(`/sessions/${sessionId}/events`, { method: 'POST', json: { ...ev, person_code: ev.person_code || undefined, person_group: ev.person_group || undefined, consent_ref: ev.consent_ref || undefined } });
      setEv(EV0);
      setProposal(null);
      setModal(null);
      await load();
      await refresh();
    } catch (e) {
      // P4.2: identifying marks → offer the de-identified proposal
      if (e instanceof ApiError && e.code === 'DEIDENTIFY_REQUIRED') setProposal(((e.details as any)?.proposal ?? null) as Record<string, string> | null);
      setModalErr(errText(e));
    }
  };
  const saveSurvey = async () => {
    setModalErr('');
    try {
      const rows = survey.text.split('\n').map((l) => l.split(/[,;\t]/).map((x) => x.trim())).filter((c) => c.length >= 3 && c[0]).map(([respondent_code, competency_label, importance, discrimination, level]) => ({ respondent_code, competency_label, importance: importance ? Number(importance) : null, discrimination: discrimination ? Number(discrimination) : null, level: level ? Number(level) : null }));
      const r = await api<{ rows: number; respondents: number }>(`/sessions/${sessionId}/survey`, { method: 'PUT', json: { rows, consent_ref: survey.consent_ref } });
      setModal(null);
      toast(`Đã lưu ${r.rows} dòng khảo sát của ${r.respondents} người. Có hiệu lực từ lượt kế tiếp.`);
    } catch (e) {
      setModalErr(errText(e));
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
      if (autoRun) await api(`/sessions/${sessionId}/auto`, { method: 'POST', json: { on: true } }).catch((e) => setErr(errText(e)));
      toast(autoRun ? `Đã tạo lượt ${String(r.run_no).padStart(2, '0')} và bắt đầu chạy tới B8.` : `Đã tạo lượt ${String(r.run_no).padStart(2, '0')}. Bấm "Chạy" ở màn Lượt chạy.`);
      router.push(`/s/${sessionId}/run`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const openAdd = (t: 'paste' | 'file' | 'dataset') => {
    setModalErr('');
    setAdding(t);
  };
  const openModal = (m: 'event' | 'survey' | 'estimate') => {
    setModalErr('');
    setModal(m);
  };

  if (!info) return <div className="cl-card">{err ? <p className="cl-err" role="alert">{err}</p> : <p className="dim">Đang tải dữ liệu của phiên…</p>}</div>;
  const docs = info.jd_set?.documents ?? [];
  const dirty = drafts.some((d) => d.ok) || (kept !== null && kept.length !== docs.length);
  const total = (kept?.length ?? 0) + drafts.filter((d) => d.ok).length;
  const runIsCurrent = info.run && info.jd_set && info.run.jd_set_revision === info.jd_set.revision && info.run.status !== 'COMPLETE';
  const rigor = info.session.policy?.rigor ?? 'C';
  const keptDocs = docs.filter((d) => kept?.includes(d.ref));
  const oldCount = keptDocs.filter((d) => tooOld(d.posted_at)).length;
  const undated = keptDocs.filter((d) => !d.posted_at).length;
  const viewDraft = drafts.find((d) => d.key === viewing) ?? null;
  const viewDoc = docs.find((d) => d.ref === viewing) ?? null;
  const setDraft = (key: string, patch: Partial<Draft>) => setDrafts((x) => x.map((y) => (y.key === key ? { ...y, ...patch } : y)));
  const canStep2 = !!info.jd_set && !dirty;
  const steps: { n: 1 | 2 | 3; label: string; sub: string; enabled: boolean }[] = [
    { n: 1, label: 'Bộ JD', sub: info.jd_set ? `${docs.length} JD · revision ${info.jd_set.revision}${dirty ? ' · chưa xác nhận' : ''}` : 'chưa có', enabled: true },
    { n: 2, label: 'Dữ liệu từ người', sub: rigor === 'C' ? `không bắt buộc · ${info.events.length} sự kiện` : `${info.events.length} sự kiện`, enabled: canStep2 },
    { n: 3, label: 'Ước tính và chạy', sub: info.run ? `lượt ${String(info.run.run_no).padStart(2, '0')} đang có` : 'chưa có lượt', enabled: canStep2 },
  ];

  return (
    <div className="cl-card wiz" id="live-inputs" data-testid="live-inputs">
      <div className="wiz-head">
        <div>
          <h3>
            {info.session.name} <span className="dim">· {info.session.role_title}</span>
          </h3>
          <p className="dim">
            {info.session.purpose} · <span className="chip">{RIGOR[rigor]}</span>
          </p>
        </div>
        <span className={info.worker.ok ? 'cl-ok' : 'cl-warn'} title={info.worker.message}>
          ● {info.worker.ok ? 'Worker sẵn sàng' : 'Worker chưa sẵn sàng'}
        </span>
      </div>
      {info.stop ? <p className="cl-warn" role="alert">⚠ Workspace đang STOP: {info.stop.reason}. Xử lý ở tab Audit trước khi tạo lượt mới.</p> : null}

      <ol className="wiz-steps" aria-label="Các bước">
        {steps.map((s) => (
          <li key={s.n}>
            <button type="button" id={`wiz-step-${s.n}`} className={step === s.n ? 'on' : ''} aria-current={step === s.n ? 'step' : undefined} disabled={!s.enabled} onClick={() => setStep(s.n)} title={s.enabled ? undefined : 'Xác nhận bộ JD trước'}>
              <i>{s.n}</i>
              <span>
                <b>{s.label}</b>
                <small>{s.sub}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {err ? <p className="cl-err" role="alert" data-testid="live-error">{err}</p> : null}

      {step === 1 ? (
        <section aria-label="Bước 1 · Bộ JD">
          <div className="wiz-bar">
            <b>Bộ JD</b>
            {info.jd_set ? <span className="pill">revision {info.jd_set.revision}</span> : <span className="pill">chưa có</span>}
            <span className="dim">{total} tài liệu sẽ dùng</span>
            <span className="grow" />
            <button id="jd-add-paste" onClick={() => openAdd('paste')}>＋ Dán JD</button>
            <button id="jd-add-file" onClick={() => openAdd('file')}>＋ Tải file</button>
            <button id="jd-add-dataset" onClick={() => openAdd('dataset')}>＋ Từ dataset</button>
          </div>
          {docs.length || drafts.length ? (
            <div className="scroll-x">
              <table className="cl-table wiz-list" id="jd-list">
                <thead>
                  <tr><th style={{ width: 28 }} /><th>Tài liệu</th><th>Ngày đăng</th><th>Nguồn</th><th>Ghi chú</th><th /></tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.ref} className={kept?.includes(d.ref) ? '' : 'off'}>
                      <td><input type="checkbox" aria-label={`Giữ ${d.name}`} checked={kept?.includes(d.ref) ?? true} onChange={(e) => setKept((k) => (e.target.checked ? [...(k ?? []), d.ref] : (k ?? []).filter((x) => x !== d.ref)))} /></td>
                      <td><button type="button" className="link" onClick={() => setViewing(d.ref)}>{d.name}</button></td>
                      <td><DateChip d={d.posted_at} /></td>
                      <td className="dim" title={d.source_ref}>{d.source_ref ? host(d.source_ref) : <span className="cl-warn">chưa nhập</span>}</td>
                      <td className="dim">{d.chars.toLocaleString('vi-VN')} ký tự</td>
                      <td><button type="button" className="ghost" onClick={() => setViewing(d.ref)}>Xem</button></td>
                    </tr>
                  ))}
                  {drafts.map((d) => {
                    const w = d.warnings.find((x) => x.severity === 'error') ?? d.warnings.find((x) => x.severity === 'warn');
                    return (
                      <tr key={d.key} data-testid="jd-draft" data-ok={d.ok} className={d.ok ? 'new' : 'bad'}>
                        <td>{d.ok ? <span className="chip ok" title="Chờ xác nhận">mới</span> : <span className="chip err">⊘</span>}</td>
                        <td><button type="button" className="link" onClick={() => setViewing(d.key)}>{d.name}</button></td>
                        <td><DateChip d={d.posted_at} /></td>
                        <td className="dim" title={d.source_ref}>{d.source_ref && !/^(upload|paste):\/\//.test(d.source_ref) ? host(d.source_ref) : <span className="cl-warn">Chưa nhập nguồn</span>}</td>
                        <td>
                          {w ? <span className={w.severity === 'error' ? 'cl-err' : 'cl-warn'}>{w.message}</span> : null}
                          {d.pii.length ? <span className="cl-warn"> · {d.pii.length} thông tin liên hệ</span> : null}
                        </td>
                        <td className="nowrap">
                          <button type="button" className="ghost" onClick={() => setViewing(d.key)}>Xem</button>
                          <button type="button" className="ghost" aria-label={`Bỏ ${d.name}`} onClick={() => setDrafts((x) => x.filter((y) => y.key !== d.key))}>Bỏ</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="wiz-empty">
              <p>Phiên chưa có JD nào.</p>
              <p className="dim">Dán nội dung, tải file (.txt, .md, .pdf, .docx) hoặc lấy từ dataset tuyển dụng đã tải về máy chủ.</p>
            </div>
          )}
          <div className="wiz-foot">
            {dirty ? <span className="cl-warn">Có thay đổi chưa xác nhận. Xác nhận tạo revision mới; các lượt đã chạy giữ nguyên.</span> : <span className="dim">{info.jd_set ? 'Bộ JD đã xác nhận.' : ''}</span>}
            <span className="grow" />
            <button id="jd-confirm" className={dirty ? 'primary' : ''} onClick={confirm} disabled={busy || !dirty || total === 0}>Xác nhận bộ JD ({total})</button>
            <button id="wiz-next-1" className={dirty ? '' : 'primary'} onClick={() => setStep(2)} disabled={!canStep2}>Tiếp →</button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-label="Bước 2 · Dữ liệu từ người">
          <p className="dim">
            {rigor === 'C'
              ? 'Mức C dùng JD và từ điển: phần này không bắt buộc, có thể bỏ qua. Sự kiện thật nếu có sẽ được kiểm ở B4.'
              : rigor === 'B'
                ? 'Mức B cần sự kiện viết của ≥ 3 người (≥ 6 sự kiện) và khảo sát ≥ 5 người cho mỗi năng lực lõi.'
                : 'Mức A cần BEI ≥ 6 người xuất sắc và ≥ 3 người trung bình, và khảo sát ≥ 10 người cho mỗi năng lực lõi.'}
          </p>
          <div className="cl-grid2">
            <div className="cl-card">
              <div className="wiz-bar">
                <b>Sự kiện thật</b>
                <span className="pill">{info.events.length}</span>
                <span className="grow" />
                <button id="ev-open" onClick={() => openModal('event')}>＋ Thêm sự kiện</button>
              </div>
              {info.events.length ? (
                <ul className="wiz-items">
                  {info.events.map((e) => (
                    <li key={e.id}>
                      <b>{e.label}</b> <span className="dim">{e.person_code ? `· ${e.person_code}` : ''} · nguồn: {e.source_ref || 'thiếu'}</span>
                      <button className="ghost" onClick={async () => { await api(`/sessions/${sessionId}/events/${e.id}`, { method: 'DELETE' }); await load(); await refresh(); }}>Xóa</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="dim">Chưa có sự kiện. Agent chỉ kiểm sự kiện bạn nhập; giả thuyết không được tính là bằng chứng.</p>}
            </div>
            <div className="cl-card">
              <div className="wiz-bar">
                <b>Khảo sát</b>
                <span className="grow" />
                <button id="survey-open" onClick={() => openModal('survey')}>Nhập khảo sát</button>
              </div>
              <p className="dim">Phiếu của người (quan trọng, phân biệt, bậc) thay ba ghế AI ở B5 khi đủ người trả lời.</p>
            </div>
          </div>
          {info.run?.lessons_loaded?.length ? (
            <details className="cl-card" data-testid="lessons-loaded">
              <summary>Bài học tự nạp vào lượt {String(info.run.run_no).padStart(2, '0')} ({info.run.lessons_loaded.length})</summary>
              <ul>{info.run.lessons_loaded.map((l) => <li key={l.id}>{l.text}</li>)}</ul>
            </details>
          ) : null}
          {info.ai_tool ? <p className="dim" data-testid="ai-tool">Công cụ AI: {info.ai_tool.provider} · {info.ai_tool.channel} · {info.ai_tool.account_type} · lưu trữ {info.ai_tool.retention} · {info.ai_tool.no_training ? 'không dùng để huấn luyện' : 'có thể dùng để huấn luyện'}</p> : null}
          <div className="wiz-foot">
            <button onClick={() => setStep(1)}>← Quay lại</button>
            <span className="grow" />
            <button id="wiz-next-2" className="primary" onClick={() => setStep(3)}>Tiếp →</button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section aria-label="Bước 3 · Ước tính và chạy">
          <div className="wiz-summary">
            <div><small>Bộ JD</small><b>{keptDocs.length} JD</b><span className="dim">revision {info.jd_set?.revision}{oldCount ? ` · ${oldCount} quá 24 tháng sẽ bị loại` : ''}{undated ? ` · ${undated} không rõ ngày` : ''}</span></div>
            <div><small>Dữ liệu từ người</small><b>{info.events.length} sự kiện</b><span className="dim">{RIGOR[rigor]}</span></div>
            {info.jd_set ? <RunEstimate sessionId={sessionId} revision={info.jd_set.revision} events={info.events.length} onDetail={() => openModal('estimate')} /> : null}
          </div>
          {info.run ? <p className="dim">Lượt hiện tại: {String(info.run.run_no).padStart(2, '0')} · bộ JD revision {info.run.jd_set_revision} · nền v{info.run.base_version_label} · {info.run.status === 'COMPLETE' ? 'đã công bố' : 'đang mở'}. Tạo lượt mới không sửa lượt cũ.</p> : null}
          <div className="cl-row">
            <label className="cl-field" style={{ minWidth: 240 }}>Release nền
              <select id="run-base" value={base} onChange={(e) => setBase(e.target.value)}>
                <option value="latest">Mới nhất ({info.releases.at(-1)?.version_label ? 'v' + info.releases.at(-1)!.version_label : 'từ điển rỗng'})</option>
                {info.releases.slice(0, -1).map((r) => <option key={r.release_id} value={r.release_id}>v{r.version_label}</option>)}
                {info.releases.length ? <option value="empty">Từ điển rỗng (v0.0)</option> : null}
              </select>
            </label>
          </div>
          <p className="dim" data-testid="send-disclosure">{info.plan.disclosure}</p>
          {!info.worker.ok ? <p className="cl-warn" role="alert" data-testid="worker-warning">⚠ {info.worker.message}</p> : null}
          <label className="cl-row"><input id="run-ack" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi đồng ý gửi nội dung JD và sự kiện tới Anthropic qua Claude CLI khi chạy.</label>
          <label className="cl-row"><input id="run-auto" type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} /> Chạy tự động B0→B8 (dừng ở hồ sơ dự kiến chờ bạn duyệt).</label>
          <div className="wiz-foot">
            <button onClick={() => setStep(2)}>← Quay lại</button>
            <span className="grow" />
            {!info.jd_set ? <span className="dim">Cần xác nhận bộ JD trước.</span> : dirty ? <span className="dim">Xác nhận thay đổi bộ JD trước.</span> : runIsCurrent ? <span className="dim">Lượt mới chạy lại từ B0; kết quả agent cũ được dùng lại.</span> : null}
            <button id="run-create" className="primary" onClick={createRun} disabled={busy || !ack || !info.jd_set || dirty || !!info.stop}>{info.run ? 'Tạo lượt mới' : 'Tạo lượt đầu tiên'}</button>
          </div>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- add JD */}
      <Modal open={!!adding} onClose={() => setAdding(null)} id="jd-add-modal" wide title="Thêm JD vào bộ">
        <div className="wiz-tabs" role="tablist">
          {(['paste', 'file', 'dataset'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={adding === t} className={adding === t ? 'on' : ''} onClick={() => setAdding(t)}>{t === 'paste' ? 'Dán nội dung' : t === 'file' ? 'Tải file' : 'Từ dataset'}</button>
          ))}
        </div>
        {modalErr ? <p className="cl-err" role="alert">{modalErr}</p> : null}
        {adding === 'paste' ? (
          <>
            <label className="cl-field">Nội dung JD
              <textarea id="jd-paste" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} placeholder="Dán nguyên văn một mô tả công việc…" />
            </label>
            <div className="cl-row">
              <label className="cl-field" style={{ flex: 2 }}>Tên tài liệu<input id="jd-name" value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.target.value })} /></label>
              <label className="cl-field" style={{ flex: 1 }}>Ngày đăng<input id="jd-posted" type="date" value={paste.posted_at} onChange={(e) => setPaste({ ...paste, posted_at: e.target.value })} /></label>
            </div>
            <div className="cl-row">
              <label className="cl-field" style={{ flex: 2 }}>Nguồn (link hoặc nơi lấy)<input id="jd-source" value={paste.source_ref} onChange={(e) => setPaste({ ...paste, source_ref: e.target.value })} placeholder="https://… hoặc 'trang tuyển dụng công ty A'" /></label>
              <label className="cl-field" style={{ flex: 1 }}>Tổ chức nguồn<input id="jd-org" value={paste.origin_group} onChange={(e) => setPaste({ ...paste, origin_group: e.target.value })} /></label>
            </div>
            <p className="dim">Không có ngày đăng: vẫn dùng, điểm độ mới D = 0. Đăng quá 24 tháng: B1 loại (SOP).</p>
          </>
        ) : null}
        {adding === 'file' ? (
          <>
            <label className="cl-field">Chọn file (nhiều file được)
              <input id="jd-files" ref={fileRef} type="file" multiple accept={info.limits.extensions.join(',')} />
            </label>
            <p className="dim" data-testid="upload-limits">
              Hỗ trợ {info.limits.extensions.join(', ')} (PDF phải có lớp văn bản). Tối đa {info.limits.maxFiles} tài liệu, {info.limits.maxFileMb} MB mỗi file, {info.limits.maxCharsPerDoc.toLocaleString('vi-VN')} ký tự mỗi tài liệu. Nguồn và ngày đăng nhập sau ở nút "Xem" của từng tài liệu.
            </p>
          </>
        ) : null}
        {adding === 'paste' || adding === 'file' ? (
          <div className="wiz-foot">
            <span className="grow" />
            <button onClick={() => setAdding(null)}>Hủy</button>
            <button id="jd-preview" className="primary" onClick={preview} disabled={busy}>Đọc và thêm vào danh sách</button>
          </div>
        ) : null}
        {adding === 'dataset' ? (
          <div id="hf-import">
            <p className="dim">Bước 1: tải dataset công khai về máy chủ (một lần). Bước 2: nêu vị trí; AI sinh từ khóa, code lọc tiêu đề, AI duyệt từng chức danh. Chỉ tên vị trí và danh sách chức danh được gửi tới AI. Bạn tự chịu trách nhiệm về giấy phép của dataset.</p>
            {datasets.length ? (
              <div className="scroll-x">
                <table className="cl-table" data-testid="hf-datasets">
                  <thead><tr><th>Dataset trên máy chủ</th><th>Số dòng</th><th>Giấy phép</th><th>Bản tải</th><th /></tr></thead>
                  <tbody>
                    {datasets.map((d) => (
                      <tr key={d.id} data-state={d.state}>
                        <td className="cl-mono">{d.id}</td>
                        <td>{d.rows?.toLocaleString('vi-VN') ?? '—'}</td>
                        <td>{d.rows ? d.license ? <span className={/nc|unknown|other/i.test(d.license) ? 'cl-warn' : undefined}>{d.license}</span> : <span className="cl-warn">không khai báo</span> : '—'}</td>
                        <td>
                          {d.state === 'QUEUED' || d.state === 'DOWNLOADING' ? <span role="status">⏳ {d.progress}</span> : d.downloaded_at ? new Date(d.downloaded_at).toLocaleDateString('vi-VN') : null}
                          {d.error ? <div className="cl-err">{d.error.code}: {d.error.message}</div> : null}
                        </td>
                        <td className="nowrap">
                          <button className="ghost" disabled={d.state === 'QUEUED' || d.state === 'DOWNLOADING'} onClick={() => hfDownload(d.id)}>Cập nhật</button>
                          <button className="ghost" disabled={d.state === 'DOWNLOADING'} onClick={() => hfRemove(d.id)}>Xóa</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="dim">Chưa có dataset nào trên máy chủ.</p>}
            <div className="cl-row">
              <label className="cl-field" style={{ flex: 2 }}>Thêm dataset (link Hugging Face)<input id="hf-link" value={hf.link} onChange={(e) => setHf({ ...hf, link: e.target.value })} placeholder="https://huggingface.co/datasets/<tác giả>/<tên>" /></label>
              <button id="hf-download" onClick={() => hfDownload(hf.link)} disabled={!hf.link.trim()}>Tải về máy chủ</button>
            </div>
            <div className="cl-row">
              <label className="cl-field" style={{ flex: 2 }}>Dataset để quét
                <select id="hf-dataset" value={hf.dataset} onChange={(e) => setHf({ ...hf, dataset: e.target.value })}>
                  {datasets.filter((d) => d.rows).map((d) => <option key={d.id} value={d.id}>{d.id} · {d.rows!.toLocaleString('vi-VN')} dòng</option>)}
                  {!datasets.some((d) => d.rows) ? <option value="">(chưa có dataset sẵn sàng)</option> : null}
                </select>
              </label>
              <label className="cl-field" style={{ flex: 1 }}>Vị trí cần tìm<input id="hf-role" value={hf.role} onChange={(e) => setHf({ ...hf, role: e.target.value })} placeholder={info.session.role_title} /></label>
              <button id="hf-scan" onClick={hfScan} disabled={busy || scanActive || !hf.dataset}>AI quét dataset</button>
            </div>
            {scanActive ? <p role="status" data-testid="hf-progress">⏳ {scan!.progress}</p> : null}
            {scan?.state === 'FAILED' ? <p className="cl-err" role="alert"><b>{scan.error?.code}</b>: {scan.error?.message}</p> : null}
            {scan?.result ? (
              <div data-testid="hf-results">
                <p>
                  <b>{scan.result.total_rows.toLocaleString('vi-VN')}</b> tin đúng vị trí "{scan.role}" trong {scan.result.dataset_rows.toLocaleString('vi-VN')} dòng · giấy phép: {scan.result.license ? <b className={/nc|unknown|other/i.test(scan.result.license) ? 'cl-warn' : undefined}>{scan.result.license}</b> : <b className="cl-warn">không khai báo</b>}
                </p>
                {scan.result.total_rows === 0 ? (
                  <p className="cl-warn" role="alert" data-testid="hf-empty">
                    Quét xong, không có tin nào có tiêu đề đúng vị trí này trong dataset. AI chỉ giữ tiêu đề tuyển <b>đúng</b> vị trí đã nhập, không lấy vị trí gần nghĩa. Thử chức danh thị trường hay dùng hoặc chọn dataset khác.
                  </p>
                ) : null}
                <p className="dim">
                  Từ khóa: {scan.result.keywords.join(' · ')}. {scan.result.candidate_rows.toLocaleString('vi-VN')} tin khớp từ khóa ({scan.result.candidate_titles.toLocaleString('vi-VN')} chức danh); AI duyệt {scan.result.judged_titles.toLocaleString('vi-VN')} chức danh.
                  {scan.result.truncated ? ` Kết quả bị cắt: hiện tối đa ${scan.result.hits.length} tin.` : ''}
                </p>
                <div className="cl-row">
                  <button id="hf-all" onClick={() => setHfPick(scan.result!.hits.slice(0, hfRoom).map((h) => h.row))} disabled={!scan.result.hits.length || hfRoom === 0}>Chọn tất cả{scan.result.hits.length > hfRoom ? ` (${hfRoom} tin đầu — giới hạn ${info.limits.maxFiles} JD)` : ''}</button>
                  <button onClick={() => setHfPick([])} disabled={!hfPick.length}>Bỏ chọn</button>
                  <span className="grow" />
                  <button id="hf-add" className="primary" onClick={hfAdd} disabled={busy || !hfPick.length || hfPick.length > hfRoom}>Thêm {hfPick.length} tin vào danh sách</button>
                </div>
                <div className="wiz-scroll">
                  {scan.result.hits.slice(0, hfShown).map((h) => (
                    <details key={h.row} className="record" onToggle={(e) => (e.currentTarget.open ? void hfOpen(h.row) : undefined)}>
                      <summary>
                        <input type="checkbox" aria-label={`Chọn dòng ${h.row}`} checked={hfPick.includes(h.row)} onClick={(e) => e.stopPropagation()} onChange={(e) => setHfPick((p) => (e.target.checked ? [...p, h.row] : p.filter((x) => x !== h.row)))} /> <b>{h.title}</b> <span className="dim">· dòng {h.row}</span>
                      </summary>
                      <pre className="cl-pre">{hfText[h.row] ?? ''}</pre>
                    </details>
                  ))}
                  {scan.result.hits.length > hfShown ? <button onClick={() => setHfShown((n) => n + 100)}>Hiện thêm ({scan.result.hits.length - hfShown} tin)</button> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ---------------------------------------------------------------- view / edit one JD */}
      <Modal open={!!viewing && !!(viewDraft || viewDoc)} onClose={() => setViewing(null)} id="jd-view" wide title={viewDraft?.name ?? viewDoc?.name ?? ''}
        footer={viewDraft ? (
          <>
            <button className="ghost" onClick={() => { setDrafts((x) => x.filter((y) => y.key !== viewDraft.key)); setViewing(null); }}>Bỏ tài liệu</button>
            <span className="grow" />
            <button className="primary" onClick={() => setViewing(null)}>Xong</button>
          </>
        ) : <><span className="grow" /><button onClick={() => setViewing(null)}>Đóng</button></>}>
        {viewDraft ? (
          <div data-testid="jd-view-draft">
            <p className="dim">{viewDraft.ok ? 'Sẽ thêm khi xác nhận bộ JD' : 'Không dùng được'} · {viewDraft.chars.toLocaleString('vi-VN')} ký tự · {viewDraft.segments} đoạn{viewDraft.pages ? ` · ${viewDraft.pages} trang` : ''}</p>
            {viewDraft.warnings.map((w, i) => <p key={i} className={w.severity === 'error' ? 'cl-err' : w.severity === 'warn' ? 'cl-warn' : 'dim'}>{w.severity === 'error' ? '⊘' : w.severity === 'warn' ? '⚠' : 'ℹ'} {w.message}</p>)}
            {viewDraft.pii.length ? <p className="cl-warn">Phát hiện thông tin liên hệ: {viewDraft.pii.map((p) => p.text).join(', ')}. Khi gửi AI chúng được che; bạn có thể xóa hẳn trong văn bản dưới đây.</p> : null}
            <div className="cl-row">
              <label className="cl-field" style={{ flex: 2 }}>Nguồn<input value={viewDraft.source_ref} onChange={(e) => setDraft(viewDraft.key, { source_ref: e.target.value })} /></label>
              <label className="cl-field" style={{ flex: 1 }}>Tổ chức nguồn<input value={viewDraft.origin_group} onChange={(e) => setDraft(viewDraft.key, { origin_group: e.target.value })} /></label>
              <label className="cl-field" style={{ flex: 1 }}>Ngày đăng<input type="date" aria-label={`Ngày đăng ${viewDraft.name}`} value={viewDraft.posted_at} onChange={(e) => setDraft(viewDraft.key, { posted_at: e.target.value })} /></label>
            </div>
            <label className="cl-field">Văn bản (sửa được trước khi xác nhận)
              <textarea id="jd-view-text" style={{ minHeight: 280 }} value={viewDraft.text} onChange={(e) => setDraft(viewDraft.key, { text: e.target.value, ok: viewDraft.ok || e.target.value.trim().length > 0 })} />
            </label>
          </div>
        ) : viewDoc ? (
          <div data-testid="jd-view-doc">
            <div className="cl-row">
              <DateChip d={viewDoc.posted_at} />
              <span className="dim">{viewDoc.origin_group || 'tổ chức chưa xác định'}</span>
              <span className="dim">· {viewDoc.chars.toLocaleString('vi-VN')} ký tự · {viewDoc.segments} đoạn</span>
              <span className="cl-mono dim">{viewDoc.ref}</span>
            </div>
            <p className="dim">Nguồn: {/^https?:\/\//.test(viewDoc.source_ref) ? <a href={viewDoc.source_ref} target="_blank" rel="noreferrer">{viewDoc.source_ref}</a> : viewDoc.source_ref || 'chưa nhập'}</p>
            <pre className="cl-pre">{viewDoc.text}</pre>
            <p className="dim">Tài liệu đã xác nhận không sửa tại chỗ: thêm bản mới rồi bỏ chọn bản cũ, khi xác nhận sẽ tạo revision mới.</p>
          </div>
        ) : null}
      </Modal>

      {/* ---------------------------------------------------------------- event */}
      <Modal open={modal === 'event'} onClose={() => setModal(null)} id="ev-modal" title="Thêm sự kiện thật"
        footer={<><span className="grow" /><button onClick={() => setModal(null)}>Hủy</button><button id="ev-add" className="primary" onClick={addEvent} disabled={!ev.label.trim() || !ev.action.trim()}>Thêm sự kiện</button></>}>
        <p className="dim">Sự kiện công việc đã xảy ra, có nguồn. Không ghi tên thật, tên tổ chức hay địa danh: dùng mã người (giả danh).</p>
        {modalErr ? <p className="cl-err" role="alert">{modalErr}</p> : null}
        <label className="cl-field">Tên sự kiện<input id="ev-label" value={ev.label} onChange={(e) => setEv({ ...ev, label: e.target.value })} /></label>
        <label className="cl-field">Tình huống<input value={ev.situation} onChange={(e) => setEv({ ...ev, situation: e.target.value })} /></label>
        <label className="cl-field">Hành động<input id="ev-action" value={ev.action} onChange={(e) => setEv({ ...ev, action: e.target.value })} /></label>
        <div className="cl-row">
          <label className="cl-field" style={{ flex: 1 }}>Kết quả<input value={ev.outcome} onChange={(e) => setEv({ ...ev, outcome: e.target.value })} /></label>
          <label className="cl-field" style={{ flex: 1 }}>Nguồn<input id="ev-source" value={ev.source_ref} onChange={(e) => setEv({ ...ev, source_ref: e.target.value })} /></label>
        </div>
        <div className="cl-row">
          <label className="cl-field" style={{ flex: 1 }}>Mã người<input id="ev-person" value={ev.person_code} placeholder="P01" onChange={(e) => setEv({ ...ev, person_code: e.target.value.toUpperCase() })} /></label>
          <label className="cl-field" style={{ flex: 1 }}>Nhóm
            <select id="ev-group" value={ev.person_group} onChange={(e) => setEv({ ...ev, person_group: e.target.value })}>
              <option value="">không ghi</option>
              <option value="EXCELLENT">xuất sắc</option>
              <option value="AVERAGE">trung bình</option>
            </select>
          </label>
          <label className="cl-field" style={{ flex: 1 }}>Loại
            <select value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })}>
              <option value="WRITTEN">phiếu sự kiện viết</option>
              <option value="BEI">phỏng vấn BEI</option>
            </select>
          </label>
          <label className="cl-field" style={{ flex: 1 }}>Tham chiếu đồng ý<input id="ev-consent" value={ev.consent_ref} onChange={(e) => setEv({ ...ev, consent_ref: e.target.value })} placeholder="bắt buộc khi có mã người" /></label>
        </div>
        {proposal ? (
          <div className="cl-card cl-warn" data-testid="deidentify-proposal">
            Bản đề xuất đã khử nhận dạng: <b>{proposal.label}</b> — {proposal.situation} {proposal.action} {proposal.outcome}
            <div><button id="ev-use-proposal" onClick={() => { setEv({ ...ev, ...proposal }); setProposal(null); setModalErr(''); }}>Dùng bản đã khử</button></div>
          </div>
        ) : null}
      </Modal>

      {/* ---------------------------------------------------------------- survey */}
      <Modal open={modal === 'survey'} onClose={() => setModal(null)} id="survey-modal" title="Nhập kết quả khảo sát"
        footer={<><span className="grow" /><button onClick={() => setModal(null)}>Hủy</button><button id="survey-save" className="primary" onClick={saveSurvey} disabled={!survey.text.trim() || !survey.consent_ref.trim()}>Lưu khảo sát</button></>}>
        <p className="dim">Mỗi dòng: mã người, tên năng lực, quan trọng 1–5, phân biệt 1–5, bậc 1–5. Mức B cần ≥ 5 người, mức A ≥ 10 người cho mỗi năng lực.</p>
        {modalErr ? <p className="cl-err" role="alert">{modalErr}</p> : null}
        <label className="cl-field">Dữ liệu<textarea id="survey-text" value={survey.text} onChange={(e) => setSurvey({ ...survey, text: e.target.value })} placeholder={'P01, Ưu tiên backlog, 5, 4, 3'} /></label>
        <label className="cl-field">Tham chiếu đồng ý (bắt buộc)<input aria-label="Tham chiếu đồng ý của khảo sát" value={survey.consent_ref} onChange={(e) => setSurvey({ ...survey, consent_ref: e.target.value })} /></label>
      </Modal>

      {/* ---------------------------------------------------------------- estimate detail */}
      <Modal open={modal === 'estimate'} onClose={() => setModal(null)} id="estimate-modal" wide title="Chi tiết ước tính và tác vụ AI">
        {info.jd_set ? <EstimateDetail sessionId={sessionId} revision={info.jd_set.revision} events={info.events.length} /> : null}
        <h4>Tác vụ AI, model và effort</h4>
        <div className="scroll-x">
          <table className="cl-table" data-testid="plan-table">
            <thead><tr><th>Bước</th><th>Tác vụ</th><th>Việc</th><th>Model</th><th>Effort</th><th>Số lần</th></tr></thead>
            <tbody>{info.plan.tasks.map((k) => <tr key={k.task}><td>{k.block}</td><td className="cl-mono">{k.task_id}</td><td>{k.title}{k.skip ? <span className="dim"> · {k.skip}</span> : null}</td><td className="cl-mono">{k.model.replace('claude-', '')}</td><td>{k.effort}</td><td>{k.calls}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="dim">Nhập JD, B0, B8 và mọi phép đếm, công thức, cổng do code tính. Bộ ngưỡng {info.session.policy?.id ?? info.policy.id}: coverage ≥ {Math.round(info.policy.min_coverage * 100)}%, đồng thuận chỉ báo ≥ {Math.round(info.policy.min_item_agreement * 100)}% ({info.policy.thresholds_status}).</p>
      </Modal>
    </div>
  );
}

interface EstimateView {
  blocks: { block: string; calls: number; tokens: number; usd: number; tasks: { task_id: string; calls: number; tokens_per_call: number; usd: number }[] }[];
  calls: number;
  tokens: number;
  usd: number;
  note: string;
  basis: { jds: number; valid: number; tasks: number; groups: number };
  budget: { run_tokens: number; block_tokens: Record<string, number> };
}
const tk = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu` : `${Math.round(n / 1000).toLocaleString('vi-VN')} nghìn`);
const usd = (n: number) => `${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: n < 0.1 ? 3 : 2 })} USD`;
function useEstimate(sessionId: string, revision: number, events: number) {
  const [e, setE] = useState<EstimateView | null>(null);
  useEffect(() => {
    api<EstimateView>(`/sessions/${sessionId}/estimate`).then(setE).catch(() => setE(null));
  }, [sessionId, revision, events]);
  return e;
}
/** Pre-run estimate (spec P0.9) in one line: calls, tokens and the API-equivalent cost; the details open in a popup. */
function RunEstimate({ sessionId, revision, events, onDetail }: { sessionId: string; revision: number; events: number; onDetail: () => void }) {
  const e = useEstimate(sessionId, revision, events);
  if (!e) return <div><small>Ước tính</small><b>…</b></div>;
  return (
    <div data-testid="run-estimate">
      <small>Ước tính trước khi chạy</small>
      <b>≈ {usd(e.usd)}</b>
      <span className="dim">
        {e.calls.toLocaleString('vi-VN')} lời gọi AI · {tk(e.tokens)} token · trần {tk(e.budget.run_tokens)}{' '}
        <button type="button" className="link" id="estimate-detail" onClick={onDetail}>Chi tiết</button>
      </span>
    </div>
  );
}
function EstimateDetail({ sessionId, revision, events }: { sessionId: string; revision: number; events: number }) {
  const e = useEstimate(sessionId, revision, events);
  if (!e) return <p className="dim">Đang tính…</p>;
  return (
    <>
      <p>
        ≈ <b>{e.calls.toLocaleString('vi-VN')}</b> lời gọi AI · ≈ <b>{tk(e.tokens)}</b> token · ≈ <b>{usd(e.usd)}</b> quy đổi theo giá API. Trần của lượt {tk(e.budget.run_tokens)} token (1,5 × ước tính); vượt trần thì lượt dừng chờ bạn xác nhận.
      </p>
      <div className="scroll-x">
        <table className="cl-table">
          <thead><tr><th>Bước</th><th>Tác vụ</th><th style={{ textAlign: 'right' }}>Lời gọi</th><th style={{ textAlign: 'right' }}>Token</th><th style={{ textAlign: 'right' }}>USD</th><th style={{ textAlign: 'right' }}>Trần của bước</th></tr></thead>
          <tbody>
            {e.blocks.filter((b) => b.calls).map((b) => (
              <tr key={b.block}><td>{b.block}</td><td className="cl-mono">{b.tasks.map((x) => `${x.task_id} ×${x.calls}`).join(' · ')}</td><td style={{ textAlign: 'right' }}>{b.calls.toLocaleString('vi-VN')}</td><td style={{ textAlign: 'right' }}>{tk(b.tokens)}</td><td style={{ textAlign: 'right' }}>{usd(b.usd)}</td><td style={{ textAlign: 'right' }}>{e.budget.block_tokens[b.block] ? tk(e.budget.block_tokens[b.block]) : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim">Giả định từ {e.basis.jds} JD: ≈ {e.basis.valid} JD hợp lệ, {e.basis.tasks} nhiệm vụ, {e.basis.groups} nhóm năng lực. Chạy qua Claude CLI theo gói đăng ký nên USD là mức quy đổi để so hạn mức, không phải hóa đơn. {e.note}</p>
    </>
  );
}
