import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ChangeItem, DictView } from '@cl/contract';
import { t, type DbOrTx } from '@cl/db';

export type RecordKind = 'W' | 'C' | 'I' | 'R' | 'V' | 'G';
export interface Member {
  kind: RecordKind;
  id: string;
  version: number;
}
export interface CData {
  competency_id: string;
  display_code: string;
  label: string;
  definition: string;
  aliases: string[];
  status: 'ACTIVE' | 'DEPRECATED' | string;
  group?: string;
}
export interface IData {
  indicator_id: string;
  competency_id: string;
  statement: string;
  segment_ids: string[];
  /** P2/P5: indicator level 1, 3 or 5 (absent on indicators written before P2). */
  level?: '1' | '3' | '5';
  screening?: string;
}
export interface WData {
  role_id: string;
  role_title: string;
  tasks: { task_id: string; statement: string; weight: number | null; competency_ids: string[]; segment_ids: string[] }[];
}
export interface RData {
  framework_id: string;
  role_id: string;
  role_title: string;
  version_label: string;
  purpose: string;
  evidence_scope: string;
  run_id: string | null;
  session_id: string | null;
  family?: string | null;
  industry?: string | null;
  /** P2: release tier (34)–(35), review date (36), owner (G8). */
  tier?: 'INTERNAL' | 'MARKET' | 'HR_DECISION';
  review_date?: string;
  owner?: string | null;
  requirements: {
    competency_id: string;
    competency_version: number;
    required_level: number | null;
    weight: number | null;
    indicators: { indicator_id: string; version: number }[];
    evidence_ids: string[];
    task_ids: string[];
  }[];
}
export interface VData {
  evidence_id: string;
  evidence_class: 'REAL' | 'SEED' | 'HYPOTHESIS' | 'JD';
  document_ref: string | null;
  segment_id: string | null;
  start: number | null;
  end: number | null;
  quote: string;
  quote_sha256: string;
  usage_scope: string;
  provenance: string;
  evidence_verification: 'UNVERIFIED' | 'JD_STATED' | 'HUMAN_VERIFIED';
  competency_ids: string[];
}
export interface GData {
  release_seq: number;
  version_label: string;
  run_id: string | null;
  policy: string;
  decided_by: string;
  changes: ChangeItem[];
  note?: string;
}
export interface Rec<D = any> extends Member {
  data: D;
  contentSha256: string;
  releaseId: string;
}
export interface Dictionary {
  releaseId: string | null;
  versionLabel: string;
  seq: number;
  members: Member[];
  C: Rec<CData>[];
  I: Rec<IData>[];
  W: Rec<WData>[];
  R: Rec<RData>[];
  /** Every framework version up to this release (older versions stay readable). */
  RAll: Rec<RData>[];
  V: Rec<VData>[];
  G: Rec<GData>[];
}

export const EMPTY_VERSION = '0.0';
export const versionLabelFor = (seq: number) => `1.${seq - 1}`;

export type ReleaseRow = typeof t.release.$inferSelect;
export async function latestRelease(db: DbOrTx, workspaceId: string): Promise<ReleaseRow | null> {
  const [r] = await db.select().from(t.release).where(eq(t.release.workspaceId, workspaceId)).orderBy(desc(t.release.seq)).limit(1);
  return r ?? null;
}
export async function getRelease(db: DbOrTx, releaseId: string): Promise<ReleaseRow | null> {
  const [r] = await db.select().from(t.release).where(eq(t.release.releaseId, releaseId)).limit(1);
  return r ?? null;
}
export async function listReleases(db: DbOrTx, workspaceId: string) {
  return db.select().from(t.release).where(eq(t.release.workspaceId, workspaceId)).orderBy(asc(t.release.seq));
}

export async function loadRecords(db: DbOrTx, workspaceId: string, members: Member[]): Promise<Rec[]> {
  if (!members.length) return [];
  const ids = [...new Set(members.map((m) => m.id))];
  const rows: (typeof t.dictRecord.$inferSelect)[] = [];
  for (let i = 0; i < ids.length; i += 500) rows.push(...(await db.select().from(t.dictRecord).where(and(eq(t.dictRecord.workspaceId, workspaceId), inArray(t.dictRecord.id, ids.slice(i, i + 500))))));
  const want = new Set(members.map((m) => `${m.kind}|${m.id}|${m.version}`));
  return rows.filter((r) => want.has(`${r.kind}|${r.id}|${r.version}`)).map((r) => ({ kind: r.kind as RecordKind, id: r.id, version: r.version, data: r.data, contentSha256: r.contentSha256, releaseId: r.releaseId }));
}

