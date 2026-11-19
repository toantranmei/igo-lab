'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/live-source';
import { SessionPicker } from './Shell';
import '@/components/run/run.css';

/**
 * One header for every screen, in two zones that do not mix:
 *  - PHIÊN: the session picker and the screens of that session (inputs, runs, results);
 *  - DÙNG CHUNG · WORKSPACE: what every session shares — the one dictionary, production, sessions, transfer, settings.
 * The dictionary sits in the shared zone on purpose: there is a single dictionary per workspace, not one per session.
 */
export const SESSION_NAV: { id: string; label: string; match: string[] }[] = [
  { id: 'inputs', label: 'Đầu vào', match: ['inputs'] },
  { id: 'run', label: 'Lượt chạy', match: ['run', 'line'] },
  { id: 'results', label: 'Kết quả', match: ['results', 'framework', 'audit'] },
];
export const WORKSPACE_NAV: { id: string; label: string; href: string; title: string }[] = [
  { id: 'dictionary', label: 'Từ điển', href: '/dictionary', title: 'Từ điển năng lực chung của workspace: mọi phiên đọc và ghi vào cùng một từ điển' },
  { id: 'production', label: 'Sản xuất', href: '/production', title: 'Sản xuất hàng loạt, chất lượng từ điển, khung đến hạn rà soát' },
  { id: 'sessions', label: 'Phiên', href: '/sessions', title: 'Tạo và quản lý các phiên' },
  { id: 'transfer', label: 'Xuất / khôi phục', href: '/transfer', title: 'Sao lưu, gói từ điển, khôi phục' },
  { id: 'settings', label: 'Cài đặt', href: '/settings', title: 'Model, bộ ngưỡng, ngân sách và công cụ AI' },
];

const LAST = 'cl.lastSession';
/** The session the person worked in last, so the session zone stays usable on shared screens. */
export function rememberSession(id: string) {
  try {
    localStorage.setItem(LAST, id);
  } catch {
    /* storage is optional */
  }
}
export function useLastSession(): string {
  const [id, setId] = useState('');
  useEffect(() => {
    try {
      setId(localStorage.getItem(LAST) ?? '');
    } catch {
      setId('');
    }
  }, []);
  return id;
}

export default function AppHeader({ sessionId, active, status }: { sessionId: string | null; active: string; status?: ReactNode }) {
  const last = useLastSession();
  const sid = sessionId ?? last;
  return (
    <div className="lv-bar app-bar" role="banner">
      <Link className="lv-brand" href="/sessions">
        COMPETENCE LAB
      </Link>
      <div className="zone zone-session" aria-label="Phiên đang làm">
        <span className="zone-label">PHIÊN</span>
        <SessionPicker current={sid} />
        <nav className="lv-nav" aria-label="Điều hướng chính">
          {SESSION_NAV.map((n) =>
            sid ? (
              <Link key={n.id} href={`/s/${sid}/${n.id}`} className={sessionId && n.match.includes(active) ? 'on' : ''} aria-current={sessionId && n.match.includes(active) ? 'page' : undefined}>
                {n.label}
              </Link>
            ) : (
              <span key={n.id} className="off" title="Chọn hoặc tạo phiên trước">
                {n.label}
              </span>
            ),
          )}
        </nav>
      </div>
      <span className="lv-sp" />
      {status}
      <div className="zone zone-shared" aria-label="Dùng chung cho mọi phiên">
        <span className="zone-label">DÙNG CHUNG</span>
        <nav className="lv-nav" aria-label="Khu dùng chung của workspace">
          {WORKSPACE_NAV.map((n) => (
            <Link key={n.id} href={n.href} title={n.title} className={active === n.id ? 'on' : ''} aria-current={active === n.id ? 'page' : undefined} data-nav={n.id}>
              {n.id === 'settings' ? '⚙ ' : ''}
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Worker status for screens outside a session (the session screens read it from the session state). */
function WorkerStatus() {
  const [w, setW] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    api<{ ok: boolean; message: string }>('/agents/status').then(setW).catch(() => setW(null));
  }, []);
  if (!w) return null;
  return (
    <span className={'lv-chip ' + (w.ok ? 'ok' : 'bad')} title={w.message} data-testid="worker-chip">
      <span className="dot" />
      {w.ok ? 'Worker sẵn sàng' : 'Worker / Claude CLI chưa sẵn sàng'}
    </span>
  );
}

/** Shell of the shared (workspace) screens: the same header, no session context needed. */
export function WorkspaceShell({ active, title, note, children }: { active: string; title: string; note?: string; children: ReactNode }) {
  return (
    <div className="lv-shell">
      <AppHeader sessionId={null} active={active} status={<WorkerStatus />} />
      <div className="lv-body" role="main">
        <div className="ws-head">
          <span className="ws-tag">DÙNG CHUNG CHO MỌI PHIÊN</span>
          <h2>{title}</h2>
          {note ? <p className="dim">{note}</p> : null}
        </div>
        {children}
      </div>
      <div className="lv-foot">
        <span>COMPETENCE LAB · workspace</span>
        <span>Dữ liệu Live lưu trên máy chủ · bản nháp nội bộ · chưa phải bằng chứng nghề đã kiểm chứng</span>
      </div>
    </div>
  );
}
