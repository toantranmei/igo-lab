'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/live-source';
import { useSession } from '@/lib/session';

interface Row {
  framework_id: string;
  role_title: string;
  version_label: string;
  session_id: string | null;
  session_name: string | null;
  competency_id: string;
  competency: string;
  pinned: number;
  change: string[];
  bump: string | null;
  to_version: string | null;
  same_session: boolean;
}

/** P3.11 "Khung bị ảnh hưởng": frameworks pinning the old version; a review run is created only on request (Q4). */
export default function Affected() {
  const { sessionId, toast } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [made, setMade] = useState<Record<string, number>>({});
  useEffect(() => {
    api<Row[]>(`/sessions/${sessionId}/affected`).then(setRows).catch(() => setRows([]));
  }, [sessionId]);
  if (!rows) return <p className="lv-empty">Đang tải…</p>;
  if (!rows.length) return <p className="lv-empty" data-testid="affected-empty">Hồ sơ của lượt không đổi năng lực nào mà khung khác đang ghim.</p>;
  const review = async (r: Row) => {
    if (!r.session_id) return;
    if (!window.confirm(`Tạo lượt rà soát cho "${r.session_name ?? r.role_title}"? Lượt mới dùng bộ JD hiện tại của phiên đó và chưa chạy cho tới khi bấm Chạy.`)) return;
    try {
      const x = await api<{ run_no: number }>(`/sessions/${r.session_id}/runs`, { method: 'POST', json: { acknowledge_send: true } });
      setMade((m) => ({ ...m, [r.framework_id]: x.run_no }));
      toast(`Đã tạo lượt rà soát ${x.run_no} cho ${r.role_title}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="lv-scroll" data-testid="affected">
      <table className="lv-table">
        <thead>
          <tr>
            <th>Khung</th>
            <th>Năng lực đổi</th>
            <th>Ghim bản</th>
            <th>Thay đổi</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.framework_id + r.competency_id}>
              <td>
                {r.role_title} {r.version_label}
                {r.same_session ? <span className="lv-muted"> · khung của chính phiên này</span> : null}
              </td>
              <td>{r.competency}</td>
              <td className="lv-mono">@{r.pinned}</td>
              <td>
                {r.change.join(', ') || '—'}
                {r.bump ? ` · ${r.bump}` : ''}
                {r.to_version ? ` → ${r.to_version}` : ''}
              </td>
              <td>
                {r.same_session || !r.session_id ? null : made[r.framework_id] ? (
                  <Link href={`/s/${r.session_id}/run`}>Mở lượt {made[r.framework_id]} →</Link>
                ) : (
                  <button className="lv-btn" onClick={() => void review(r)}>
                    Tạo lượt rà soát
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
