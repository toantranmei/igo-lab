'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { KEdge, KGraph, KNode } from '@cl/example';
import './knowledge.css';

export interface GraphViewProps {
  graph: KGraph;
  /** Unique per graph on the page (used for the SVG marker and panel ids). */
  prefix: string;
  emptyText?: string;
  /** When given, C nodes / R→C edges get a "Truy nguồn năng lực này →" action. */
  onTrace?(competencyId: string): void;
  /** Extra link shown in the inspector for a node (e.g. the exact input record of a source). */
  nodeLink?(node: KNode): { href: string; label: string } | null;
}

const KIND_LABEL: Record<string, string> = {
  C: 'C · Khái niệm dùng chung',
  W: 'W · Nghề / nhiệm vụ',
  R: 'R · Yêu cầu có bối cảnh',
  V: 'V · Bằng chứng',
  I: 'Chỉ báo hành vi',
  B: 'Hoạt động của agent',
};

const isEdge = (x: KNode | KEdge): x is KEdge => 'from' in x;
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null);
const list = (v: unknown): string[] | null => (Array.isArray(v) ? v.map((x) => String(x)) : null);

function entriesOf(item: KNode | KEdge): [string, string][] {
  const d = item.detail || {};
  const out: [string, string][] = [];
  if (isEdge(item)) out.push(['QUAN HỆ', item.label], ['TỪ → ĐẾN', `${item.from} → ${item.to}`]);
  else out.push(['LOẠI THỰC THỂ', KIND_LABEL[item.kind] || item.kind]);
  if (typeof d.level === 'number') out.push(['BẬC YÊU CẦU TRONG R', `${d.level}/5 · không phải điểm của cá nhân`]);
  else if ('level' in d && d.level == null) out.push(['BẬC YÊU CẦU TRONG R', 'chưa xác định']);
  const version = text(d.frameVersion) ?? text(d.version);
  if (version) out.push(['PHIÊN BẢN', version]);
  const definition = text(d.definition) ?? text(d.sharedDefinition);
  if (definition) out.push(['ĐỊNH NGHĨA CHUNG', definition]);
  const indicator = text(d.text) ?? text(d.indicator);
  if (indicator) out.push(['CHỈ BÁO / NỘI DUNG', indicator]);
  const usedBy = list(d.usedBy);
  if (usedBy) out.push(['ĐƯỢC TÁI SỬ DỤNG BỞI', usedBy.length ? usedBy.join(' · ') : 'Chưa có khung phát hành tham chiếu']);
  const evidence = list(d.evidence);
  if (evidence) out.push(['CĂN CỨ', evidence.length ? evidence.join(' · ') : 'Chưa có căn cứ được ghi']);
  else if (text(d.evidence)) out.push(['LỚP BẰNG CHỨNG', text(d.evidence)!]);
  if (text(d.evidenceClass)) out.push(['LỚP BẰNG CHỨNG', text(d.evidenceClass)!]);
  const ratings = list(d.ratings);
  if (ratings) out.push(['RATING', ratings.join(' · ')]);
  if (text(d.source)) out.push(['NGUỒN', text(d.source)!]);
  if (text(d.action)) out.push(['HÀNH VI', text(d.action)!]);
  if (text(d.formula)) out.push(['CÔNG THỨC', text(d.formula)!]);
  if (text(d.creator)) out.push(['AGENT / BƯỚC', text(d.creator)!]);
  if (text(d.note)) out.push(['DIỄN GIẢI', text(d.note)!]);
  const steps = list(d.steps);
  if (steps) out.push(['CÁC BƯỚC', steps.join(' → ')]);
  return out;
}

function Inspector({
  item,
  graph,
  pick,
  onTrace,
  nodeLink,
}: {
  item: KNode | KEdge | null;
  graph: KGraph;
  pick(id: string): void;
  onTrace?: (cid: string) => void;
  nodeLink?: GraphViewProps['nodeLink'];
}) {
  if (!item)
    return (
      <div className="graph-detail-empty">
        ↖ Chọn một nút hoặc đường nối
        <div>Xem ý nghĩa, căn cứ, bậc yêu cầu và phiên bản liên quan.</div>
      </div>
    );
  const edge = isEdge(item);
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const connections = edge ? [] : graph.edges.filter((e) => e.from === item.id || e.to === item.id);
  const comp = !edge && item.id.startsWith('C:') ? item.id.slice(2) : text(item.detail?.competency);
  const link = !edge && nodeLink ? nodeLink(item) : null;
  return (
    <>
      <span className="eyebrow">{edge ? 'RELATION INSPECTOR' : 'KNOWLEDGE INSPECTOR'}</span>
      <h3>{item.label}</h3>
      {entriesOf(item).map(([k, v], i) => (
        <div key={k + i}>
          <div className="label">{k}</div>
          <p>{v}</p>
        </div>
      ))}
      {link && (
        <Link className="trace-action kg-link" href={link.href}>
          {link.label}
        </Link>
      )}
      {connections.length > 0 && (
        <>
          <div className="label">{connections.length} LIÊN KẾT</div>
          {connections.map((e) => (
            <button key={e.id} type="button" className="connection" data-pick-edge={e.id} onClick={() => pick(e.id)}>
              {e.label} → {labelOf(e.from === item.id ? e.to : e.from)}
            </button>
          ))}
        </>
      )}
      {comp && onTrace && (
        <button type="button" className="trace-action" data-trace-comp={comp} onClick={() => onTrace(comp)}>
          Truy nguồn năng lực này →
        </button>
      )}
      <details>
        <summary>Bản ghi gốc</summary>
        <pre>{JSON.stringify(item.detail ?? {}, null, 2)}</pre>
      </details>
    </>
  );
}

