'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/live-source';
import type { CalcRows } from './format';

/** GSAP is served from /vendor (spec P2.4: no CDN). Loaded once on first use. */
type Gsap = { fromTo: (t: Element | Element[], from: object, to: object) => unknown; to: (t: Element | Element[], v: object) => unknown };
let gsapPromise: Promise<Gsap | null> | null = null;
function loadGsap(): Promise<Gsap | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const w = window as unknown as { gsap?: Gsap };
  if (w.gsap) return Promise.resolve(w.gsap);
  gsapPromise ??= new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = '/vendor/gsap.min.js';
    el.async = true;
    el.onload = () => resolve((window as unknown as { gsap?: Gsap }).gsap ?? null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  return gsapPromise;
}

const SUBSTEP_TEXT: Record<string, string> = {
  'B0.charter': 'Kiểm charter',
  'B0.independence': 'Kiểm cặp agent làm / kiểm',
  'B1.cut': 'Cắt phần không mô tả công việc',
  'B1.near_duplicate': 'JD trùng gần đúng',
  'B1.duplicate': 'Kiểm trùng',
  'B1.valid': 'JD hợp lệ',
  'B1.rank': 'Chấm A–E, lăng kính L, M, hạng',
  'B2.review': 'Duyệt cụm nhiệm vụ',
  'B2.weight': 'Trọng số nhiệm vụ',
  'B3.similarity': 'So với từ điển',
  'B3.dictionary_lookup': 'Dùng lại chắc chắn',
  'B3.evidence_weight': 'Trọng số bằng chứng',
  'B3.recode': 'Mã hóa kiểm chéo',
  'B5.long_tail': 'Cổng đuôi dài',
  'B5.seat_order': 'Thứ tự xáo của ghế',
  'B5.seat_vote': 'Phiếu của một ghế',
  'B5.keep': 'Quy tắc giữ',
  'B5.level': 'Bậc yêu cầu',
  'B5.coverage': 'Độ phủ nhiệm vụ',
  'B5.drop_one': 'Thử bỏ một',
  'B6.seat_controls': 'Mục kiểm tra của ghế',
  'B6.retranslation': 'Dịch ngược',
  'B6.fleiss': 'Fleiss κ xếp lớp',
  'B6.count': 'Số chỉ báo mỗi bậc',
  'B7.variable': 'Biến thẩm định',
  'B7.sample': 'Mẫu kiểm lại',
  'B8.tier': 'Tầng phát hành',
  'B8.review': 'Hạn rà soát',
};
const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * "Diễn biến dữ liệu": replays every calculation the run recorded, one data item at a time — formula, inputs,
 * result, decision — in record order. Every number shown comes from calc_record; nothing is typed in by hand.
 */
