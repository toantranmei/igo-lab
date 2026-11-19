'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/live-source';

interface ReleaseRow {
  release_id: string;
  seq: number;
  version_label: string;
  parent_release_id: string | null;
  decided_by: string;
  decided_at: string;
  counts: { ADD: number; UPDATE: number; REUSE: number };
  notes: string | null;
  changes: { entity: string; id: string; name?: string; action: string; change_types?: string[]; bump?: string; from_version?: string; to_version?: string; affected?: string[] }[];
  receipt_hash: string;
  reverts: string | null;
  origin: string;
}

/** P3.12 "Bản phát hành": version line, generated notes, changes with their type and bump, revert (a new release). */
export default function Releases({ live, onChanged }: { live: boolean; onChanged?: () => void }) {
  const [rows, setRows] = useState<ReleaseRow[] | null>(null);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState<Record<string, string>>({});
  const load = () => api<ReleaseRow[]>('/releases').then((r) => setRows([...r].reverse())).catch((e) => setErr(String(e?.message ?? e)));
  useEffect(() => {
    if (live) void load();
  }, [live]);
  if (!live) return <div className="empty">Bản phát hành chỉ có ở phiên Live.</div>;
  if (!rows) return <div className="empty">{err || 'Đang tải…'}</div>;
  if (!rows.length) return <div className="empty">Chưa có bản phát hành nào.</div>;
  const revert = async (r: ReleaseRow) => {
    try {
      await api(`/releases/${r.release_id}/revert`, { method: 'POST', json: { reason: reason[r.release_id] } });
      setReason((x) => ({ ...x, [r.release_id]: '' }));
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div data-testid="releases">
      {err ? <div className="cl-err">{err}</div> : null}
      {rows.map((r, i) => (
        <div key={r.release_id} className="cl-card" data-release={r.version_label}>
          <div className="cl-row">
            <b>Bản {r.version_label}</b>
            {i === 0 ? <span className="pill add">hiện hành</span> : null}
            {r.origin === 'REVERT' ? <span className="pill update">khôi phục</span> : null}
            <span className="dim">
              {new Date(r.decided_at).toLocaleString('vi-VN')} · {r.decided_by} · biên nhận {r.receipt_hash.slice(0, 12)}
            </span>
          </div>
          {r.notes ? <p data-testid="release-notes">{r.notes}</p> : null}
          {r.changes.some((c) => c.entity === 'C') ? <UpdateNet changes={r.changes.filter((c) => c.entity === 'C')} parent={rows.find((x) => x.release_id === r.parent_release_id)?.version_label ?? '0.0.0'} label={r.version_label} /> : null}
          {r.changes.length ? (
            <div className="scroll-x">
              <table className="cl-table">
                <tbody>
                  {r.changes.map((c) => (
                    <tr key={c.entity + c.id + c.action}>
                      <td>{c.entity}</td>
                      <td>{c.name ?? c.id}</td>
                      <td>{c.action}</td>
                      <td className="cl-mono">{c.from_version ? `${c.from_version} → ` : ''}{c.to_version ?? ''}</td>
                      <td>{c.change_types?.length ? `${c.change_types.join(', ')} · ${c.bump}` : ''}</td>
                      <td className="cl-warn">{c.affected?.length ? `Khung ghim bản cũ: ${c.affected.join('; ')}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {i > 0 || rows.length === 1 ? null : (
            <div className="cl-row" style={{ marginTop: 8 }}>
              <input aria-label={`Lý do khôi phục ${r.version_label}`} placeholder="Lý do khôi phục về nội dung trước bản này" value={reason[r.release_id] ?? ''} onChange={(e) => setReason((x) => ({ ...x, [r.release_id]: e.target.value }))} style={{ flex: '1 1 240px', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', background: '#0f1520', color: 'var(--text)' }} />
              <button disabled={!reason[r.release_id]?.trim()} onClick={() => void revert(r)}>
                Khôi phục (tạo bản mới)
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** P3.12 network update between a release and its parent: one node per competency touched. */
function UpdateNet({ changes, parent, label }: { changes: ReleaseRow['changes']; parent: string; label: string }) {
  const style = (c: ReleaseRow['changes'][number]): React.CSSProperties =>
    c.action === 'ADD'
      ? { border: '2px solid #2f9e6b', background: '#2f9e6b33', fontWeight: 700 }
      : c.action === 'DEPRECATE'
        ? { border: '1px dashed var(--line)', opacity: 0.5 }
        : c.bump === 'MAJOR'
          ? { border: '2px solid #ef8f8f' }
          : c.action === 'UPDATE'
            ? { border: '2px solid var(--orange)' }
            : { border: '1px solid var(--line)' };
  return (
    <div data-testid="update-net" style={{ margin: '10px 0' }}>
      <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
        Mạng cập nhật {parent} → {label}: xanh đậm = mới · viền cam = MINOR/PATCH · viền đỏ = MAJOR (tách khỏi bản cũ) · mờ nét đứt = ngừng dùng
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {changes.map((c) => (
          <div key={c.id + c.action} data-net={c.action === 'UPDATE' ? c.bump : c.action} style={{ ...style(c), borderRadius: 10, padding: '6px 10px', fontSize: 12, maxWidth: 260 }}>
            <div>{c.name ?? c.id}</div>
            <div className="dim" style={{ fontSize: 11 }}>
              {c.action === 'REUSE' ? 'dùng lại' : c.from_version ? `${c.from_version} → ${c.to_version}` : c.to_version ?? c.action}
            </div>
            {c.affected?.length ? <div style={{ fontSize: 11, color: 'var(--orange)', borderTop: '1px dashed var(--orange)', marginTop: 4, paddingTop: 2 }}>ghim bản cũ: {c.affected.join('; ')}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
