'use client';
import Link from 'next/link';
import type { RunStop, StopAction } from '@cl/contract';
import { hhmm } from './format';

const LOOK: Record<RunStop['code'], { cls: string; ic: string; title: (s: RunStop) => string }> = {
  QUOTA: { cls: 'warn', ic: '!', title: (s) => `Dừng ở ${s.block ?? '—'} · hết hạn mức của Claude CLI` },
  GATE: { cls: 'bad', ic: '⊘', title: (s) => `Dừng ở ${s.block ?? '—'} · cổng chặn` },
  AI_ERROR: { cls: 'bad', ic: '✕', title: (s) => `Dừng ở ${s.block ?? '—'} · lỗi khi gọi AI` },
  PAUSED: { cls: 'run', ic: '⏸', title: (s) => `Tạm dừng theo yêu cầu${s.block ? ` · trước khi xong ${s.block}` : ''}` },
  BUDGET: { cls: 'warn', ic: '$', title: (s) => `Dừng ở ${s.block ?? '—'} · vượt ngân sách token` },
  ANOMALY: { cls: 'warn', ic: '?', title: (s) => `Dừng ở ${s.block ?? '—'} · bất thường, chờ xác nhận` },
  DONE: { cls: 'ok', ic: '✓', title: () => 'Đã tới B8 · hồ sơ dự kiến chờ duyệt' },
};
const LABEL: Record<StopAction, string> = { RESUME: 'Chạy tiếp', SCHEDULE: 'Hẹn giờ chạy', RETRY: 'Thử lại', ACCEPT_OVER: 'Chạy tiếp, chấp nhận vượt', OPEN_STEP: 'Xem bước', REVIEW_CANDIDATE: 'Xem kết quả và duyệt', NEW_RUN: 'Sửa đầu vào' };

/** One banner per stop code (spec P0.12): the reason in words and the main action. */
export default function StopBanner({ stop, sessionId, readOnly, busy, onAction }: { stop: RunStop; sessionId: string; readOnly: boolean; busy: boolean; onAction: (a: StopAction) => void }) {
  const look = LOOK[stop.code];
  const scheduled = stop.scheduled_for ? `Đã hẹn chạy tiếp lúc ${hhmm(stop.scheduled_for)}.` : '';
  const actions = stop.actions.filter((a) => !(a === 'SCHEDULE' && stop.scheduled_for));
  return (
    <div className={`lv-banner ${look.cls}`} role="alert" data-testid="stop-banner" data-stop={stop.code}>
      <span className="ic" aria-hidden>
        {look.ic}
      </span>
      <div style={{ minWidth: 0, flex: '1 1 320px' }}>
        <div className="t">{look.title(stop)}</div>
        <div className="small">
          {stop.message} {scheduled}
        </div>
        {stop.code === 'ANOMALY' && stop.details && 'estimated_tokens' in stop.details ? <div className="small">Lời gọi ước ≈ {Number(stop.details.estimated_tokens).toLocaleString('vi-VN')} token, ngưỡng {Number(stop.details.limit).toLocaleString('vi-VN')}. Chấp nhận vượt chỉ áp cho lần chạy kế tiếp của bước này và được ghi tên người xác nhận.</div> : null}
      </div>
      <div className="acts">
        {actions.map((a, i) => {
          if (a === 'REVIEW_CANDIDATE')
            return (
              <Link key={a} className="lv-btn pri" href={`/s/${sessionId}/results`}>
                {LABEL[a]}
              </Link>
            );
          if (a === 'NEW_RUN')
            return (
              <Link key={a} className="lv-btn" href={`/s/${sessionId}/inputs`}>
                {LABEL[a]}
              </Link>
            );
          const runAction = a !== 'OPEN_STEP';
          return (
            <button key={a} className={'lv-btn' + (i === 0 || a === 'RESUME' ? ' pri' : '')} disabled={busy || (runAction && readOnly)} data-action={a} onClick={() => onAction(a)}>
              {a === 'SCHEDULE' && stop.until ? `Hẹn chạy lúc ${hhmm(stop.until)}` : LABEL[a]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