export default function DataFlow({ attemptId }: { attemptId: string }) {
  const [rows, setRows] = useState<CalcRows['rows']>([]);
  const [substeps, setSubsteps] = useState<CalcRows['substeps']>([]);
  const [sub, setSub] = useState('');
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const card = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void api<CalcRows>(`/attempts/${attemptId}/calc`).then((r) => {
      if (!alive) return;
      setRows(r.rows);
      setSubsteps(r.substeps);
      setI(0);
    });
    return () => {
      alive = false;
    };
  }, [attemptId]);
  const list = useMemo(() => rows.filter((r) => !sub || r.substep === sub), [rows, sub]);
  useEffect(() => setI(0), [sub]);
  const cur = list[Math.min(i, list.length - 1)];

  // one beat per row; the delay follows the speed (0.5×, 1×, 2×)
  useEffect(() => {
    if (!playing || !list.length) return;
    if (i >= list.length - 1) return setPlaying(false);
    const t = setTimeout(() => setI((x) => x + 1), 1200 / speed);
    return () => clearTimeout(t);
  }, [playing, i, list.length, speed]);
  useEffect(() => {
    if (!card.current) return;
    const el = card.current;
    void loadGsap().then((g) => {
      if (!g) return;
      g.fromTo([...el.querySelectorAll('[data-anim]')], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45 / speed, stagger: 0.12 / speed, ease: 'power2.out' });
      if (bar.current) g.to(bar.current, { width: `${list.length ? ((i + 1) / list.length) * 100 : 0}%`, duration: 0.3 / speed });
    });
  }, [cur, speed, i, list.length]);

  if (!rows.length) return <div className="lv-empty">Bước này chưa ghi bản ghi phép tính nào.</div>;
  const inputs = cur?.inputs && typeof cur.inputs === 'object' ? Object.entries(cur.inputs as Record<string, unknown>) : [];
  const outputs = cur?.output && typeof cur.output === 'object' ? Object.entries(cur.output as Record<string, unknown>) : cur?.output != null ? [['kết quả', cur.output] as [string, unknown]] : [];
  return (
    <div data-testid="data-flow">
      <div className="lv-row" style={{ marginBottom: 10 }}>
        <button className="lv-btn pri" onClick={() => (i >= list.length - 1 ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? 'Dừng' : 'Phát'}>
          {playing ? '⏸ Dừng' : '▶ Phát'}
        </button>
        <button className="lv-btn" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
          ◀
        </button>
        <button className="lv-btn" onClick={() => setI((x) => Math.min(list.length - 1, x + 1))} disabled={i >= list.length - 1}>
          ▶
        </button>
        <input type="range" min={0} max={Math.max(0, list.length - 1)} value={Math.min(i, list.length - 1)} onChange={(e) => setI(Number(e.target.value))} aria-label="Tua" style={{ flex: '1 1 160px' }} />
        <span className="lv-muted" style={{ fontSize: 12 }}>
          {Math.min(i + 1, list.length)}/{list.length}
        </span>
        <select aria-label="Tốc độ" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          <option value={0.5}>0,5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>
        <select aria-label="Chọn nhịp" value={sub} onChange={(e) => setSub(e.target.value)}>
          <option value="">Mọi phép tính</option>
          {substeps.map((x) => (
            <option key={x.substep} value={x.substep}>
              {SUBSTEP_TEXT[x.substep] ?? x.substep} ({x.n})
            </option>
          ))}
        </select>
      </div>
      <div className="lv-prog" style={{ marginBottom: 12 }}>
        <i ref={bar} style={{ width: 0 }} />
      </div>
      {cur ? (
        <div ref={card} className="lv-card" style={{ marginTop: 0 }} data-testid="flow-card">
          <div data-anim className="lv-row">
            <span className="lv-chip run">{SUBSTEP_TEXT[cur.substep] ?? cur.substep}</span>
            <b className="lv-mono">{cur.item_ref ?? ''}</b>
            {cur.seat ? <span className="lv-chip mute">ghế {cur.seat}</span> : null}
          </div>
          <div data-anim className="lv-mono" style={{ color: 'var(--accent)', margin: '10px 0' }}>
            {cur.formula}
          </div>
          <div className="lv-g3" style={{ gridTemplateColumns: 'minmax(0,1fr) 40px minmax(0,1fr)', alignItems: 'center' }}>
            <div data-anim className="lv-card" style={{ marginTop: 0 }}>
              <div className="lv-muted" style={{ fontSize: 11, marginBottom: 4 }}>VÀO</div>
              {inputs.length ? inputs.map(([k, v]) => (
                <div key={k} className="lv-mono">
                  {k} = {show(v)}
                </div>
              )) : <div className="lv-mono">—</div>}
            </div>
            <div data-anim style={{ textAlign: 'center', fontSize: 22 }}>
              →
            </div>
            <div data-anim className="lv-card" style={{ marginTop: 0 }}>
              <div className="lv-muted" style={{ fontSize: 11, marginBottom: 4 }}>RA</div>
              {outputs.length ? outputs.map(([k, v]) => (
                <div key={k} className="lv-mono" data-testid="flow-out">
                  {k} = {show(v)}
                </div>
              )) : <div className="lv-mono">—</div>}
            </div>
          </div>
          {cur.decision ? (
            <div data-anim style={{ marginTop: 10 }}>
              Quyết định: <b>{cur.decision}</b>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
