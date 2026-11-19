'use client';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import AppHeader, { rememberSession } from './AppHeader';
import '@/components/run/run.css';

function WorkerChip() {
  const { state } = useSession();
  const ai = state?.aiReady;
  if (!ai) return null;
  const auto = state?.auto;
  const cls = !ai.ok ? 'bad' : auto?.on ? 'run' : 'ok';
  return (
    <span className={'lv-chip ' + cls} title={ai.message} data-testid="worker-chip">
      <span className="dot" />
      {!ai.ok ? 'Worker / Claude CLI chưa sẵn sàng' : auto?.on ? `Đang chạy${auto.running ? ` ${auto.running}` : ''}` : 'Worker sẵn sàng'}
    </span>
  );
}

/** Workspace STOP (critical finding): stays visible on every Live screen; reopening needs a reason. */
function HaltBanner() {
  const { state, source, refresh, toast } = useSession();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  if (!state?.halted) return null;
  return (
    <div id="halt-banner" className="lv-banner bad" role="alert">
      <span className="ic">⛔</span>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div className="t">Lượt bị chặn</div>
        <div className="small">{state.haltReasons.join(' · ')}</div>
        {state.haltReasons.some((r) => r.startsWith('STOP')) ? (
          <div className="lv-row" style={{ marginTop: 8 }}>
            <input aria-label="Lý do mở lại" placeholder="Lý do mở lại (bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: '1 1 240px', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', background: '#0f1520', color: 'var(--text)' }} />
            <button
              id="recover"
              className="lv-btn"
              disabled={!reason.trim()}
              onClick={async () => {
                setErr('');
                try {
                  await source.recover?.(reason.trim());
                  setReason('');
                  await refresh();
                  toast('Đã ghi quyết định mở lại kèm lý do.');
                } catch (e) {
                  // stays on screen: e.g. lessons tied to the STOP must be decided first
                  const msg = e instanceof Error ? e.message : String(e);
                  setErr((e as any)?.code === 'LESSON_PENDING' ? `${msg} Mở Kết quả › Thẩm định và bài học để quyết từng lesson.` : msg);
                }
              }}
            >
              Xác nhận sửa &amp; mở lại
            </button>
          </div>
        ) : null}
        {err ? <div className="small" role="alert" id="recover-error" style={{ marginTop: 6, color: '#ffb4b4' }}>{err}</div> : null}
      </div>
    </div>
  );
}

export default function LiveShell({ tab, children }: { tab: string; children: React.ReactNode }) {
  const { sessionId, state, error, toastText } = useSession();
  // the floating toast fades after a few seconds; errors stay
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (sessionId && sessionId !== 'example') rememberSession(sessionId);
  }, [sessionId]);
  useEffect(() => {
    setShown(toastText);
    if (!toastText) return;
    const t = setTimeout(() => setShown(''), 6000);
    return () => clearTimeout(t);
  }, [toastText]);
  return (
    <div className="lv-shell">
      <AppHeader sessionId={sessionId} active={tab} status={<WorkerChip />} />
      <div className="lv-body" role="main">
        {state?.aiReady && !state.aiReady.ok ? <div className="cl-warn" style={{ marginBottom: 10 }}>⚠ {state.aiReady.message}</div> : null}
        <HaltBanner />
        {children}
      </div>
      <div className="lv-foot">
        <span>COMPETENCE LAB · {state?.roleTitle ?? ''}</span>
        <span>Dữ liệu Live lưu trên máy chủ · bản nháp nội bộ · chưa phải bằng chứng nghề đã kiểm chứng</span>
      </div>
      <div id="toast" className="lv-toast" role="status">
        {error ? `Lỗi: ${error}` : shown}
      </div>
    </div>
  );
}
