'use client';
import { useEffect, useState } from 'react';
import type { BlockCard } from '@cl/contract';

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
/** What a computing block is doing: one bar per agent step, elapsed time, and how long since the last sign of life. */
export default function BlockProgressView({ progress, compact }: { progress: NonNullable<BlockCard['progress']>; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - new Date(progress.started_at).getTime());
  const idle = Math.max(0, now - new Date(progress.updated_at).getTime());
  const steps = compact ? progress.steps.slice(-2) : progress.steps;
  return (
    <div className={'block-progress' + (compact ? ' compact' : '')} data-testid="block-progress" role="status">
      {steps.map((s) => {
        const finished = s.done + s.failed >= s.total;
        return (
          <div key={s.task_id} className={'bp-step' + (finished ? ' done' : ' live')}>
            <div className="bp-head">
              <span>{finished ? '✓' : '⟳'} {compact ? s.task_id.split('.')[0] : `${s.task_id} · ${s.title}`}{compact ? '' : ` · ${s.model}`}</span>
              <b>{s.done}/{s.total}</b>
            </div>
            <div className="bp-bar"><i style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} /></div>
            {!compact && (s.cached || s.failed) ? <small>{s.cached ? `${s.cached} lấy từ kết quả đã lưu` : ''}{s.cached && s.failed ? ' · ' : ''}{s.failed ? `${s.failed} lỗi` : ''}</small> : null}
          </div>
        );
      })}
      {!progress.steps.length ? <div className="bp-head"><span>⟳ Code đang xử lý, chưa tới bước gọi AI</span></div> : null}
      <small className={idle > 120000 ? 'cl-warn' : 'dim'}>
        Đã chạy {clock(elapsed)} · tín hiệu gần nhất {Math.round(idle / 1000)} giây trước{idle > 120000 ? ' — lâu bất thường, kiểm tra worker' : ''}
      </small>
    </div>
  );
}
