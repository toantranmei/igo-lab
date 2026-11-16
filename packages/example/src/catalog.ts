import { Catalog as RawCatalog } from './catalog-data';

export interface CatFamily { id: string; name: string; synthetic: true }
export interface CatIndustry { id: string; name: string; codeSystem: string; note: string }
export interface CatCompetency { id: string; name: string; group: 'FND' | 'LDR' | 'PRO' | 'MC'; version: number; definition: string; synthetic: true }
export interface CatRole { id: string; name: string; family: string; grade: string; contexts: string[]; skills: string[]; synthetic: true }
export interface CatRequirement {
  id: string;
  importance: number;
  mentions: number;
  totalSources: number;
  criticality: number;
  level: number;
  frequency: number;
  score: number;
  core: boolean;
  evidence: string[];
  weight: number;
}
export interface CatProfile {
  id: string;
  role: string;
  industry: string;
  version: string;
  type: string;
  context: { type: string; id: string } | null;
  base: string;
  requirements: CatRequirement[];
  sources: { id: string; source: string; synthetic: true; competencies: string[] }[];
  synthetic: true;
  requirementsView: string;
  overrides: any[];
  derivedFromRole: string | null;
}
export interface CatFilters { family?: string; industry?: string; group?: string }
export interface CatSummary {
  roles: { role: CatRole; profiles: CatProfile[]; coverage: number; weight: number; levels: number[] }[];
  sectors: { industry: CatIndustry; total: number; count: number; coverage: number; weight: number }[];
}
export interface CatComparison {
  rows: { competency: CatCompetency; a?: CatRequirement; b?: CatRequirement }[];
  shared: number;
  /** null when the denominator is zero ("Không tính được"). */
  jaccard: number | null;
}

export interface CatalogData {
  version: string;
  families: CatFamily[];
  industries: CatIndustry[];
  competencies: CatCompetency[];
  roles: CatRole[];
  profiles: CatProfile[];
  /** 'seed' for the demo library, 'live' for a published workspace dictionary. */
  origin?: 'seed' | 'live';
}
export interface CatalogApi extends CatalogData {
  filtered(f?: CatFilters): CatProfile[];
  summaries(ps: CatProfile[], cid: string): CatSummary;
  compare(a: CatProfile, b: CatProfile): CatComparison;
  graph(ps: CatProfile[]): GraphModel;
}

/** Filters, aggregation and comparison of the reference catalog, generalised over any dataset. */
export function createCatalogApi(data: CatalogData): CatalogApi {
  const { roles, industries, competencies, profiles } = data;
  const filtered = ({ family = 'all', industry = 'all', group = 'all' }: CatFilters = {}) =>
    profiles
      .filter(
        (p) =>
          (industry === 'BASE' ? p.industry === 'BASE' : p.industry !== 'BASE' || !profiles.some((x) => x.role === p.role && x.industry !== 'BASE')) &&
          (family === 'all' || roles.find((r) => r.id === p.role)!.family === family) &&
          (industry === 'all' || p.industry === industry),
      )
      .map((p) => ({ ...p, requirements: p.requirements.filter((q) => group === 'all' || competencies.find((c) => c.id === q.id)!.group === group) }));
  const summaries = (ps: CatProfile[], cid: string): CatSummary => {
    const rs = [...new Set(ps.map((p) => p.role))]
      .map((id) => {
        const all = ps.filter((p) => p.role === id);
        const hits = all.filter((p) => p.requirements.some((q) => q.id === cid));
        const qs = hits.map((p) => p.requirements.find((q) => q.id === cid)!);
        return { role: roles.find((r) => r.id === id)!, profiles: hits, coverage: hits.length / all.length, weight: qs.reduce((s, q) => s + q.weight, 0) / all.length, levels: qs.map((q) => q.level) };
      })
      .filter((r) => r.profiles.length);
    const sectors = industries
      .map((i) => {
        const all = ps.filter((p) => p.industry === i.id);
        const hits = all.filter((p) => p.requirements.some((q) => q.id === cid));
        return { industry: i, total: all.length, count: hits.length, coverage: all.length ? hits.length / all.length : 0, weight: all.length ? all.reduce((s, p) => s + (p.requirements.find((q) => q.id === cid)?.weight || 0), 0) / all.length : 0 };
      })
      .filter((s) => s.total);
    return { roles: rs, sectors };
  };
  const compare = (a: CatProfile, b: CatProfile): CatComparison => {
    const ids = new Set([...a.requirements.map((c) => c.id), ...b.requirements.map((c) => c.id)]);
    const rows = [...ids].map((id) => ({ competency: competencies.find((c) => c.id === id)!, a: a.requirements.find((c) => c.id === id), b: b.requirements.find((c) => c.id === id) }));
    const intersection = rows.reduce((s, r) => s + Math.min(r.a?.weight || 0, r.b?.weight || 0), 0);
    const union = rows.reduce((s, r) => s + Math.max(r.a?.weight || 0, r.b?.weight || 0), 0);
    return { rows, shared: rows.filter((r) => r.a && r.b).length, jaccard: union ? intersection / union : null };
  };
  const api: CatalogApi = { ...data, filtered, summaries, compare, graph: (ps) => buildGraph(api, ps) };
  return api;
}

