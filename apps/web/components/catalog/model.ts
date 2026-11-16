import type { CatalogApi, CatCompetency, CatFamily, CatProfile, CatRequirement, CatRole, GraphEdge, GraphModel } from '@cl/example';

export type CatalogView = 'network' | '3d' | 'matrix' | 'compare';

export type CatPick =
  | { type: 'overview' }
  | { type: 'competency'; id: string }
  | { type: 'role'; id: string }
  | { type: 'family'; id: string }
  | { type: 'profile'; id: string; cid?: string }
  | { type: 'edge'; role: string; cid: string }
  | { type: 'cell'; cid: string; industry: string };

export const GROUP_NAMES: Record<string, string> = { FND: 'Nền tảng', LDR: 'Lãnh đạo', PRO: 'Chuyên môn', MC: 'Meta' };
export const NO_FORMULA = 'Chưa cấu hình công thức trọng số';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export const pct = (x: number) => (x * 100).toFixed(1) + '%';
export const num = (x: unknown, digits = 2) => (finite(x) ? x.toFixed(digits) : '—');

/** True when the requirement carries the score inputs the weight formula needs. */
export function hasFormula(q: CatRequirement | undefined): q is CatRequirement {
  if (!q) return false;
  const v = q as Partial<CatRequirement>;
  return finite(v.importance) && finite(v.mentions) && finite(v.criticality) && finite(v.totalSources) && v.totalSources > 0;
}

export const weightText = (q: CatRequirement | undefined) => (hasFormula(q) && finite(q.weight) ? pct(q.weight) : '—');

export interface CatLookup {
  seed: boolean;
  role(id: string): CatRole;
  comp(id: string): CatCompetency;
  fam(id: string): CatFamily;
  sector(id: string): { id: string; name: string };
  /** Unfiltered profile: all requirements, so Σs and weights are never renormalised. */
  profile(id: string): CatProfile | undefined;
  roleOrder(id: string): number;
  profileLabel(p: CatProfile): string;
}

export function makeLookup(catalog: CatalogApi): CatLookup {
  const roles = new Map(catalog.roles.map((r, i) => [r.id, { r, i }]));
  const comps = new Map(catalog.competencies.map((c) => [c.id, c]));
  const fams = new Map(catalog.families.map((f) => [f.id, f]));
  const inds = new Map(catalog.industries.map((i) => [i.id, i]));
  const profiles = new Map(catalog.profiles.map((p) => [p.id, p]));
  const role = (id: string): CatRole => roles.get(id)?.r ?? { id, name: id, family: '', grade: '', contexts: [], skills: [], synthetic: true };
  const sector = (id: string) => (id === 'BASE' ? { id: 'BASE', name: 'Liên ngành · khung gốc' } : (inds.get(id) ?? { id, name: id }));
  return {
    seed: catalog.origin !== 'live',
    role,
    comp: (id) => comps.get(id) ?? ({ id, name: id, group: 'PRO', version: 1, definition: '', synthetic: true } as CatCompetency),
    fam: (id) => fams.get(id) ?? { id, name: id || '—', synthetic: true },
    sector,
    profile: (id) => profiles.get(id),
    roleOrder: (id) => roles.get(id)?.i ?? Number.MAX_SAFE_INTEGER,
    profileLabel: (p) => role(p.role).name + ' · ' + sector(p.industry).name,
  };
}

export interface EdgeParts { family?: string; role: string; cid?: string }

export function edgeParts(e: GraphEdge): EdgeParts {
  return e.kind === 'FAMILY_ROLE' ? { family: e.from.slice(2), role: e.to.slice(2) } : { role: e.from.slice(2), cid: e.to.slice(2) };
}

/** A role→competency edge may show a weight only when every contributing requirement has formula inputs. */
export function edgeConfigured(e: GraphEdge, lk: CatLookup): boolean {
  if (e.kind !== 'ROLE_COMPETENCY' || !finite(e.weight)) return false;
  const cid = e.to.slice(2);
  return (e.profiles ?? []).every((pid) => hasFormula(lk.profile(pid)?.requirements.find((q) => q.id === cid)));
}

export interface EdgeDisplay {
  /** Weight used for stroke width; null when unknown/unconfigured. */
  weight: number | null;
  /** Short weight label ("12.3%") or null when no label must be drawn. */
  short: string | null;
  /** Tooltip / accessible label. */
  title: string;
}

export function edgeDisplay(e: GraphEdge, lk: CatLookup): EdgeDisplay {
  if (e.kind === 'FAMILY_ROLE') return { weight: null, short: null, title: 'thuộc họ nghề' };
  if (!edgeConfigured(e, lk) || e.weight == null) return { weight: null, short: null, title: 'yêu cầu · ' + NO_FORMULA.toLowerCase() };
  return { weight: e.weight, short: pct(e.weight), title: 'yêu cầu · trọng số TB ' + pct(e.weight) };
}

export interface FocusSets { nodes: Set<string>; edges: Set<string> }

/** Nodes/edges kept lit for a selection; null = nothing selected (everything normal). Shared by 2D and 3D. */
export function focusSets(g: GraphModel, pick: CatPick, lk: CatLookup): FocusSets | null {
  if (pick.type === 'overview') return null;
  let rsel: string | null = null;
  let csel: string | null = null;
  let fsel: string | null = null;
  if (pick.type === 'role') rsel = pick.id;
  else if (pick.type === 'competency') csel = pick.id;
  else if (pick.type === 'family') fsel = pick.id;
  else if (pick.type === 'profile') {
    rsel = lk.profile(pick.id)?.role ?? null;
    csel = pick.cid ?? null;
  } else if (pick.type === 'edge') {
    rsel = pick.role;
    csel = pick.cid;
  } else csel = pick.cid;

  const familyOf = new Map<string, string>();
  for (const e of g.edges) if (e.kind === 'FAMILY_ROLE') familyOf.set(e.to.slice(2), e.from.slice(2));

  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const e of g.edges) {
    const p = edgeParts(e);
    const hit = rsel
      ? p.role === rsel && (!csel || e.kind === 'FAMILY_ROLE' || p.cid === csel)
      : csel
        ? p.cid === csel
        : fsel
          ? familyOf.get(p.role) === fsel
          : false;
    if (hit) {
      edges.add(e.id);
      nodes.add(e.from);
      nodes.add(e.to);
    }
  }
  if (csel && !rsel) {
    for (const e of g.edges) {
      if (e.kind === 'FAMILY_ROLE' && nodes.has(e.to)) {
        edges.add(e.id);
        nodes.add(e.from);
      }
    }
  }
  if (rsel) nodes.add('W:' + rsel);
  if (csel) nodes.add('C:' + csel);
  if (fsel) nodes.add('F:' + fsel);
  return { nodes, edges };
}

/** Which graph node (if any) a selection points at, for the `selected` outline. */
export function pickedNodeId(pick: CatPick): string | null {
  if (pick.type === 'role') return 'W:' + pick.id;
  if (pick.type === 'competency') return 'C:' + pick.id;
  if (pick.type === 'family') return 'F:' + pick.id;
  return null;
}

export function levelRange(levels: number[]): string {
  const ls = levels.filter(finite);
  if (!ls.length) return '—';
  const lo = Math.min(...ls);
  const hi = Math.max(...ls);
  return lo === hi ? `${lo}/5` : `${lo}–${hi}/5`;
}
