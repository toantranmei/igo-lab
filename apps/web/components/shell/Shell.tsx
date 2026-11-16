'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SessionListItem } from '@cl/contract';
import { EXAMPLE_SESSION_ID, downloadJson, useSession } from '@/lib/session';
import { useGuide } from '@/lib/guide-api';
import { api } from '@/lib/live-source';

export const TABS: { id: string; icon: string; label: string }[] = [
  { id: 'line', icon: '⌘', label: 'Dây chuyền sản xuất' },
  { id: 'inputs', icon: '▤', label: 'Dữ liệu đầu vào' },
  { id: 'framework', icon: '◇', label: 'Khung năng lực' },
  { id: 'dictionary', icon: '▦', label: 'Từ điển và tái sử dụng' },
  { id: 'audit', icon: '◎', label: 'Audit và bài học' },
];

function initials(s: string) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function SessionPicker({ current }: { current: string }) {
  const router = useRouter();
  const [items, setItems] = useState<SessionListItem[]>([]);
  useEffect(() => {
    api<SessionListItem[]>('/sessions')
      .then(setItems)
      .catch(() => setItems([]));
  }, [current]);
  return (
    <span className="session-picker">
      <label htmlFor="session-select" className="dim">
        Phiên
      </label>
      <select
        id="session-select"
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new') router.push('/sessions?new=1');
          else if (v === '__manage') router.push('/sessions');
          else router.push(`/s/${v}/line`);
        }}
      >
        <option value={EXAMPLE_SESSION_ID}>Default Example · Product Owner</option>
        {items.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.roleTitle}
          </option>
        ))}
        <option value="__new">＋ Tạo phiên JD mới…</option>
        <option value="__manage">Quản lý phiên…</option>
      </select>
    </span>
  );
}

export function Sidebar({ sessionId, tab }: { sessionId: string | null; tab: string }) {
  const sid = sessionId ?? EXAMPLE_SESSION_ID;
  return (
    <aside>
      <Link className="brand" href="/">
        ◈{' '}
        <span>
          COMPETENCE<span className="dim"> / LAB</span>
        </span>
      </Link>
      <div className="workspace">
        WORKSPACE <span className="pill">{sid === EXAMPLE_SESSION_ID ? 'SIMULATION' : 'LIVE'}</span>
      </div>
      <nav aria-label="Điều hướng chính">
        {TABS.map((t) => (
          <Link key={t.id} className={'nav' + (tab === t.id ? ' active' : '')} href={`/s/${sid}/${t.id}`} aria-current={tab === t.id ? 'page' : undefined}>
            {t.icon} &nbsp; {t.label}
          </Link>
        ))}
        <div className="nav-sep" />
        <Link className={'nav' + (tab === 'sessions' ? ' active' : '')} href="/sessions">
          ☰ &nbsp; Quản lý phiên
        </Link>
        <Link className={'nav' + (tab === 'transfer' ? ' active' : '')} href="/transfer">
          ⇅ &nbsp; Xuất và khôi phục
        </Link>
      </nav>
    </aside>
  );
}