const raw = RawCatalog as unknown as CatalogData;
export const Catalog: CatalogApi = createCatalogApi({ version: raw.version, families: raw.families, industries: raw.industries, competencies: raw.competencies, roles: raw.roles, profiles: raw.profiles, origin: 'seed' });

export type GraphNodeKind = 'family' | 'role' | 'competency';
export interface GraphNode { id: string; kind: GraphNodeKind; key: string; label: string; group?: string }
export interface GraphEdge {
  id: string;
  kind: 'FAMILY_ROLE' | 'ROLE_COMPETENCY';
  from: string;
  to: string;
  /** Mean requirement weight over the role's profiles in view (0 for profiles lacking C). */
  weight: number | null;
  levels?: number[];
  profiles?: string[];
}
export interface GraphModel { nodes: GraphNode[]; edges: GraphEdge[] }

/** One node/edge set for both the 2D and 3D views. Coordinates are not part of the model. */
export function buildGraph(cat: Pick<CatalogApi, 'roles' | 'families' | 'competencies' | 'summaries'>, ps: CatProfile[]): GraphModel {
  const roleIds = [...new Set(ps.map((p) => p.role))];
  const rs = roleIds.map((id) => cat.roles.find((r) => r.id === id)!);
  const fams = cat.families.filter((f) => rs.some((r) => r.family === f.id));
  const cids = cat.competencies.filter((c) => ps.some((p) => p.requirements.some((q) => q.id === c.id)));
  const nodes: GraphNode[] = [
    ...fams.map((f) => ({ id: 'F:' + f.id, kind: 'family' as const, key: f.id, label: f.name })),
    ...rs.map((r) => ({ id: 'W:' + r.id, kind: 'role' as const, key: r.id, label: r.name })),
    ...cids.map((c) => ({ id: 'C:' + c.id, kind: 'competency' as const, key: c.id, label: c.name, group: c.group })),
  ];
  const edges: GraphEdge[] = rs.map((r) => ({ id: `FW:${r.family}:${r.id}`, kind: 'FAMILY_ROLE' as const, from: 'F:' + r.family, to: 'W:' + r.id, weight: null }));
  for (const c of cids) {
    for (const s of cat.summaries(ps, c.id).roles) {
      edges.push({
        id: `WC:${s.role.id}:${c.id}`,
        kind: 'ROLE_COMPETENCY',
        from: 'W:' + s.role.id,
        to: 'C:' + c.id,
        weight: s.weight,
        levels: s.levels,
        profiles: s.profiles.map((p) => p.id),
      });
    }
  }
  return { nodes, edges };
}
