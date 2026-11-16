'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/live-source';
import { useSession } from '@/lib/session';

interface Item { item_id: string; entity: string; id: string; action: string; name: string; before: string | null; after: string | null; reason: string; affected: string[]; evidence_refs: string[] }
interface Cand {
  id: string;
  status: 'READY' | 'DECIDED' | 'COMMITTED';
  base_release_id: string | null;
  base_version_label: string;
  items: Item[];
  decision: { decision: string; reason: string; dropped_item_ids: string[]; decided_by: string; decided_at: string } | null;
  receipt: { release_id: string; version_label: string; hash: string; counts: { ADD: number; UPDATE: number; REUSE: number }; decided_by: string; decided_at: string } | null;
  stop: { reason: string } | null;
}
const ENTITY: Record<string, string> = { C: 'Năng lực', I: 'Chỉ báo', W: 'Nhiệm vụ của role', R: 'Khung', V: 'Bằng chứng' };

/** Live only: the B8 candidate ("Dự kiến") → decision with a reason → atomic commit → receipt ("Đã ghi"). */
export default function LiveReleasePanel() {
  const { sessionId, state, refresh, toast } = useSession();
  const [cand, setCand] = useState<Cand | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const b8 = state?.cards.find((c) => c.id === 'B8')?.state;
  const load = useCallback(async () => {
    try {
      const c = await api<Cand | null>(`/sessions/${sessionId}/candidate`);
      setCand(c);
      if (c?.decision) setDropped(c.decision.dropped_item_ids);
    } catch {
      setCand(null);
    }
  }, [sessionId]);
  useEffect(() => void load(), [load, b8, state?.completed, state?.halted]);
  if (!cand) return null;
  const main = cand.items.filter((i) => i.entity !== 'V');
  const evidenceCount = cand.items.filter((i) => i.entity === 'V').length;
  const publish = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api(`/candidates/${cand.id}/decision`, { method: 'POST', json: { decision: 'ACCEPT', dropped_item_ids: dropped, reason } });
      const r = await api<{ version_label: string }>(`/candidates/${cand.id}/commit`, { method: 'POST', json: { expected_base_release_id: cand.base_release_id } });
      toast(`Đã ghi release v${r.version_label} vào từ điển.`);
      await load();
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'ERROR', message: String(e) });
      await load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cl-card" id="live-release" data-testid="live-release" data-status={cand.status}>
      <div className="eyebrow">CÔNG BỐ TỪ ĐIỂN · B8</div>
      {cand.receipt ? (
        <>
          <h3><span className="cl-ok">ĐÃ GHI</span> · release v{cand.receipt.version_label}</h3>
          <p data-testid="receipt">Receipt: <span className="cl-mono">{cand.receipt.release_id}</span> · {cand.receipt.counts.ADD} ADD · {cand.receipt.counts.UPDATE} UPDATE · {cand.receipt.counts.REUSE} REUSE · hash <span className="cl-mono">{cand.receipt.hash.slice(0, 16)}…</span></p>
          <p className="dim">Quyết định bởi {cand.receipt.decided_by} lúc {new Date(cand.receipt.decided_at).toLocaleString('vi-VN')}. Lý do: {cand.decision?.reason}</p>
        </>
      ) : (
        <>
          <h3><span className="cl-warn">DỰ KIẾN</span> · chưa ghi vào từ điển <span className="dim">· nền v{cand.base_version_label}</span></h3>
          <p className="dim">Bỏ chọn mục không muốn công bố (chỉ báo và yêu cầu trong khung của năng lực đó cũng được bỏ theo). Mục "cần xem lại" không bao giờ vào release.</p>
        </>
      )}
      {cand.stop ? <p className="cl-warn" role="alert">⚠ Workspace đang STOP: {cand.stop.reason}. Không ghi được cho tới khi lesson được quyết định và workspace được mở lại.</p> : null}
      <div className="scroll-x">
        <table className="cl-table" data-testid="candidate-items">
          <thead><tr><th>Công bố</th><th>Loại</th><th>Mục</th><th>Hành động</th><th>Trước → Sau</th><th>Lý do · khung bị ảnh hưởng</th></tr></thead>
          <tbody>
            {main.map((i) => {
              const canDrop = i.entity === 'C' && i.action !== 'NEEDS_REVIEW' && !cand.receipt;
              return (
                <tr key={i.item_id} data-action={i.action}>
                  <td>{i.action === 'NEEDS_REVIEW' ? <span className="dim">không</span> : canDrop ? <input type="checkbox" aria-label={`Công bố ${i.name}`} checked={!dropped.includes(i.item_id)} onChange={(e) => setDropped((d) => (e.target.checked ? d.filter((x) => x !== i.item_id) : [...d, i.item_id]))} /> : dropped.includes(i.item_id) ? <span className="dim">đã bỏ</span> : '✓'}</td>
                  <td>{ENTITY[i.entity] ?? i.entity}</td>
                  <td>{i.name}</td>
                  <td><span className={'pill ' + i.action.toLowerCase()}>{i.action === 'NEEDS_REVIEW' ? 'CẦN XEM LẠI' : i.action}</span></td>
                  <td>{i.before ? <><span className="dim">{i.before}</span> → </> : null}{i.after}</td>
                  <td>{i.reason}{i.affected.length ? <div className="cl-warn">Ảnh hưởng: {i.affected.join('; ')}</div> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="dim">Kèm {evidenceCount} bản ghi bằng chứng (V) là các đoạn JD được trích.</p>
      {err ? <p className="cl-err" role="alert" data-testid="release-error"><b>{err.code}</b>: {err.message}</p> : null}
      {!cand.receipt ? (
        <div className="cl-row">
          <label className="cl-field" style={{ flex: 1 }}>Lý do quyết định (bắt buộc)
            <input id="release-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ví dụ: đã đọc hồ sơ và báo cáo kiểm toán, đồng ý công bố nội bộ" />
          </label>
          <button id="release-commit" className="primary" onClick={publish} disabled={busy || !reason.trim() || !!cand.stop}>Chấp nhận và ghi vào từ điển</button>
        </div>
      ) : null}
    </div>
  );
}
