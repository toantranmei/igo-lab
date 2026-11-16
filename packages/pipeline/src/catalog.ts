import { and, eq } from 'drizzle-orm';
import { t, type Db } from '@cl/db';
import { latestRelease, loadDictionary } from '@cl/registry';
import { currentRun } from './sessions';
import type { RunSnapshot } from './types';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

/**
 * The published workspace dictionary in the shape the catalog explorer renders
 * (roles ↔ competencies, cross-industry matrix, role comparison). Weights come straight from the
 * published frameworks; score inputs are absent because Live has no importance/criticality formula yet.
 */
export async function liveCatalog(db: Db, workspaceId: string, sessionId: string | null) {
  const run = sessionId ? await currentRun(db, sessionId) : null;
  const latest = await latestRelease(db, workspaceId);
  const [mine] = run ? await db.select().from(t.release).where(and(eq(t.release.workspaceId, workspaceId), eq(t.release.runId, run.id))) : [];
  const releaseId = mine?.releaseId ?? (run ? (run.snapshot as RunSnapshot).base_release_id : latest?.releaseId ?? null);
  const d = await loadDictionary(db, workspaceId, releaseId);
  const cIds = new Set(d.C.map((c) => c.id));
  const frames = d.R.map((f) => ({ ...f, reqs: f.data.requirements.filter((q) => cIds.has(q.competency_id)) }));
  const famName = (f: (typeof frames)[number]) => f.data.family?.trim() || 'Chưa phân nhóm';
  const indName = (f: (typeof frames)[number]) => f.data.industry?.trim() || 'Chưa xác định ngành';
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  return {
    version: d.versionLabel,
    origin: 'live' as const,
    families: uniq(frames.map(famName)).map((name) => ({ id: slug(name), name, synthetic: false })),
    industries: uniq(frames.map(indName)).map((name) => ({ id: slug(name), name, codeSystem: 'UNVERIFIED', note: 'Người dùng nhập khi tạo phiên' })),
    competencies: d.C.map((c) => ({ id: c.id, name: c.data.label, group: 'PRO', version: c.version, definition: c.data.definition, synthetic: false, code: c.data.display_code })),
    roles: frames.map((f) => ({ id: f.data.role_id, name: f.data.role_title, family: slug(famName(f)), grade: '', contexts: [slug(indName(f))], skills: f.reqs.map((q) => q.competency_id), synthetic: false })),
    profiles: frames.map((f) => ({
      id: f.id,
      role: f.data.role_id,
      industry: slug(indName(f)),
      version: f.data.version_label,
      type: 'live',
      context: null,
      base: f.id,
      requirements: f.reqs.map((q) => ({ id: q.competency_id, level: q.required_level, frequency: 0, core: false, evidence: q.evidence_ids, weight: q.weight ?? 0, score: 0 })),
      sources: [],
      synthetic: false,
      requirementsView: 'live',
      overrides: [],
      derivedFromRole: null,
    })),
  };
}
