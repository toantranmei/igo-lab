// Pure layout / projection / hit-testing for the Canvas-2D "3D" network. No DOM access here.
import type { GraphEdge, GraphModel, GraphNode } from '@cl/example';

export interface Node3D {
  id: string;
  kind: GraphNode['kind'];
  key: string;
  name: string;
  short: string;
  color: string;
  x: number;
  y: number;
  z: number;
}

export interface Pose { yaw: number; pitch: number; zoom: number; panX: number; panY: number }
export interface Projected { node: Node3D; x: number; y: number; z: number; s: number; r: number }
export type Hit3D = { kind: 'node'; node: Node3D } | { kind: 'edge'; edge: GraphEdge };

export const DEFAULT_POSE: Readonly<Pose> = { yaw: 0.32, pitch: -0.17, zoom: 1, panX: 0, panY: 0 };
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 4;
export const PITCH_MAX = 1.5;

export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
export const clampPitch = (p: number) => Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p));

export const KIND_COLORS = { family: '#77d7d1', role: '#8fc4ff' } as const;
export const GROUP_COLORS: Record<string, string> = { FND: '#e5b978', LDR: '#a1dfb2', PRO: '#b4a5ff', MC: '#ef9cc6' };

const AXES = ['x', 'y', 'z'] as const;

/**
 * Coordinates for the shared GraphModel: families on a ring, roles near their family,
 * competencies on a Fibonacci sphere, then 120 rounds of force relaxation.
 * Only positions are produced; the node and edge sets are exactly the model's.
 */
export function layout3d(g: GraphModel): Node3D[] {
  const families = g.nodes.filter((n) => n.kind === 'family');
  const roles = g.nodes.filter((n) => n.kind === 'role');
  const comps = g.nodes.filter((n) => n.kind === 'competency');
  const familyOfRole = new Map<string, string>();
  for (const e of g.edges) if (e.kind === 'FAMILY_ROLE') familyOfRole.set(e.to, e.from);
  const short = (n: GraphNode) => (n.key.length <= 12 ? n.key : n.label);
  const nodes: Node3D[] = [];
  const fCount = Math.max(1, families.length);

  families.forEach((f, i) => {
    const a = (i / fCount) * Math.PI * 2;
    nodes.push({ id: f.id, kind: f.kind, key: f.key, name: f.label, short: short(f), color: KIND_COLORS.family, x: Math.cos(a) * 340, y: Math.sin(a) * 240, z: -80 });
  });
  roles.forEach((r, i) => {
    const fi = families.findIndex((f) => f.id === familyOfRole.get(r.id));
    const a = (fi / fCount) * Math.PI * 2;
    nodes.push({
      id: r.id,
      kind: r.kind,
      key: r.key,
      name: r.label,
      short: short(r),
      color: KIND_COLORS.role,
      x: Math.cos(a) * 240 + (i % 2) * 55,
      y: Math.sin(a) * 190 + ((i % 3) - 1) * 45,
      z: 110 + ((i % 3) - 1) * 80,
    });
  });
  comps.forEach((c, i) => {
    const y = 1 - (2 * (i + 0.5)) / comps.length;
    const a = i * Math.PI * (3 - Math.sqrt(5));
    const r = Math.sqrt(1 - y * y);
    nodes.push({
      id: c.id,
      kind: c.kind,
      key: c.key,
      name: c.label,
      short: short(c),
      color: GROUP_COLORS[c.group ?? ''] ?? GROUP_COLORS.PRO!,
      x: Math.cos(a) * r * 210,
      y: y * 230,
      z: Math.sin(a) * r * 220,
    });
  });

  const map = new Map(nodes.map((n) => [n.id, n]));
  const links = g.edges
    .map((e) => ({ a: map.get(e.from), b: map.get(e.to), rest: e.kind === 'FAMILY_ROLE' ? 115 : 220 }))
    .filter((l): l is { a: Node3D; b: Node3D; rest: number } => !!l.a && !!l.b);

  for (let t = 0; t < 120; t++) {
    const forces = new Map(nodes.map((n) => [n.id, { x: 0, y: 0, z: 0 }]));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
        const f = 1900 / (d * d);
        const fa = forces.get(a.id)!;
        const fb = forces.get(b.id)!;
        for (const k of AXES) {
          const v = ((a[k] - b[k]) / d) * f;
          fa[k] += v;
          fb[k] -= v;
        }
      }
    }
    for (const { a, b, rest } of links) {
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      const f = (d - rest) * 0.0009;
      const fa = forces.get(a.id)!;
      const fb = forces.get(b.id)!;
      for (const k of AXES) {
        const v = ((b[k] - a[k]) / d) * f;
        fa[k] += v;
        fb[k] -= v;
      }
    }
    for (const n of nodes) {
      const f = forces.get(n.id)!;
      for (const k of AXES) n[k] += f[k] * 3;
    }
  }
  return nodes;
}

export function project(n: Node3D, pose: Pose, width: number, height: number): Projected {
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const x = n.x * cy + n.z * sy;
  const z = -n.x * sy + n.z * cy;
  const y = n.y * cp - z * sp;
  const depth = n.y * sp + z * cp;
  const base = Math.min(width / 950, height / 760);
  const s = (720 / (850 + depth)) * base * pose.zoom;
  return {
    node: n,
    x: width / 2 + x * s + pose.panX,
    y: height / 2 + y * s + pose.panY,
    z: depth,
    s,
    r: Math.max(4, (n.kind === 'family' ? 11 : n.kind === 'role' ? 9 : 7) * s),
  };
}

/** Projected points sorted far → near (painter's order). */
export function projectAll(nodes: Node3D[], pose: Pose, width: number, height: number): Projected[] {
  return nodes.map((n) => project(n, pose, width, height)).sort((a, b) => b.z - a.z);
}

/** Nearest node first (front-most wins), otherwise the closest edge within 5px. */
export function hitTest(points: Projected[], edges: GraphEdge[], x: number, y: number): Hit3D | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (Math.hypot(p.x - x, p.y - y) < p.r + 7) return { kind: 'node', node: p.node };
  }
  const pp = new Map(points.map((p) => [p.node.id, p]));
  let best = 5;
  let result: Hit3D | null = null;
  for (const e of edges) {
    const a = pp.get(e.from);
    const b = pp.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len)) : 0;
    const dist = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    if (dist < best) {
      best = dist;
      result = { kind: 'edge', edge: e };
    }
  }
  return result;
}
