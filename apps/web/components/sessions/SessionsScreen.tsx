'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SessionListItem } from '@cl/contract';
import { Sidebar } from '@/components/shell/Shell';
import { ApiError, api } from '@/lib/live-source';

const ROLES = ['Product Owner', 'Business Analyst', 'Data Analyst', 'Project Manager', 'UX Designer', 'QA Engineer'];

export default function SessionsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(params.get('new') === '1');
  const [f, setF] = useState({ name: '', role: ROLES[0], custom: '', purpose: '', context: '', family: '', industry: '' });
  const [busy, setBusy] = useState(false);
  const [worker, setWorker] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    api<SessionListItem[]>('/sessions').then(setItems).catch((e) => { setItems([]); setErr(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e)); });
    api<{ ok: boolean; message: string }>('/agents/status').then(setWorker).catch(() => {});
    const again = params.get('newRun');
    if (again) router.replace(`/s/${again}/inputs#run-confirm`);
  }, [params, router]);
  const role_title = f.role === '__custom' ? f.custom : f.role;
  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/sessions', { method: 'POST', json: { name: f.name, role_title, purpose: f.purpose, context: f.context, family: f.family, industry: f.industry } });
      router.push(`/s/${r.id}/inputs`);
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
      setBusy(false);
    }
  };
  return (
    <>
      <Sidebar sessionId={null} tab="sessions" />
      <main>
        <header><span>Competence Lab <span className="dim">/ Quản lý phiên</span></span></header>
        <section className="tab active" id="sessions">
          <div className="eyebrow">PHIÊN LÀM VIỆC</div>
          <h2>Quản lý phiên</h2>
          <p className="dim">Phiên mẫu chạy hoàn toàn trên trình duyệt, không gọi AI. Phiên JD mới lưu trên máy chủ và dùng Claude CLI cho các bước cần phán đoán ngữ nghĩa.</p>
          {worker && !worker.ok ? <p className="cl-warn" role="alert" data-testid="worker-warning">⚠ {worker.message}</p> : null}
          {err ? <p className="cl-err" role="alert">{err}</p> : null}
          <div className="cl-card">
            <div className="cl-row">
              <b>Default Example · Product Owner</b> <span className="mode-pill example">EXAMPLE</span>
              <span className="dim">Seed tổng hợp · 2 lượt · lưu trên trình duyệt</span>
              <Link className="nav-link" href="/s/example/line">Mở →</Link>
            </div>
          </div>
          {(items ?? []).map((s) => (
            <div className="cl-card" key={s.id} data-testid="session-row">
              <div className="cl-row">
                <b>{s.name}</b> <span className="mode-pill live">LIVE</span>
                <span className="dim">{s.roleTitle} · cập nhật {new Date(s.updatedAt).toLocaleString('vi-VN')}</span>
                <Link href={`/s/${s.id}/line`}>Mở →</Link>
                <Link href={`/s/${s.id}/inputs#run-confirm`}>Tạo lượt mới</Link>
              </div>
              {s.runs.length ? (
                <ul>{s.runs.map((r) => <li key={r.runNo}>Lượt {String(r.runNo).padStart(2, '0')} · {r.status === 'COMPLETE' ? 'đã công bố' : 'đang mở'} · nền v{r.baseRelease} · {new Date(r.createdAt).toLocaleString('vi-VN')}</li>)}</ul>
              ) : <p className="dim">Chưa có lượt chạy.</p>}
            </div>
          ))}
          {items && !items.length ? <p className="dim">Chưa có phiên Live nào.</p> : null}
          {!open ? <button id="session-new" className="primary" onClick={() => setOpen(true)}>＋ Tạo phiên JD mới</button> : (
            <div className="cl-card" id="session-form">
              <h3>Phiên JD mới</h3>
              <label className="cl-field">Tên phiên<input id="s-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ví dụ: PO khối ngân hàng số 2026" /></label>
              <label className="cl-field">Vị trí / role
                <select id="s-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                  <option value="__custom">Chức danh khác…</option>
                </select>
              </label>
              {f.role === '__custom' ? <label className="cl-field">Chức danh tùy chỉnh<input id="s-role-custom" value={f.custom} onChange={(e) => setF({ ...f, custom: e.target.value })} /></label> : null}
              <label className="cl-field">Mục đích dùng khung<input id="s-purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="ví dụ: khung nháp nội bộ để thiết kế lộ trình phát triển" /></label>
              <label className="cl-field">Bối cảnh (tùy chọn)<input id="s-context" value={f.context} onChange={(e) => setF({ ...f, context: e.target.value })} /></label>
              <div className="cl-row">
                <label className="cl-field" style={{ flex: 1 }}>Nhóm nghề (tùy chọn)<input value={f.family} onChange={(e) => setF({ ...f, family: e.target.value })} /></label>
                <label className="cl-field" style={{ flex: 1 }}>Ngành (tùy chọn)<input value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></label>
              </div>
              <div className="cl-row">
                <button id="s-create" className="primary" disabled={busy || !f.name.trim() || !role_title.trim() || !f.purpose.trim()} onClick={create}>Tạo phiên và thêm JD →</button>
                <button className="ghost" onClick={() => setOpen(false)}>Hủy</button>
              </div>
              <p className="dim">Bước tiếp theo: thêm JD → xem trước và xác nhận → màn chốt trước khi chạy → B0. Chưa có gì được gửi tới AI ở bước này.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
