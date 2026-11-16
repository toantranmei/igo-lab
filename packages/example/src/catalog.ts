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

interface CatalogApi {
  version: string;
  families: CatFamily[];
  industries: CatIndustry[];
  competencies: CatCompetency[];
  roles: CatRole[];
  profiles: CatProfile[];
  filtered(f?: CatFilters): CatProfile[];
  summaries(ps: CatProfile[], cid: string): CatSummary;
  compare(a: CatProfile, b: CatProfile): { rows: CatComparison['rows']; shared: number; jaccard: number };
}
const raw = RawCatalog as unknown as CatalogApi;

export const Catalog = {
  ...raw,
  compare(a: CatProfile, b: CatProfile): CatComparison {
    const r = raw.compare(a, b);
    const union = r.rows.reduce((s, x) => s + Math.max(x.a?.weight || 0, x.b?.weight || 0), 0);
    return { ...r, jaccard: union ? r.jaccard : null };
  },
};

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
export function buildGraph(ps: CatProfile[]): GraphModel {
  const roleIds = [...new Set(ps.map((p) => p.role))];
  const rs = roleIds.map((id) => raw.roles.find((r) => r.id === id)!);
  const fams = raw.families.filter((f) => rs.some((r) => r.family === f.id));
  const cids = raw.competencies.filter((c) => ps.some((p) => p.requirements.some((q) => q.id === c.id)));
  const nodes: GraphNode[] = [
    ...fams.map((f) => ({ id: 'F:' + f.id, kind: 'family' as const, key: f.id, label: f.name })),
    ...rs.map((r) => ({ id: 'W:' + r.id, kind: 'role' as const, key: r.id, label: r.name })),
    ...cids.map((c) => ({ id: 'C:' + c.id, kind: 'competency' as const, key: c.id, label: c.name, group: c.group })),
  ];
  const edges: GraphEdge[] = rs.map((r) => ({ id: `FW:${r.family}:${r.id}`, kind: 'FAMILY_ROLE' as const, from: 'F:' + r.family, to: 'W:' + r.id, weight: null }));
  for (const c of cids) {
    for (const s of raw.summaries(ps, c.id).roles) {
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
