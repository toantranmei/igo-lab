'use client';
import { dayTime, dur, usd, type RunRow } from './format';

/** "Lịch sử lượt": every run of the session; opening one shows the Run screen read-only. */
export default function RunHistory({ runs, current, onOpen }: { runs: RunRow[]; current: string | null; onOpen: (id: string) => void }) {
  if (!runs.length) return <div className="lv-empty">Phiên chưa có lượt nào.</div>;
  return (
    <div className="lv-scroll">
      <table className="lv-table" data-testid="run-history">
        <thead>
          <tr>
            <th>Lượt</th>
            <th>Bắt đầu</th>
            <th>Bộ JD</th>
            <th>Từ điển nền</th>
            <th>Tiến độ</th>
            <th className="n">Thời gian</th>
            <th className="n">USD</th>
            <th>Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className={'click' + (r.id === current ? ' selr' : '')} onClick={() => onOpen(r.id)} data-run={r.run_no}>
              <td>{r.run_no}</td>
              <td className="lv-mono">{dayTime(r.started_at ?? r.created_at)}</td>
              <td>
                {r.jd_count} JD · bản {r.jd_set_revision}
              </td>
              <td>{r.base_version_label}</td>
              <td>
                <div className={'lv-prog' + (r.progress.done === r.progress.total ? ' ok' : '')} style={{ width: 90 }}>
                  <i style={{ width: `${(100 * r.progress.done) / r.progress.total}%` }} />
                </div>
              </td>
              <td className="n">{r.started_at && r.finished_at ? dur(Date.parse(r.finished_at) - Date.parse(r.started_at)) : r.running ? 'đang chạy' : '—'}</td>
              <td className="n">{usd(r.cost_usd)}</td>
              <td>
                <span className={'lv-chip ' + (r.running ? 'run' : r.stop_code === 'DONE' || r.status === 'COMPLETE' ? 'ok' : r.stop_code ? 'warn' : 'mute')}>{r.result}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