export function GraphLegend() {
  return (
    <div className="graph-legend">
      <span className="k-W">● Vị trí / nhiệm vụ</span>
      <span className="k-R">● Liên kết yêu cầu R</span>
      <span className="k-C">● Năng lực dùng chung</span>
      <span className="k-I">● Chỉ báo</span>
      <span className="k-V">● Bằng chứng V</span>
    </div>
  );
}

/** Layered graph: node buttons over an SVG of directed Bézier edges, with an inspector. */
export default function GraphView({ graph, prefix, emptyText, onTrace, nodeLink }: GraphViewProps) {
  const [picked, setPicked] = useState<string | null>(null);

  const layout = useMemo(() => {
    const cols = graph.columns.length;
    const step = cols === 4 ? 225 : 265;
    const width = Math.max(780, cols * step + 30);
    const rowStep = 116;
    const height = Math.max(400, graph.rows * rowStep + 85);
    const w = step - 35;
    const h = 86;
    const pos = new Map(graph.nodes.map((n) => [n.id, { x: 20 + n.col * step, y: 65 + n.row * rowStep }]));
    return { step, width, height, w, h, pos };
  }, [graph]);

  // A selection that no longer exists in this graph (version/competency changed) is dropped.
  const selected = picked && (graph.nodes.some((n) => n.id === picked) || graph.edges.some((e) => e.id === picked)) ? picked : null;

  const near = useMemo(() => {
    const s = new Set<string>();
    if (!selected) return s;
    s.add(selected);
    for (const e of graph.edges)
      if (e.id === selected || e.from === selected || e.to === selected) {
        s.add(e.id);
        s.add(e.from);
        s.add(e.to);
      }
    return s;
  }, [graph, selected]);

  if (!graph.nodes.length) return <div className="empty">{emptyText ?? 'Chưa có quan hệ ở góc nhìn này. Chạy đến B8 hoặc chọn “Xem mẫu đủ 2 lượt”.'}</div>;

  const { step, width, height, w, h, pos } = layout;
  const item = graph.nodes.find((n) => n.id === selected) ?? graph.edges.find((e) => e.id === selected) ?? null;
  const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

  return (
    <div className="knowledge-layout">
      <div>
        <div className="graph-scroll scroll-x" tabIndex={0} role="group" aria-label="Sơ đồ quan hệ, cuộn ngang để xem đủ các lớp">
          <div className="graph-canvas" style={{ width, height }}>
            {graph.columns.map((c, i) => (
              <div key={i} className="graph-column" style={{ left: 20 + i * step, width: w }}>
                {c}
              </div>
            ))}
            <svg className="network-svg" width={width} height={height} aria-label="Các quan hệ có hướng">
              <defs>
                <marker id={`${prefix}-arrow`} markerWidth={7} markerHeight={7} refX={6} refY={3.5} orient="auto">
                  <path d="M0 0 L7 3.5 L0 7 Z" fill="currentColor" />
                </marker>
              </defs>
              {graph.edges.map((e) => {
                const a = pos.get(e.from);
                const b = pos.get(e.to);
                if (!a || !b) return null;
                const x = a.x + w;
                const y = a.y + h / 2;
                const x2 = b.x;
                const y2 = b.y + h / 2;
                const c = (x + x2) / 2;
                const path = `M${x},${y} C${c},${y} ${c},${y2} ${x2},${y2}`;
                return (
                  <g key={e.id} className={cls('graph-edge', selected === e.id && 'picked', selected && !near.has(e.id) && 'faded')}>
                    <path d={path} markerEnd={`url(#${prefix}-arrow)`} />
                    <path
                      className="edge-hit"
                      d={path}
                      data-edge={e.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected === e.id}
                      aria-label={`${e.from} ${e.label} ${e.to}`}
                      onClick={() => setPicked(e.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setPicked(e.id);
                        }
                      }}
                    >
                      <title>{e.label}</title>
                    </path>
                    {Math.abs(y - y2) < 10 && (
                      <text x={c} y={y - 8} textAnchor="middle">
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {graph.nodes.map((n) => {
              const p = pos.get(n.id)!;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={cls('graph-node', `k-${n.kind}`, selected === n.id && 'picked', selected && !near.has(n.id) && 'faded')}
                  data-node={n.id}
                  aria-pressed={selected === n.id}
                  style={{ left: p.x, top: p.y, width: w, height: h }}
                  onClick={() => setPicked(n.id)}
                >
                  <span>
                    {n.kind} <small>{n.sub}</small>
                  </span>
                  <strong>{n.label}</strong>
                </button>
              );
            })}
          </div>
        </div>
        <GraphLegend />
        <div className="graph-help">
          <button type="button" data-clear-selection onClick={() => setPicked(null)} disabled={!selected}>
            Hiện toàn mạng
          </button>{' '}
          Đường nối có hướng và ý nghĩa · chọn nút để làm nổi các quan hệ · cuộn ngang trên màn hình nhỏ.
        </div>
      </div>
      <div className="graph-inspector" id={`${prefix}-detail`} aria-live="polite">
        <Inspector item={item} graph={graph} pick={setPicked} onTrace={onTrace} nodeLink={nodeLink} />
      </div>
    </div>
  );
}