export default function Shell({ tab, children }: { tab: string; children: React.ReactNode }) {
  const { sessionId, source, state, error, refresh, toast, toastText } = useSession();
  const guide = useGuide();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const isExample = source.mode === 'example';
  const pending = state?.pending ?? null;

  const reset = async () => {
    if (isExample) {
      if (!window.confirm('Đưa phiên mẫu về trạng thái ban đầu? Các phiên Live không bị ảnh hưởng.')) return;
      await source.reset();
      await refresh();
      toast('Đã đưa Default Example về ban đầu.');
    } else router.push(`/sessions?newRun=${sessionId}`);
  };

  const stepLabel = pending ? `◎ Tiếp tục ${pending.id}` : 'Tiến 1 bước →';
  const stepDisabled = !state || (!pending && (state.halted || state.completed)) || (state.mode === 'live' && state.aiReady?.ok === false && !pending);

  return (
    <>
      <Sidebar sessionId={sessionId} tab={tab} />
      <main>
        <header>
          <span>
            Competence Lab <span className="dim">/ {state?.roleTitle ?? '…'}</span>
          </span>
          <div>
            <SessionPicker current={sessionId} />
            <span className={'mode-pill ' + (isExample ? 'example' : 'live')}>{isExample ? 'EXAMPLE' : 'LIVE'}</span>
            <span className="head-progress" aria-label={`Tiến độ ${state?.position ?? 0}/9 block`}>
              {(state?.cards ?? []).filter((c) => c.id !== 'FAST').map((c) => (
                <i key={c.id} title={c.id} className={c.state === 'pass' ? 'done' : c.state === 'blocked' || c.state === 'error' ? 'blocked' : c.state === 'awaiting_view' || c.state === 'running' ? 'wait' : ''} />
              ))}
            </span>
            <button id="reset" className="reset-visible" onClick={reset}>
              ↶ Bắt đầu lại
            </button>{' '}
            <span className="status-dot" /> <span id="top-status">{state?.statusText ?? 'Đang tải'}</span> <span className="avatar">{initials(state?.roleTitle ?? 'CL')}</span>
          </div>
        </header>

        <section className="intro">
          <div>
            <div className="eyebrow">AI COMPETENCY PRODUCTION SYSTEM</div>
            <h1>
              Từ dữ liệu đến
              <br />
              <span>khung năng lực.</span>
            </h1>
            <p>
              Theo dõi từng quyết định. Kiểm tra từng bằng chứng.
              <br />
              Xem lần chạy tiếp theo học từ lần trước.
            </p>
          </div>
          <div className="run-card">
            <span className="dim">{isExample ? 'KỊCH BẢN ĐANG CHẠY' : 'PHIÊN ĐANG CHẠY'}</span>
            <h2>
              {state?.roleTitle ?? '…'}{' '}
              <span className="pill" id="run-label">
                {state?.runLabel ?? ''}
              </span>
            </h2>
            <div className="run-line">
              <span id="seed-summary">{state?.inputSummary}</span>
              <span id="version-label">{state?.dictionaryVersionLabel}</span>
            </div>
            <div className="progress">
              <i id="progress" style={{ width: `${((state?.position ?? 0) / 9) * 100}%` }} />
            </div>
            <div id="progress-label" className="dim">
              {state ? `${state.position}/9 block · ${state.statusText}` : ''}
            </div>
          </div>
        </section>

        <div className="notice">
          <span>◉</span>
          {isExample ? (
            <div>
              <b>Không có người thực hiện bên trong B0–B8.</b> Các agent và phép đánh giá đang được mô phỏng bằng dữ liệu seed tổng hợp. Kết quả “đạt” chỉ xác nhận luật mô phỏng, chưa chứng minh giá trị đánh giá nghề nghiệp.
            </div>
          ) : (
            <div>
              <b>Phiên Live.</b> Các bước cần phán đoán ngữ nghĩa do AI thực hiện qua Claude CLI; mọi phép đếm, công thức và cổng do code tính. “AI đã chạy thật” không có nghĩa bằng chứng nghề đã được kiểm chứng.
              {state?.aiReady && !state.aiReady.ok ? <div className="cl-warn">⚠ {state.aiReady.message}</div> : null}
            </div>
          )}
        </div>

        <div className="toolbar">
          <div className="controls">
            <button className="primary" id="step" disabled={stepDisabled} onClick={() => void guide.startNext()}>
              {stepLabel}
            </button>
            <button id="fast" disabled={!state?.fast.available || !!pending} onClick={() => void guide.startFast()} title={state?.fast.summary}>
              ↗ Giao bản thử nhanh
            </button>
          </div>
          <div className="controls">
            {state?.fault ? (
              <>
                <label htmlFor="fault">Thử sự cố</label>
                <select
                  id="fault"
                  value={state.fault.value}
                  disabled={state.fault.locked}
                  onChange={async (e) => {
                    await source.setFault?.(e.target.value);
                    await refresh();
                  }}
                >
                  {state.fault.options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {isExample ? (
              <button
                id="export"
                onClick={() => {
                  const ex = source as unknown as { exportAll?: () => unknown };
                  if (ex.exportAll) downloadJson('competence-lab-state.json', ex.exportAll());
                }}
              >
                ↓ Xuất toàn bộ dữ liệu JSON
              </button>
            ) : null}
          </div>
        </div>

        {pending && !guide.isOpen ? (
          <div id="guide-reminder" className="guide-reminder">
            <span>
              <b>{pending.id}</b> đang mở diễn tiến tính toán.
            </span>{' '}
            <button id="guide-reopen" onClick={() => guide.reopenPending()}>
              Mở lại {pending.id} →
            </button>
          </div>
        ) : null}

        {state?.halted ? (
          <div id="halt-banner" className="halt" role="alert">
            <b>⛔ STOP toàn Lab.</b> {state.haltReasons.join(' · ')}. Cả nhánh đầy đủ và nhánh nhanh đang bị khóa.
            <div className="cl-row" style={{ marginTop: 8 }}>
              <input aria-label="Lý do mở lại" placeholder="Lý do mở lại (bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: '1 1 240px', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', background: '#0f1520', color: 'var(--text)' }} />
              <button
                id="recover"
                disabled={!reason.trim()}
                onClick={async () => {
                  try {
                    await source.recover?.(reason.trim());
                    setReason('');
                    await refresh();
                    toast('Đã ghi quyết định mở lại kèm lý do. Block bị chặn sẽ chạy lại ở lần thử mới.');
                  } catch (e) {
                    toast(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Xác nhận sửa &amp; mở lại{isExample ? ' (giả lập)' : ''}
              </button>
            </div>
          </div>
        ) : null}

        <div id="toast" role="status">
          {error ? `Lỗi: ${error}` : toastText}
        </div>

        {children}

        <footer>
          <span>COMPETENCE LAB</span>
          <span>{isExample ? 'Seed tổng hợp · lưu trên trình duyệt của bạn · không dùng cho quyết định nhân sự' : 'Dữ liệu Live lưu trên máy chủ · bản nháp nội bộ · chưa phải bằng chứng nghề đã kiểm chứng'}</span>
        </footer>
      </main>
    </>
  );
}
