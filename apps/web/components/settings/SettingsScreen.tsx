'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/live-source';
import { WorkspaceShell } from '@/components/shell/AppHeader';

type TaskModel = { model: string; effort: string };
type Config = { version: string; tasks: Record<string, TaskModel>; seats: { seat: string; model: string; effort: string; role: string }[] };
type Policy = { id: string; version: number; rigor?: string; min_valid_jd: number; min_p1?: number; min_coverage: number; min_item_agreement: number; min_kappa?: number; core_min?: number; core_max?: number; stop_on: string[]; thresholds_status: string };
type Settings = {
  agents: { C: Config; AB: Config };
  policies: Policy[];
  guard: { budget_factor: number; anomaly_input_tokens: number; anomaly_input_tokens_batch: number; batch_tasks: string[] };
  prices: Record<string, [number, number]>;
  ai_tool: { provider: string; channel: string; account_type: string; retention: string; no_training: boolean } | null;
  worker: { ok: boolean; message: string };
};
/** Tasks of the B0–B8 line, in order (T-tasks are kept for old runs and the dataset scan). */
const LINE = ['E1', 'E23', 'E4', 'E9', 'E5', 'E10', 'E6', 'E7', 'E8', 'T7', 'T14', 'T15'];
const short = (m: string) => m.replace('claude-', '');
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Shared settings of the workspace, read-only: what every session runs with. */
export default function SettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<Settings>('/settings').then(setS).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  return (
    <WorkspaceShell active="settings" title="Cài đặt" note="Cấu hình dùng chung cho mọi phiên. Mỗi lượt chạy khóa bản cấu hình của nó vào snapshot, nên thay đổi ở đây chỉ có hiệu lực từ lượt tạo sau.">
      <section className="tab active" id="settings">
        {err ? <p className="cl-err">{err}</p> : null}
        {!s ? <p className="dim">Đang tải…</p> : (
          <>
            <div className="lv-card" style={{ marginTop: 0 }}>
              <h4>Model và effort theo tác vụ</h4>
              <p className="dim">Mức C: E8 dùng Haiku (mức C không lên tầng thị trường). Mức A, B: E8 dùng Opus để thẩm định độc lập với mọi model đã làm (31). Ba ghế chấm và dịch ngược dùng chung một cấu hình.</p>
              <div className="scroll-x">
                <table className="cl-table" data-testid="settings-models">
                  <thead><tr><th>Tác vụ</th><th>Mức C ({s.agents.C.version})</th><th>Mức A, B ({s.agents.AB.version})</th></tr></thead>
                  <tbody>
                    {LINE.filter((k) => s.agents.C.tasks[k]).map((k) => (
                      <tr key={k}><td className="cl-mono">{k}</td><td>{short(s.agents.C.tasks[k].model)} · {s.agents.C.tasks[k].effort}</td><td className={s.agents.AB.tasks[k].model !== s.agents.C.tasks[k].model ? 'cl-ok' : ''}>{short(s.agents.AB.tasks[k].model)} · {s.agents.AB.tasks[k].effort}</td></tr>
                    ))}
                    {s.agents.C.seats.map((x) => <tr key={x.seat}><td className="cl-mono">{x.seat}</td><td colSpan={2}>{short(x.model)} · {x.effort} · <span className="dim">{x.role}</span></td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="lv-card">
              <h4>Bộ ngưỡng</h4>
              <div className="scroll-x">
                <table className="cl-table">
                  <thead><tr><th>Bộ</th><th>Mức</th><th>JD hợp lệ</th><th>JD P1</th><th>Lõi</th><th>Độ phủ</th><th>Đồng thuận chỉ báo</th><th>κ</th><th>Dừng khi</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {s.policies.map((p) => (
                      <tr key={p.id}><td className="cl-mono">{p.id}@{p.version}</td><td>{p.rigor ?? '—'}</td><td>≥ {p.min_valid_jd}</td><td>≥ {p.min_p1 ?? 0}</td><td>{p.core_min ?? '—'}–{p.core_max ?? '—'}</td><td>≥ {pct(p.min_coverage)}</td><td>≥ {pct(p.min_item_agreement)}</td><td>≥ {p.min_kappa ?? '—'}</td><td>{p.stop_on.join(', ')}</td><td className="dim">{p.thresholds_status}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="cl-grid2">
              <div className="lv-card">
                <h4>Ngân sách và chặn bất thường</h4>
                <ul>
                  <li>Trần của lượt và của từng bước: {s.guard.budget_factor} × ước tính.</li>
                  <li>Một lời gọi có đầu vào ước tính trên {s.guard.anomaly_input_tokens.toLocaleString('vi-VN')} token bị chặn trước khi gửi.</li>
                  <li>Tác vụ theo lô ({s.guard.batch_tasks.join(', ')}): ngưỡng {s.guard.anomaly_input_tokens_batch.toLocaleString('vi-VN')} token.</li>
                  <li>Vượt trần hoặc bất thường: lượt dừng, chỉ chạy tiếp khi có người "chấp nhận vượt".</li>
                </ul>
              </div>
              <div className="lv-card">
                <h4>Giá quy đổi (USD / triệu token)</h4>
                <table className="cl-table">
                  <thead><tr><th>Model</th><th>Vào</th><th>Ra</th></tr></thead>
                  <tbody>{Object.entries(s.prices).map(([m, [i, o]]) => <tr key={m}><td>{m}</td><td>{i}</td><td>{o}</td></tr>)}</tbody>
                </table>
                <p className="dim">Chạy qua Claude CLI theo gói đăng ký: USD là mức quy đổi để so hạn mức, không phải hóa đơn.</p>
              </div>
            </div>
            <div className="lv-card">
              <h4>Công cụ AI và worker</h4>
              {s.ai_tool ? <p>{s.ai_tool.provider} · {s.ai_tool.channel} · {s.ai_tool.account_type} · lưu trữ: {s.ai_tool.retention} · {s.ai_tool.no_training ? 'không dùng để huấn luyện' : 'có thể dùng để huấn luyện'}</p> : <p className="dim">Chưa có mục trong sổ công cụ AI.</p>}
              <p className={s.worker.ok ? 'cl-ok' : 'cl-warn'}>{s.worker.ok ? '✓' : '⚠'} {s.worker.message}</p>
            </div>
          </>
        )}
      </section>
    </WorkspaceShell>
  );
}
