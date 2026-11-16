// Hand-placed 2D column layouts (full network and ego) for the shared GraphModel. Pure; no DOM.
import type { GraphEdge, GraphModel, GraphNode } from '@cl/example';
import { edgeDisplay, type CatLookup, type EdgeDisplay } from './model';

export interface Placed2D { node: GraphNode; x: number; y: number; w: number; sub: string }
export interface PlacedEdge2D { edge: GraphEdge; display: EdgeDisplay; path: string; width: number; lx: number; ly: number }
export interface Layout2D {
  mode: 'full' | 'ego';
  width: number;
  height: number;
  cols: { left: number; text: string }[];
  nodes: Placed2D[];
  edges: PlacedEdge2D[];
}

const byRoleOrder = (lk: CatLookup) => (a: GraphNode, b: GraphNode) => lk.roleOrder(a.key) - lk.roleOrder(b.key);

/** Full network: families | roles | competencies in two sub-columns. */
export function layoutFull(g: GraphModel, lk: CatLookup): Layout2D {
  const rr = g.nodes.filter((n) => n.kind === 'role').sort(byRoleOrder(lk));
  const ff = g.nodes.filter((n) => n.kind === 'family');
  const cc = g.nodes.filter((n) => n.kind === 'competency');
  const rows = Math.max(rr.length, Math.ceil(cc.length / 2), 3);
  const height = rows * 73 + 100;
  const nodes: Placed2D[] = [];
  const familyLabel = lk.seed ? 'Họ nghề seed' : 'Họ nghề';

  rr.forEach((r, i) => {
    const role = lk.role(r.key);
    nodes.push({ node: r, x: 240, y: 65 + (i * (rows - 1) * 73) / Math.max(1, rr.length - 1), w: 220, sub: [role.grade, lk.fam(role.family).name].filter(Boolean).join(' · ') });
  });
  ff.forEach((f) => {
    const children = nodes.filter((n) => n.node.kind === 'role' && lk.role(n.node.key).family === f.key);
    const y = children.length ? children.reduce((s, n) => s + n.y, 0) / children.length : 65;
    nodes.push({ node: f, x: 15, y, w: 185, sub: familyLabel });
  });
  cc.forEach((c, i) => {
    const users = g.edges.filter((e) => e.kind === 'ROLE_COMPETENCY' && e.to === c.id).length;
    nodes.push({ node: c, x: 550 + (i % 2) * 275, y: 65 + Math.floor(i / 2) * 73, w: 245, sub: `${c.key} · ${c.group ?? ''} · ${users} vai trò` });
  });

  const map = new Map(nodes.map((n) => [n.node.id, n]));
  const edges: PlacedEdge2D[] = [];
  for (const edge of g.edges) {
    const a = map.get(edge.from);
    const b = map.get(edge.to);
    if (!a || !b) continue;
    const display = edgeDisplay(edge, lk);
    const x = a.x + a.w;
    const y = a.y + 29;
    const x2 = b.x;
    const y2 = b.y + 29;
    const mid = x + (x2 - x) * 0.46;
    const far = b.x > 800;
    const path = far ? `M${x} ${y} C500 ${y} 500 ${b.y - 7} 520 ${b.y - 7} H805 V${y2} H${x2}` : `M${x} ${y} C${mid} ${y} ${mid} ${y2} ${x2} ${y2}`;
    // Label sits on the curve midpoint (t = .5) so labels of one role or one competency do not stack.
    const lx = far ? (x + 3 * 500 + 3 * 500 + 520) / 8 : (x + 6 * mid + x2) / 8;
    const ly = far ? (y + b.y - 7) / 2 : (y + y2) / 2;
    edges.push({ edge, display, path, width: edge.kind === 'ROLE_COMPETENCY' ? 0.6 + (display.weight ?? 0) * 11 : 1, lx, ly });
  }
  return {
    mode: 'full',
    width: 1090,
    height,
    cols: [
      { left: 15, text: 'HỌ NGHỀ' },
      { left: 240, text: 'VỊ TRÍ CHUẨN W' },
      { left: 550, text: 'TOÀN BỘ NĂNG LỰC CHUNG C' },
    ],
    nodes,
    edges,
  };
}

/** Ego ("vùng lân cận"): the sub-graph of the same model around one competency. */
export function layoutEgo(g: GraphModel, cid: string, lk: CatLookup): Layout2D {
  const target = g.nodes.find((n) => n.id === 'C:' + cid);
  const w = 220;
  const req = g.edges.filter((e) => e.kind === 'ROLE_COMPETENCY' && e.to === 'C:' + cid);
  const reqByRole = new Map(req.map((e) => [e.from, e]));
  const rr = g.nodes.filter((n) => n.kind === 'role' && reqByRole.has(n.id)).sort(byRoleOrder(lk));
  const ff = g.nodes.filter((n) => n.kind === 'family' && rr.some((r) => lk.role(r.key).family === n.key));
  const height = Math.max(430, rr.length * 94 + 100);
  const nodes: Placed2D[] = [];
  const familyLabel = lk.seed ? 'Họ nghề seed' : 'Họ nghề';

  ff.forEach((f) => {
    const idx = rr.map((r, i) => (lk.role(r.key).family === f.key ? i : -1)).filter((i) => i >= 0);
    nodes.push({ node: f, x: 20, y: 70 + ((Math.min(...idx) + Math.max(...idx)) / 2) * 94, w, sub: familyLabel });
  });
  rr.forEach((r, i) => {
    const e = reqByRole.get(r.id)!;
    const d = edgeDisplay(e, lk);
    const parts = [lk.role(r.key).grade, `${e.profiles?.length ?? 0} bối cảnh`];
    if (d.short) parts.push('w TB ' + d.short);
    nodes.push({ node: r, x: 300, y: 70 + i * 94, w, sub: parts.filter(Boolean).join(' · ') });
  });
  if (target && rr.length) {
    nodes.push({ node: target, x: 600, y: 70 + Math.max(0, (rr.length - 1) / 2) * 94, w, sub: `${target.group ?? ''} · ${rr.length} vai trò dùng chung` });
  }

  const map = new Map(nodes.map((n) => [n.node.id, n]));
  const edges: PlacedEdge2D[] = [];
  for (const edge of g.edges) {
    const keep = edge.kind === 'ROLE_COMPETENCY' ? edge.to === 'C:' + cid : reqByRole.has(edge.to);
    const a = map.get(edge.from);
    const b = map.get(edge.to);
    if (!keep || !a || !b) continue;
    const display = edgeDisplay(edge, lk);
    const x = a.x + w;
    const y = a.y + 34;
    const x2 = b.x;
    const y2 = b.y + 34;
    const mid = (x + x2) / 2;
    edges.push({
      edge,
      display,
      path: `M${x} ${y} C${mid} ${y} ${mid} ${y2} ${x2} ${y2}`,
      width: edge.kind === 'ROLE_COMPETENCY' ? 1 + (display.weight ?? 0) * 22 : 1,
      lx: mid,
      ly: (y + y2) / 2,
    });
  }
  return {
    mode: 'ego',
    width: 860,
    height,
    cols: [
      { left: 20, text: 'HỌ NGHỀ / CHỨC NĂNG' },
      { left: 300, text: 'VỊ TRÍ CHUẨN · W' },
      { left: 600, text: 'NĂNG LỰC CHUNG · C' },
    ],
    nodes,
    edges,
  };
}
