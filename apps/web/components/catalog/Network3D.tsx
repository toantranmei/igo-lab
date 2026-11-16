'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { GraphEdge, GraphModel, GraphNode } from '@cl/example';
import type { EdgeDisplay, FocusSets } from './model';
import { DEFAULT_POSE, GROUP_COLORS, KIND_COLORS, clampPitch, clampZoom, hitTest, layout3d, projectAll, type Hit3D, type Node3D, type Pose, type Projected } from './network3d-core';

interface Props {
  graph: GraphModel;
  focus: FocusSets | null;
  edgeDisplay(edge: GraphEdge): EdgeDisplay;
  onNode(node: GraphNode): void;
  onEdge(edge: GraphEdge): void;
  onClear(): void;
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const usePrefersReducedMotion = () =>
  useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );

interface LiveState {
  graph: GraphModel;
  nodes: Node3D[];
  focus: FocusSets | null;
  labelFull: boolean;
  edgeDisplay(edge: GraphEdge): EdgeDisplay;
  onNode(node: GraphNode): void;
  onEdge(edge: GraphEdge): void;
}

export default function Network3D({ graph, focus, edgeDisplay, onNode, onEdge, onClear }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);

  const nodes = useMemo(() => layout3d(graph), [graph]);
  const [labelFull, setLabelFull] = useState(false);
  const [spin, setSpin] = useState(false);
  const [noCanvas, setNoCanvas] = useState(false);
  const reduced = usePrefersReducedMotion();
  const spinning = spin && !reduced;

  // Pose and latest props live in refs: selection changes only redraw, the canvas is never remounted.
  const pose = useRef<Pose>({ ...DEFAULT_POSE });
  const live = useRef<LiveState>({ graph, nodes, focus, labelFull, edgeDisplay, onNode, onEdge });
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const tip = tipRef.current;
    if (!canvas || !stage || !tip) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setNoCanvas(true);
      return;
    }
    let width = 800;
    let height = 650;
    let points: Projected[] = [];
    let hover: Hit3D | null = null;
    let disposed = false;
    let moved = false;
    let drag: { x: number; y: number; yaw: number; pitch: number; panX: number; panY: number; pan: boolean } | null = null;
    let pinch: { d: number; zoom: number } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();

    const draw = () => {
      if (disposed) return;
      const { graph: g, nodes: ns, focus: fc, labelFull: full, edgeDisplay: display } = live.current;
      const p0 = pose.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createRadialGradient(width * 0.5, height * 0.5, 20, width * 0.5, height * 0.5, width * 0.65);
      bg.addColorStop(0, '#162337');
      bg.addColorStop(1, '#090f1a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#b2c2e622';
      for (let i = 0; i < 65; i++) {
        ctx.fillRect((((i * 137.508) % 997) / 997) * width, (((i * 83.71) % 503) / 503) * height, 1.2, 1.2);
      }
      points = projectAll(ns, p0, width, height);
      const pmap = new Map(points.map((p) => [p.node.id, p]));
      for (const e of g.edges) {
        const a = pmap.get(e.from);
        const b = pmap.get(e.to);
        if (!a || !b) continue;
        const lit = !!fc && fc.edges.has(e.id);
        const family = e.kind === 'FAMILY_ROLE';
        ctx.globalAlpha = fc ? (lit ? 0.85 : 0.07) : family ? 0.55 : 0.24;
        ctx.strokeStyle = lit ? '#d5c7ff' : family ? '#72d5d1' : '#99aee0';
        ctx.lineWidth = lit ? 2 : Math.min(2, 0.4 + (display(e).weight ?? 0) * 8);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const labels: { x: number; y: number; w: number }[] = [];
      for (const p of points) {
        const n = p.node;
        const dim = !!fc && !fc.nodes.has(n.id);
        ctx.globalAlpha = dim ? 0.26 : 1;
        const grad = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.35, 0, p.x, p.y, p.r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, n.color);
        grad.addColorStop(1, n.color + '88');
        ctx.fillStyle = grad;
        ctx.shadowColor = n.color;
        ctx.shadowBlur = dim ? 0 : 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        const isHovered = hover?.kind === 'node' && hover.node.id === n.id;
        const isChosen = !!fc && fc.nodes.has(n.id);
        if (isHovered) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        const text = full ? n.name : n.short;
        ctx.font = '11px system-ui';
        const tw = ctx.measureText(text).width;
        const tx = p.x + p.r + 6;
        const ty = p.y + 4;
        const overlaps = labels.some((l) => Math.abs(l.y - ty) < 14 && tx < l.x + l.w && tx + tw > l.x);
        if (!dim && (!overlaps || isHovered || isChosen)) {
          ctx.fillStyle = '#07101bcc';
          ctx.fillRect(tx - 3, ty - 11, tw + 6, 15);
          ctx.fillStyle = n.color;
          ctx.fillText(text, tx, ty);
          labels.push({ x: tx, y: ty, w: tw });
        }
      }
      ctx.globalAlpha = 1;
      canvas.dataset.nodeCount = String(g.nodes.length);
      canvas.dataset.edgeCount = String(g.edges.length);
      canvas.dataset.yaw = String(p0.yaw);
      canvas.dataset.pitch = String(p0.pitch);
      canvas.dataset.zoom = String(p0.zoom);
      if (zoomRef.current) zoomRef.current.textContent = Math.round(p0.zoom * 100) + '%';
    };
    drawRef.current = draw;

    const resize = () => {
      const box = stage.getBoundingClientRect();
      width = Math.max(200, box.width);
      height = box.height || 650;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw();
    };
    const hit = (x: number, y: number) => hitTest(points, live.current.graph.edges, x, y);
    const coords = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const twoPointers = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      const p = coords(e);
      const po = pose.current;
      pointers.set(e.pointerId, p);
      moved = false;
      drag = { x: p.x, y: p.y, yaw: po.yaw, pitch: po.pitch, panX: po.panX, panY: po.panY, pan: e.shiftKey || e.button === 2 };
      if (pointers.size === 2) pinch = { d: twoPointers(), zoom: po.zoom };
    };
    const onMove = (e: PointerEvent) => {
      const p = coords(e);
      const po = pose.current;
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, p);
        if (pointers.size === 2 && pinch) {
          po.zoom = clampZoom((pinch.zoom * twoPointers()) / Math.max(1, pinch.d));
          moved = true;
          draw();
          return;
        }
        if (drag) {
          const dx = p.x - drag.x;
          const dy = p.y - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
          if (drag.pan) {
            po.panX = drag.panX + dx;
            po.panY = drag.panY + dy;
          } else {
            po.yaw = drag.yaw + dx * 0.008;
            po.pitch = clampPitch(drag.pitch + dy * 0.008);
          }
          draw();
          return;
        }
      }
      hover = hit(p.x, p.y);
      if (hover) {
        tip.hidden = false;
        tip.textContent = hover.kind === 'node' ? hover.node.name : live.current.edgeDisplay(hover.edge).title;
        tip.style.left = Math.max(4, Math.min(width - 220, p.x + 14)) + 'px';
        tip.style.top = Math.max(8, p.y - 36) + 'px';
      } else tip.hidden = true;
      draw();
    };
    const onUp = (e: PointerEvent) => {
      const p = coords(e);
      pointers.delete(e.pointerId);
      if (!moved) {
        const h = hit(p.x, p.y);
        const { graph: g, onNode: nodeCb, onEdge: edgeCb } = live.current;
        if (h?.kind === 'node') {
          const node = g.nodes.find((n) => n.id === h.node.id);
          if (node) nodeCb(node);
        } else if (h?.kind === 'edge') edgeCb(h.edge);
      }
      drag = null;
      pinch = null;
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      drag = null;
      pinch = null;
    };
    const onLeave = () => {
      hover = null;
      tip.hidden = true;
      draw();
    };
    const onContext = (e: Event) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      pose.current.zoom = clampZoom(pose.current.zoom * Math.exp(-e.deltaY * 0.001));
      draw();
    };
    const onKey = (e: KeyboardEvent) => {
      const po = pose.current;
      switch (e.key) {
        case 'ArrowLeft':
          po.yaw -= 0.12;
          break;
        case 'ArrowRight':
          po.yaw += 0.12;
          break;
        case 'ArrowUp':
          po.pitch = clampPitch(po.pitch - 0.12);
          break;
        case 'ArrowDown':
          po.pitch = clampPitch(po.pitch + 0.12);
          break;
        case '+':
        case '=':
          po.zoom = clampZoom(po.zoom * 1.15);
          break;
        case '-':
          po.zoom = clampZoom(po.zoom / 1.15);
          break;
        default:
          return;
      }
      e.preventDefault();
      draw();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(stage);
    resize();

    return () => {
      disposed = true;
      drawRef.current = () => {};
      ro?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
  }, []);

  // New data / selection / label mode: refresh the refs and redraw with the current pose.
  useEffect(() => {
    live.current = { graph, nodes, focus, labelFull, edgeDisplay, onNode, onEdge };
    drawRef.current();
  }, [graph, nodes, focus, labelFull, edgeDisplay, onNode, onEdge]);

  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    const loop = () => {
      pose.current.yaw += 0.003;
      drawRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  const zoomBy = (factor: number) => {
    pose.current.zoom = clampZoom(pose.current.zoom * factor);
    drawRef.current();
  };
  const reset = () => {
    pose.current = { ...DEFAULT_POSE };
    drawRef.current();
  };
  const toggleFullscreen = () => {
    const host = hostRef.current;
    if (!host) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else host.requestFullscreen?.()?.catch(() => {});
  };

  return (
    <div className="three-wrap" ref={hostRef} data-node-count={graph.nodes.length} data-edge-count={graph.edges.length}>
      <div className="three-toolbar">
        <span className="three-status">
          {noCanvas ? (
            'Trình duyệt chưa hỗ trợ canvas; anh có thể dùng view mạng 2D.'
          ) : (
            <>
              {graph.nodes.length} nút · {graph.edges.length} quan hệ · không gian XYZ · <span ref={zoomRef}>100%</span>
            </>
          )}
        </span>
        <div>
          <button type="button" data-three="out" aria-label="Thu nhỏ" onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button type="button" data-three="in" aria-label="Phóng to" onClick={() => zoomBy(1.2)}>
            +
          </button>
          <button type="button" data-three="reset" onClick={reset}>
            Góc nhìn ban đầu
          </button>
          <button type="button" data-three="labels" aria-pressed={labelFull} onClick={() => setLabelFull((v) => !v)}>
            Tên node
          </button>
          <button type="button" data-three="spin" aria-pressed={spinning} hidden={reduced} disabled={reduced} onClick={() => setSpin((v) => !v)}>
            Tự xoay
          </button>
          <button type="button" data-three="fullscreen" onClick={toggleFullscreen}>
            Toàn màn hình
          </button>
          <button type="button" id="three-clear" onClick={onClear}>
            Bỏ chọn
          </button>
        </div>
      </div>
      <div className="three-stage" ref={stageRef}>
        <canvas ref={canvasRef} tabIndex={0} aria-label="Mạng node 3D: kéo để xoay, cuộn hoặc hai ngón để zoom, Shift kéo để dịch chuyển, phím mũi tên để xoay, phím + − để zoom. Có danh sách node tương đương bên dưới." />
        <div className="three-tooltip" ref={tipRef} hidden />
        <div className="three-hint">Kéo: xoay · cuộn / chụm: zoom · Shift kéo: dịch chuyển · chạm node: chi tiết</div>
      </div>
      <div className="three-legend">
        <span style={{ color: KIND_COLORS.family }}>● Họ nghề</span>
        <span style={{ color: KIND_COLORS.role }}>● Vị trí W</span>
        {Object.entries(GROUP_COLORS).map(([k, color]) => (
          <span key={k} style={{ color }}>
            ● {k}
          </span>
        ))}
      </div>
      <p className="muted-box">Cùng dữ liệu với mạng 2D. Độ dày nối W → C theo trọng số ưu tiên; khoảng cách XYZ chỉ là bố trí đồ thị, không phải độ giống nghề hay khả năng chuyển nghề.</p>
      <details>
        <summary>Chọn node bằng danh sách ({graph.nodes.length})</summary>
        <div className="three-node-list">
          {graph.nodes.map((n) => (
            <button key={n.id} type="button" data-cat-node={`${n.kind}|${n.key}`} onClick={() => onNode(n)}>
              {n.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