export async function loadDictionary(db: DbOrTx, workspaceId: string, releaseId: string | null): Promise<Dictionary> {
  const empty: Dictionary = { releaseId: null, versionLabel: EMPTY_VERSION, seq: 0, members: [], C: [], I: [], W: [], R: [], RAll: [], V: [], G: [] };
  if (!releaseId) return empty;
  const rel = await getRelease(db, releaseId);
  if (!rel || rel.workspaceId !== workspaceId) return empty;
  const members = rel.members as Member[];
  const recs = await loadRecords(db, workspaceId, members);
  const by = (k: RecordKind) => recs.filter((r) => r.kind === k).sort((a, b) => a.id.localeCompare(b.id));
  const R = by('R');
  let RAll: Rec<RData>[] = [];
  if (R.length) {
    const rows = await db.select().from(t.dictRecord).where(and(eq(t.dictRecord.workspaceId, workspaceId), eq(t.dictRecord.kind, 'R'), inArray(t.dictRecord.id, R.map((r) => r.id))));
    const max = new Map(R.map((r) => [r.id, r.version]));
    RAll = rows
      .filter((r) => r.version <= (max.get(r.id) ?? 0))
      .map((r) => ({ kind: 'R' as const, id: r.id, version: r.version, data: r.data as RData, contentSha256: r.contentSha256, releaseId: r.releaseId }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  }
  const C = by('C').sort((a, b) => String(a.data.display_code).localeCompare(String(b.data.display_code)));
  return { releaseId, versionLabel: rel.versionLabel, seq: rel.seq, members, C, I: by('I'), W: by('W'), R, RAll, V: by('V'), G: by('G').sort((a, b) => a.data.release_seq - b.data.release_seq) };
}

/** Record lookup for a locked reference (older versions included). */
export async function loadRecord(db: DbOrTx, workspaceId: string, kind: RecordKind, id: string, version: number): Promise<Rec | null> {
  const [r] = await db.select().from(t.dictRecord).where(and(eq(t.dictRecord.workspaceId, workspaceId), eq(t.dictRecord.kind, kind), eq(t.dictRecord.id, id), eq(t.dictRecord.version, version))).limit(1);
  return r ? { kind, id, version, data: r.data, contentSha256: r.contentSha256, releaseId: r.releaseId } : null;
}

/** Maps the registry into the simplified view the screens render. Frames resolve competency@version and indicator@version they locked. */
export async function toDictView(db: DbOrTx, workspaceId: string, d: Dictionary): Promise<DictView> {
  const cNow = new Map(d.C.map((c) => [c.id, c]));
  const indicatorsOf = (cid: string) => d.I.filter((i) => i.data.competency_id === cid).map((i) => i.data.statement);
  const lockedC = new Map<string, Rec<CData>>();
  const lockedI = new Map<string, Rec<IData>>();
  for (const f of d.RAll)
    for (const q of f.data.requirements) {
      const ck = `${q.competency_id}@${q.competency_version}`;
      if (!lockedC.has(ck)) {
        const cur = cNow.get(q.competency_id);
        const rec = cur && cur.version === q.competency_version ? cur : await loadRecord(db, workspaceId, 'C', q.competency_id, q.competency_version);
        if (rec) lockedC.set(ck, rec);
      }
      for (const ir of q.indicators) {
        const ik = `${ir.indicator_id}@${ir.version}`;
        if (!lockedI.has(ik)) {
          const cur = d.I.find((i) => i.id === ir.indicator_id && i.version === ir.version);
          const rec = cur ?? (await loadRecord(db, workspaceId, 'I', ir.indicator_id, ir.version));
          if (rec) lockedI.set(ik, rec);
        }
      }
    }
  return {
    version: d.versionLabel,
    W: d.W.map((w) => ({ id: w.id, role: w.data.role_title, tasks: w.data.tasks.map((k) => ({ id: k.task_id, name: k.statement, weight: k.weight, competencies: k.competency_ids })) })),
    C: d.C.map((c) => ({ id: c.id, name: c.data.label, group: c.data.group, definition: c.data.definition, version: c.version, indicators: indicatorsOf(c.id), aliases: c.data.aliases, status: c.data.status })),
    R: d.RAll.map((f) => ({
      id: f.id,
      version: f.data.version_label,
      role: f.data.role_title,
      purpose: f.data.purpose,
      evidence: f.data.evidence_scope,
      competencies: f.data.requirements.map((q) => {
        const c = lockedC.get(`${q.competency_id}@${q.competency_version}`);
        const ind = q.indicators.map((x) => lockedI.get(`${x.indicator_id}@${x.version}`)?.data.statement).filter(Boolean) as string[];
        return { id: q.competency_id, name: c?.data.label ?? q.competency_id, level: q.required_level, indicator: ind.length ? ind.join(' · ') : null, evidence: q.evidence_ids, weight: q.weight, version: q.competency_version };
      }),
    })),
    V: d.V.map((v) => ({ id: v.id, ...v.data })),
    G: d.G.map((g) => ({ version: g.data.version_label, run: g.data.release_seq, changes: g.data.changes, policy: g.data.policy, decided_by: g.data.decided_by, receipt: g.releaseId })),
  };
}

export async function workspaceIsEmpty(db: DbOrTx, workspaceId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.release).where(eq(t.release.workspaceId, workspaceId));
  return n === 0;
}
