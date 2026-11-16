'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { GraphEdge, GraphModel, GraphNode } from '@cl/example';
import { layoutEgo, layoutFull } from './layout2d';
import { pickedNodeId, type CatLookup, type CatPick, type FocusSets } from './model';

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];

interface Props {
  graph: GraphModel;
  lk: CatLookup;
  mode: 'full' | 'ego';
  /** Competency the ego view is centred on. */
  cid: string;
  pick: CatPick;
  focus: FocusSets | null;
  onNode(node: GraphNode): void;
  onEdge(edge: GraphEdge): void;
}

export default function Network2D({ graph, lk, mode, cid, pick, focus, onNode, onEdge }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoomIndex, setZoomIndex] = useState(3);
  const [labels, setLabels] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const zoom = ZOOMS[zoomIndex] ?? 1;

  const layout = useMemo(() => (mode === 'full' ? layoutFull(graph, lk) : layoutEgo(graph, cid, lk)), [graph, lk, mode, cid]);
  const lit = mode === 'full' ? focus : null;
  const selectedId = pickedNodeId(pick);
  const competencyCount = useMemo(() => graph.nodes.filter((n) => n.kind === 'competency').length, [graph]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === stageRef.current && !!stageRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else el.requestFullscreen?.()?.catch(() => {});
  };

  const edgeKey = (e: KeyboardEvent<SVGPathElement>, edge: GraphEdge) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEdge(edge);
    }
  };

  const nodeName = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const markerId = mode === 'full' ? 'cat-all-arrow' : 'cat-arrow';
  const countLine =
    mode === 'full'
      ? `${graph.nodes.length} nút · ${graph.edges.length} quan hệ · tất cả ${competencyCount} năng lực trong bộ lọc`
      : `${layout.nodes.length} nút · ${layout.edges.length} quan hệ · vùng lân cận của ${lk.comp(cid).name} (toàn mạng: ${graph.nodes.length} nút · ${graph.edges.length} quan hệ)`;

  return (
    <div
      className="catalog-2d"
      ref={stageRef}
      data-node-count={graph.nodes.length}
      data-edge-count={graph.edges.length}
      data-visible-node-count={layout.nodes.length}
      data-visible-edge-count={layout.edges.length}
      data-mode={mode}
    >
      <div className="catalog-2d-toolbar">
        <span className="all-network-count">{countLine}</span>
        <div>
          <button type="button" data-cat-zoom="out" aria-label="Thu nhỏ" disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}>
            −
          </button>
          <span className="catalog-2d-zoom" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" data-cat-zoom="in" aria-label="Phóng to" disabled={zoomIndex === ZOOMS.length - 1} onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}>
            +
          </button>
          <button type="button" data-cat-zoom="reset" onClick={() => setZoomIndex(3)}>
            100%
          </button>
          <button type="button" data-cat-labels aria-pressed={labels} onClick={() => setLabels((v) => !v)}>
            Nhãn trọng số
          </button>
          <button type="button" data-cat-fullscreen aria-pressed={fullscreen} onClick={toggleFullscreen}>
            {fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
          </button>
        </div>
      </div>

      {layout.nodes.length === 0 ? (
        <p className="muted-box catalog-empty">Năng lực đang chọn không có vai trò nào yêu cầu trong bộ lọc hiện tại.</p>
      ) : (
        <div className="catalog-graph-scroll" tabIndex={0} aria-label={mode === 'full' ? 'Toàn mạng nhiều năng lực' : 'Network họ nghề, vai trò và năng lực'}>
          <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
            <div className="catalog-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
              {layout.cols.map((c) => (
                <div key={c.left} className="catalog-col" style={{ left: c.left }}>
                  {c.text}
                </div>
              ))}
              <svg className="catalog-svg" width={layout.width} height={layout.height}>
                <defs>
                  <marker id={markerId} markerWidth={mode === 'full' ? 5 : 6} markerHeight={mode === 'full' ? 5 : 6} refX={mode === 'full' ? 4 : 5} refY={mode === 'full' ? 2.5 : 3} orient="auto">
                    <path d={mode === 'full' ? 'M0 0 L5 2.5 L0 5Z' : 'M0 0 L6 3 L0 6Z'} fill={mode === 'full' ? '#b9acff' : '#9cafff'} />
                  </marker>
                </defs>
                {layout.edges.map(({ edge, display, path, width, lx, ly }) => {
                  const isLit = !!lit && lit.edges.has(edge.id);
                  const cls = ['catalog-edge', mode === 'full' ? 'all-edge' : '', edge.kind === 'FAMILY_ROLE' ? 'family' : 'require', lit && !isLit ? 'quiet' : '', isLit ? 'lit' : ''].filter(Boolean).join(' ');
                  const showLabel = !!display.short && (labels || isLit);
                  return (
                    <g key={edge.id} className={cls}>
                      <path d={path} strokeWidth={width} markerEnd={`url(#${markerId})`} />
                      <path
                        d={path}
                        className="edge-hit"
                        data-cat-edge={edge.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${nodeName(edge.from)} — ${display.title} — ${nodeName(edge.to)}`}
                        onClick={() => onEdge(edge)}
                        onKeyDown={(e) => edgeKey(e, edge)}
                      />
                      <title>{display.title}</title>
                      {showLabel && (
                        <text className="catalog-edge-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">
                          {display.short}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              {layout.nodes.map(({ node, x, y, w, sub }) => {
                const cls = ['catalog-node', mode === 'full' ? 'all-node' : '', node.kind, selectedId === node.id ? 'selected' : '', lit && !lit.nodes.has(node.id) ? 'quiet' : '', lit && lit.nodes.has(node.id) ? 'lit' : '']
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={cls}
                    data-cat-node={`${node.kind}|${node.key}`}
                    aria-pressed={selectedId === node.id}
                    style={{ left: x, top: y, width: w }}
                    onClick={() => onNode(node)}
                  >
                    <small>{sub}</small>
                    <strong>{node.label}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div className="graph-help">
        {mode === 'full'
          ? 'Độ dày đường nối thể hiện trọng số ưu tiên TB. Chọn năng lực để thấy nhiều vai trò cùng dùng; chọn vai trò để thấy toàn bộ năng lực liên quan. “Hiện tất cả quan hệ” bỏ trạng thái làm nổi.'
          : 'Độ dày nối W → C ∝ trọng số ưu tiên trung bình trong các bối cảnh được chọn. Bấm đường nối để xem số liệu tạo trọng số; bấm vị trí để mở khung theo ngành.'}
      </div>
    </div>
  );
}
