'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DictFrame, DictFrameCompetency, DictView, SessionState } from '@cl/contract';
import { frameGraph } from '@cl/example';
import { downloadJson, useSession } from '@/lib/session';
import GraphView from '@/components/knowledge/GraphView';
import '@/components/knowledge/knowledge.css';

type Mode = 'map' | 'levels' | 'compare';
const MODES: [Mode, string][] = [
  ['map', 'Bản đồ nhiệm vụ'],
  ['levels', 'Bậc & thay đổi'],
  ['compare', 'So sánh hai phiên bản'],
];

const levelLabel = (l: number | null | undefined) => (l == null ? 'chưa xác định' : String(l));

/** Dictionary as it stood when this frame version was released (so old versions keep their own tasks and definitions). */
function snapshotFor(state: SessionState, frame: DictFrame | null): DictView {
  if (!frame) return state.dictionary;
  const hit = state.history.find((h) => h.after.R.some((r) => r.id === frame.id && r.version === frame.version));
  return hit?.after ?? state.dictionary;
}

function Levels({ frame, prev }: { frame: DictFrame; prev: DictFrame | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const picked = frame.competencies.find((c) => c.id === open) ?? null;
  const old = picked ? prev?.competencies.find((x) => x.id === picked.id) ?? null : null;
  return (
    <>
      <div className="level-note">
        THANG THỨ BẬC 1–5 · bậc yêu cầu trong R, không phải điểm năng lực cá nhân. Màu thể hiện phiên bản; không tính điểm tổng hợp.
        {prev && <> Ô xanh lục: bậc của phiên bản trước (v{prev.version}).</>}
      </div>
      <div className="level-bars">
        {frame.competencies.map((c) => {
          const o = prev?.competencies.find((x) => x.id === c.id);
          const note = !o && prev ? `Mới trong v${frame.version}` : o && o.level !== c.level ? `Yêu cầu ${levelLabel(o.level)} → ${levelLabel(c.level)}` : c.level == null ? 'Yêu cầu chưa xác định' : `Yêu cầu ${c.level}/5`;
          return (
            <button
              key={c.id}
              type="button"
              className={`level-item${open === c.id ? ' kg-selected' : ''}`}
              data-level-id={c.id}
              aria-expanded={open === c.id}
              onClick={() => setOpen(c.id)}
            >
              <div>
                <span>{c.id}</span>
                <strong>{c.name}</strong>
                <small>{note}</small>
              </div>
              <div className="ordinal-scale" role="img" aria-label={`Bậc yêu cầu ${levelLabel(c.level)} trên 5${o ? `, bản trước ${levelLabel(o.level)}` : ''}`}>
                {[1, 2, 3, 4, 5].map((k) => (
                  <span key={k} className={[c.level != null && k <= c.level ? 'filled' : '', o && o.level != null && k <= o.level ? 'previous' : ''].join(' ').trim()}>
                    {k}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <div id="level-detail" className="record" aria-live="polite">
        {!picked ? (
          'Chọn một năng lực để xem chỉ báo, căn cứ và thay đổi so với bản trước.'
        ) : (
          <>
            <h3>
              {picked.name} · R yêu cầu {picked.level == null ? 'chưa xác định' : `${picked.level}/5`}
            </h3>
            <div className="before-after">
              {old && (
                <div>
                  <div className="label">
                    TRƯỚC · v{prev!.version} · {old.level == null ? 'chưa xác định' : `${old.level}/5`}
                  </div>
                  <p>{old.indicator || 'Chưa có chỉ báo'}</p>
                </div>
              )}
              <div>
                <div className="label">CHỈ BÁO PHIÊN BẢN {frame.version}</div>
                <p>{picked.indicator || 'Bản nháp chưa có chỉ báo đã kiểm'}</p>
              </div>
            </div>
            <p className="muted-box">
              Căn cứ{frame.evidence === 'synthetic_only' ? ' seed' : ''}: {picked.evidence?.length ? picked.evidence.join(', ') : 'bản nháp'}.
              {old && <> Căn cứ bản trước: {old.evidence?.length ? old.evidence.join(', ') : 'không ghi'}.</>}
              {!old && prev && <> Năng lực này chưa có trong v{prev.version}.</>}
            </p>
          </>
        )}
      </div>
    </>
  );
}

interface CompareRow {
  id: string;
  name: string;
  a?: DictFrameCompetency;
  b?: DictFrameCompetency;
  tags: ('added' | 'removed' | 'level' | 'indicator' | 'same')[];
}
const TAG_LABEL: Record<CompareRow['tags'][number], string> = {
  added: 'Thêm mới',
  removed: 'Bị gỡ',
  level: 'Đổi bậc',
  indicator: 'Đổi chỉ báo',
  same: 'Giữ nguyên',
};

export function compareFrames(a: DictFrame, b: DictFrame): CompareRow[] {
  const ids = [...new Set([...a.competencies.map((c) => c.id), ...b.competencies.map((c) => c.id)])];
  return ids.map((id) => {
    const ca = a.competencies.find((c) => c.id === id);
    const cb = b.competencies.find((c) => c.id === id);
    const tags: CompareRow['tags'] = [];
    if (!ca && cb) tags.push('added');
    else if (ca && !cb) tags.push('removed');
    else if (ca && cb) {
      if (ca.level !== cb.level) tags.push('level');
      if ((ca.indicator ?? '') !== (cb.indicator ?? '')) tags.push('indicator');
      if (!tags.length) tags.push('same');
    }
    return { id, name: (cb ?? ca)!.name, a: ca, b: cb, tags };
  });
}

function Compare({ frames, current }: { frames: DictFrame[]; current: DictFrame }) {
  const idx = frames.findIndex((f) => f.version === current.version);
  const [va, setVa] = useState<string>('');
  const [vb, setVb] = useState<string>('');
  if (frames.length < 2) return <div className="empty">Cần ít nhất hai phiên bản khung đã phát hành để so sánh. Hoàn tất lượt tiếp theo để có phiên bản thứ hai.</div>;
  const defB = idx > 0 ? frames[idx] : frames[frames.length - 1];
  const defA = frames[Math.max(0, frames.indexOf(defB) - 1)];
  const a = frames.find((f) => f.version === va) ?? defA;
  const b = frames.find((f) => f.version === vb) ?? defB;
  const rows = compareFrames(a, b);
  const n = (t: CompareRow['tags'][number]) => rows.filter((r) => r.tags.includes(t)).length;
  const cell = (c?: DictFrameCompetency) => (c ? (c.level == null ? 'chưa xác định' : `${c.level}/5`) : '—');
  return (
    <>
      <div className="graph-filters">
        <label>
          Phiên bản A
          <select id="compare-a" value={a.version} onChange={(e) => setVa(e.target.value)}>
            {frames.map((f) => (
              <option key={f.version} value={f.version}>
                {f.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phiên bản B
          <select id="compare-b" value={b.version} onChange={(e) => setVb(e.target.value)}>
            {frames.map((f) => (
              <option key={f.version} value={f.version}>
                {f.version}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="cmp-summary">
        <span>
          <b>{n('added')}</b>thêm mới
        </span>
        <span>
          <b>{n('removed')}</b>bị gỡ
        </span>
        <span>
          <b>{n('level')}</b>đổi bậc
        </span>
        <span>
          <b>{n('indicator')}</b>đổi chỉ báo
        </span>
        <span>
          <b>{n('same')}</b>giữ nguyên
        </span>
      </div>
      {a.version === b.version && <p className="muted-box">Đang chọn cùng một phiên bản ở hai bên; chọn hai phiên bản khác nhau để thấy thay đổi.</p>}
      <div className="table-wrap scroll-x">
        <table className="cmp-table">
          <thead>
            <tr>
              <th>MÃ</th>
              <th>NĂNG LỰC</th>
              <th>THAY ĐỔI</th>
              <th>BẬC · v{a.version}</th>
              <th>BẬC · v{b.version}</th>
              <th>CHỈ BÁO · v{a.version}</th>
              <th>CHỈ BÁO · v{b.version}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-compare-id={r.id}>
                <td>{r.id}</td>
                <td>{r.name}</td>
                <td>
                  {r.tags.map((t) => (
                    <span key={t} className={`cmp-tag ${t}`}>
                      {TAG_LABEL[t]}
                    </span>
                  ))}
                </td>
                <td>{cell(r.a)}</td>
                <td>{cell(r.b)}</td>
                <td>{r.a ? r.a.indicator || 'Chưa có chỉ báo' : '—'}</td>
                <td>{r.b ? r.b.indicator || 'Chưa có chỉ báo' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted-box">Bậc và chỉ báo được đọc từ liên kết R của từng phiên bản; phiên bản cũ không bị ghi đè khi có phiên bản mới.</p>
    </>
  );
}

export default function FrameworkScreen() {
  const { state, source, sessionId, toast } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('map');
  const [version, setVersion] = useState('');

  const published = state?.dictionary.R ?? [];
  const trial = state?.trial ?? null;
  const usingTrial = published.length === 0 && !!trial;
  const frames = useMemo<DictFrame[]>(() => (published.length ? published : trial ? [{ ...trial, trial: true }] : []), [published, trial]);
  const frame = frames.find((f) => f.version === version) ?? frames[frames.length - 1] ?? null;
  const idx = frame ? frames.indexOf(frame) : -1;
  const prev = idx > 0 ? frames[idx - 1] : null;
  const snapshot = useMemo(() => (state ? snapshotFor(state, usingTrial ? null : frame) : null), [state, frame, usingTrial]);
  const graph = useMemo(() => (snapshot ? frameGraph(snapshot, frame) : null), [snapshot, frame]);

  if (!state) return null;
  const role = state.roleTitle || frame?.role || 'vị trí';
  const isTrial = usingTrial || !!frame?.trial;

  const exportFrame = () => {
    if (!frame) return;
    const name = `framework-${frame.version}.json`;
    try {
      if (isTrial) {
        // A trial frame is not a published version: export exactly what is shown, with its label.
        downloadJson(name, { ...frame, trial: true, note: 'Bản thử · chưa qua B4–B8' });
      } else if (source.mode === 'example') {
        const ex = source as unknown as { exportFrame?(v?: string): unknown };
        downloadJson(name, ex.exportFrame ? ex.exportFrame(frame.version) : frame);
      } else {
        const a = document.createElement('a');
        a.href = `/api/exports/framework?session=${encodeURIComponent(sessionId)}&version=${encodeURIComponent(frame.version)}`;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      toast(`Đã xuất khung phiên bản ${frame.version}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const note = !frame
    ? source.mode === 'example'
      ? 'Chưa có khung; chạy B8 hoặc giao bản thử nhanh.'
      : 'Chưa có khung; hoàn tất B8 hoặc giao bản thử nhanh trong Dây chuyền sản xuất.'
    : isTrial
      ? `Bản thử ${frame.version} · chưa qua B4–B8 · không phải phiên bản phát hành.`
      : `Phiên bản ${frame.version}${frame.evidence ? ' · ' + frame.evidence : ''} · khung yêu cầu công việc, không phải điểm cá nhân.`;

  const versionSelect = frames.length > 0 && (
    <label>
      Phiên bản
      <select
        id="frame-version"
        value={frame?.version ?? ''}
        onChange={(e) => setVersion(e.target.value)}
      >
        {frames.map((f) => (
          <option key={f.version} value={f.version}>
            {f.version}
            {f.trial ? ' (bản thử)' : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Khung năng lực {role}</h2>
          <p id="frame-note">{note}</p>
        </div>
        <button type="button" id="export-frame" disabled={!frame} onClick={exportFrame}>
          ↓ Xuất khung JSON
        </button>
      </div>

      {!frame ? (
        <div className="empty">
          Chưa có khung năng lực nào cho phiên này.
          <br />
          Khung xuất hiện sau khi B8 phát hành, hoặc sau khi giao bản thử nhanh (có nhãn “Bản thử”).
        </div>
      ) : (
        <div id="frame-content">
          <div className="visual-top">
            <div className="visual-switch" role="tablist" aria-label="Góc nhìn khung năng lực">
              {MODES.map(([m, label]) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} data-visual-mode={m} data-visual-scope="frame" className={mode === m ? 'chosen' : ''} onClick={() => setMode(m)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {isTrial && <div className="kg-trial">Bản thử · chưa qua B4–B8 — bậc và chỉ báo là bản nháp, chưa được thẩm định hay phát hành vào từ điển.</div>}

          {mode === 'map' && (
            <>
              <div className="frame-visual-heading">
                <div>
                  <span className="eyebrow">W → R → C</span>
                  <h3>
                    {role} <span className="pill">{isTrial ? 'Bản thử · chưa qua B4–B8' : 'v' + frame.version}</span>
                  </h3>
                  <p>Thấy nhiệm vụ được bao phủ bởi năng lực nào và hành vi cần quan sát. Mở một nút để xem căn cứ và lớp bằng chứng.</p>
                </div>
                {versionSelect}
              </div>
              {graph && (
                <GraphView
                  key={frame.version}
                  graph={graph}
                  prefix="frame"
                  emptyText="Chưa có quan hệ ở góc nhìn này."
                  onTrace={isTrial ? undefined : (cid) => router.push(`/s/${sessionId}/dictionary?dtab=trace&c=${encodeURIComponent(cid)}&v=${encodeURIComponent(frame.version)}`)}
                />
              )}
            </>
          )}

          {mode === 'levels' && (
            <>
              <div className="graph-filters">{versionSelect}</div>
              <Levels key={frame.version} frame={frame} prev={prev} />
            </>
          )}

          {mode === 'compare' && (isTrial ? <div className="empty">Bản thử chưa phát hành nên chưa có phiên bản để so sánh.</div> : <Compare frames={published} current={frame} />)}
        </div>
      )}
    </>
  );
}
