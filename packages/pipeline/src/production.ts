/**
 * P5 · batch production (white paper 6.7, 6.8, formula 43): the production catalogue, derived frameworks that inherit
 * from a root, batch audit sampling, dictionary quality, periodic review and operating metrics. Read side mostly.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AppError, MAIN_BLOCK_IDS } from '@cl/contract';
import { newId, t, type Db } from '@cl/db';
import { latestRelease, listReleases, loadDictionary } from '@cl/registry';
import { createSession, currentRun, getSession } from './sessions';
import { runUsage } from './runs';
import { seedOf, seededShuffle } from './formulas';
import { textSimilarity } from './prep';
import type { Charter } from './types';

export interface BatchItemInput {
  role_title: string;
  level?: string;
  industry?: string;
  framework_type: 'ROOT' | 'DERIVED_LEVEL' | 'INDUSTRY_VARIANT';
  /** Index (in this batch) of the root an item derives from; or an existing root session. */
  root_index?: number;
  root_session_id?: string;
  /** Per-item session fields; a root's own outcomes, owner and decision go in `charter` (a derived item inherits the root's). */
  purpose?: string;
  context?: string;
  family?: string;
  charter?: Charter;
}

/**
 * P5.1–P5.2, P5.4: creates one session per item. A derived item inherits the root's charter (policy, outcomes, owner,
 * family) and points at the root session; E8 audits every root and a random fifth (at least one) of the derived items.
 */
export async function createBatch(db: Db, workspaceId: string, input: { name: string; purpose: string; items: BatchItemInput[]; charter?: Charter }, actor: string) {
  if (!input.items?.length) throw new AppError('VALIDATION', 'Lô cần ít nhất một khung.', 422);
  // validate the whole batch before creating anything, so a bad item cannot leave half a batch behind
  for (const [i, x] of input.items.entries()) {
    if (!x.role_title?.trim()) throw new AppError('VALIDATION', `Khung ${i + 1}: thiếu vị trí.`, 422);
    if (!['ROOT', 'DERIVED_LEVEL', 'INDUSTRY_VARIANT'].includes(x.framework_type)) throw new AppError('VALIDATION', `Khung ${i + 1}: loại khung không hợp lệ.`, 422);
    if (x.framework_type === 'ROOT') continue;
    if (x.root_index != null) {
      if (!Number.isInteger(x.root_index) || x.root_index < 0 || x.root_index >= input.items.length || input.items[x.root_index].framework_type !== 'ROOT') throw new AppError('VALIDATION', `Khung ${i + 1}: root_index phải trỏ tới một khung gốc của lô.`, 422);
    } else if (x.root_session_id) {
      const root = await getSession(db, workspaceId, x.root_session_id);
      if (((root.charter ?? {}) as Charter).framework_type && ((root.charter ?? {}) as Charter).framework_type !== 'ROOT') throw new AppError('VALIDATION', `Khung ${i + 1}: phiên gốc không phải khung gốc.`, 422);
    } else throw new AppError('VALIDATION', `Khung ${i + 1} là phái sinh nhưng chưa chỉ khung gốc.`, 422);
  }
  const batchId = newId('bat');
  const derived = input.items.map((x, i) => ({ x, i })).filter(({ x }) => x.framework_type !== 'ROOT');
  const sampled = new Set(seededShuffle(derived.map((d) => d.i), seedOf(batchId)).slice(0, derived.length ? Math.max(1, Math.ceil(derived.length / 5)) : 0));
  const sessionOf: (string | null)[] = [];
  // roots first, so derived items can point at them
  const order = [...input.items.keys()].sort((a, b) => Number(input.items[a].framework_type !== 'ROOT') - Number(input.items[b].framework_type !== 'ROOT'));
  for (const i of order) {
    const x = input.items[i];
    let rootSid = x.root_session_id ?? (x.root_index != null ? sessionOf[x.root_index] ?? null : null);
    if (x.framework_type !== 'ROOT' && !rootSid) throw new AppError('VALIDATION', `Khung "${x.role_title}" là phái sinh nhưng chưa chỉ khung gốc.`, 422);
    const root = rootSid ? await getSession(db, workspaceId, rootSid) : null;
    const rc = (root?.charter ?? {}) as Charter;
    const charter: Charter = { ...(input.charter ?? {}), ...(x.charter ?? {}), ...(root ? { policy_id: rc.policy_id, outcomes: rc.outcomes, owner: rc.owner, decision: rc.decision } : {}), level: x.level, framework_type: x.framework_type, ...(root ? { root_session_id: root.id, audit_sampled: sampled.has(i) } : {}) };
    const { id } = await createSession(db, workspaceId, { name: `${input.name} · ${x.role_title}${x.level ? ` · ${x.level}` : ''}${x.industry ? ` · ${x.industry}` : ''}`, role_title: x.role_title, purpose: x.purpose ?? input.purpose, context: x.context, family: x.family ?? root?.family ?? undefined, industry: x.industry ?? root?.industry ?? undefined, charter }, actor, { internal: true });
    sessionOf[i] = id;
    await db.insert(t.productionItem).values({ id: newId('pit'), workspaceId, batchId, roleTitle: x.role_title, level: x.level ?? null, industry: x.industry ?? null, frameworkType: x.framework_type, rootItemId: null, sessionId: id, auditSampled: x.framework_type === 'ROOT' || sampled.has(i), createdBy: actor });
  }
  return { batch_id: batchId, sessions: sessionOf };
}

/** P5.4: when one framework of a batch fails its audit (G7), every framework of the batch is audited. */
export async function escalateBatchAudit(db: Db, workspaceId: string, sessionId: string) {
  const [item] = await db.select().from(t.productionItem).where(and(eq(t.productionItem.workspaceId, workspaceId), eq(t.productionItem.sessionId, sessionId)));
  if (!item) return 0;
  const items = await db.select().from(t.productionItem).where(and(eq(t.productionItem.workspaceId, workspaceId), eq(t.productionItem.batchId, item.batchId)));
  const off = items.filter((x) => !x.auditSampled && x.sessionId);
  for (const x of off) {
    const s = await getSession(db, workspaceId, x.sessionId!);
    await db.update(t.session).set({ charter: { ...((s.charter ?? {}) as Charter), audit_sampled: true } }).where(eq(t.session.id, s.id));
  }
  if (off.length) await db.update(t.productionItem).set({ auditSampled: true }).where(inArray(t.productionItem.id, off.map((x) => x.id)));
  // frameworks that already passed B7 without the audit must run B7 again: their B7/B8 results go stale and the
  // unpublished candidate is withdrawn; published ones are reported so a review run can be created
  const published: string[] = [];
  for (const x of off) {
    const run = await currentRun(db, x.sessionId!);
    if (!run) continue;
    if (run.status === 'COMPLETE') {
      published.push(x.sessionId!);
      continue;
    }
    await db.update(t.blockAttempt).set({ status: 'STALE' }).where(and(eq(t.blockAttempt.runId, run.id), eq(t.blockAttempt.current, true), inArray(t.blockAttempt.block, ['B7', 'B8'])));
    await db.update(t.candidate).set({ status: 'SUPERSEDED' }).where(and(eq(t.candidate.runId, run.id), eq(t.candidate.status, 'READY')));
  }
  return off.length;
}

/** P5.1 / P5.7 catalogue with each item's state and its operating figures. */
export async function listProduction(db: Db, workspaceId: string) {
  const items = await db.select().from(t.productionItem).where(eq(t.productionItem.workspaceId, workspaceId)).orderBy(desc(t.productionItem.createdAt));
  const out = [];
  for (const it of items) {
    const run = it.sessionId ? await currentRun(db, it.sessionId) : null;
    const m = run ? await runMetrics(db, workspaceId, run.id) : null;
    out.push({ id: it.id, batch_id: it.batchId, role_title: it.roleTitle, level: it.level, industry: it.industry, framework_type: it.frameworkType, session_id: it.sessionId, audit_sampled: it.auditSampled, run_no: run?.runNo ?? null, ...(m ?? {}) });
  }
  return out;
}

/** P5.7 operating metrics of one run. */
export async function runMetrics(db: Db, workspaceId: string, runId: string) {
  const atts = await db.select({ block: t.blockAttempt.block, attemptNo: t.blockAttempt.attemptNo, status: t.blockAttempt.status, current: t.blockAttempt.current, startedAt: t.blockAttempt.startedAt, finishedAt: t.blockAttempt.finishedAt, output: t.blockAttempt.output }).from(t.blockAttempt).where(eq(t.blockAttempt.runId, runId));
  const cur = (b: string) => atts.find((a) => a.block === b && a.current);
  const starts = atts.map((a) => a.startedAt).filter(Boolean).map((x) => Date.parse(x!));
  const b8 = cur('B8');
  const done = MAIN_BLOCK_IDS.filter((b) => cur(b)?.status === 'DONE').length;
  const firstPass = MAIN_BLOCK_IDS.filter((b) => atts.some((a) => a.block === b && a.attemptNo === 1 && a.status === 'DONE')).length;
  const b3 = cur('B3')?.output as any, b6 = cur('B6')?.output as any, o8 = b8?.output as any;
  const c = b3?.counts ?? {};
  const totalC = (c.REUSE ?? 0) + (c.UPDATE ?? 0) + (c.ADD ?? 0) + (c.NEEDS_REVIEW ?? 0);
  const round1 = ((b6?.indicators ?? []) as any[]).filter((x) => x.round === 1).length + (b6?.rewritten ?? 0);
  const round1Pass = ((b6?.indicators ?? []) as any[]).filter((x) => x.round === 1 && x.pass).length;
  const usage = await runUsage(db, workspaceId, runId).catch(() => null);
  return {
    steps_done: done,
    cycle_ms: starts.length && b8?.finishedAt ? Date.parse(b8.finishedAt) - Math.min(...starts) : null,
    reuse_rate: totalC ? Math.round(((c.REUSE ?? 0) + (c.UPDATE ?? 0)) / totalC * 1000) / 1000 : null,
    overlap_with_root: o8?.overlap_with_root ?? null,
    g6_first_pass: round1 ? Math.round((round1Pass / round1) * 1000) / 1000 : null,
    gates_first_pass: `${firstPass}/${MAIN_BLOCK_IDS.length}`,
    deviations: (o8?.deviations ?? []).length,
    tier: o8?.tier ?? null,
    review_date: o8?.review_date ?? null,
    tokens: usage?.total.total ?? 0,
    cost_usd: usage?.total.cost_usd ?? 0,
    inherited_indicators: b6?.inherited ?? 0,
  };
}

/**
 * P5.5 dictionary quality (quarterly): Distinct (near-synonym pairs), Coverage (used by a framework), Clear and
 * measurable (definition length, indicators at each level), Evidenced (has a V record), Stable (no S/D change
 * across the last four releases).
 */
export async function dictionaryQuality(db: Db, workspaceId: string) {
  const latest = await latestRelease(db, workspaceId);
  if (!latest) return null;
  const d = await loadDictionary(db, workspaceId, latest.releaseId);
  const active = d.C.filter((c) => (c.data.status ?? 'ACTIVE') !== 'DEPRECATED');
  const pairs: { a: string; b: string; similarity: number }[] = [];
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const sim = textSimilarity(`${active[i].data.label} ${active[i].data.definition}`, `${active[j].data.label} ${active[j].data.definition}`);
      if (sim >= 0.6) pairs.push({ a: active[i].data.label, b: active[j].data.label, similarity: Math.round(sim * 1000) / 1000 });
    }
  const used = new Set(d.R.flatMap((r) => r.data.requirements.map((q) => q.competency_id)));
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const clear = active.filter((c) => {
    const n = words(c.data.definition);
    const lv = (L: string) => d.I.filter((i) => i.data.competency_id === c.id && i.data.level === L).length;
    return n >= 6 && n <= 40 && ['1', '3', '5'].every((L) => lv(L) >= 2);
  });
  const evidenced = new Set(d.V.flatMap((v) => ((v.data as any).competency_ids ?? []) as string[]));
  const releases = (await listReleases(db, workspaceId)).slice(-4);
  const unstable = new Set(releases.flatMap((r) => (((r.diff as any).changes ?? []) as any[]).filter((c) => c.entity === 'C' && (c.change_types ?? []).some((x: string) => x === 'S' || x === 'D')).map((c) => c.id)));
  const share = (n: number) => (active.length ? Math.round((n / active.length) * 1000) / 1000 : null);
  return {
    version: latest.versionLabel,
    competencies: active.length,
    distinct: { score: share(active.length - new Set(pairs.flatMap((p) => [p.a, p.b])).size), near_pairs: pairs.slice(0, 50) },
    coverage: { score: share(active.filter((c) => used.has(c.id)).length), unused: active.filter((c) => !used.has(c.id)).map((c) => c.data.label) },
    clear: { score: share(clear.length) },
    evidenced: { score: share(active.filter((c) => evidenced.has(c.id)).length) },
    stable: { score: share(active.filter((c) => !unstable.has(c.id)).length), changed_recently: [...unstable].length },
  };
}

/** P5.6: frameworks whose review date (36) falls within `days`. */
export async function reviewsDue(db: Db, workspaceId: string, days = 30) {
  const latest = await latestRelease(db, workspaceId);
  if (!latest) return [];
  const d = await loadDictionary(db, workspaceId, latest.releaseId);
  const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return d.R.filter((r) => r.data.review_date && r.data.review_date <= limit).map((r) => ({ framework_id: r.id, role_title: r.data.role_title, version_label: r.data.version_label, review_date: r.data.review_date, session_id: r.data.session_id, owner: r.data.owner ?? null, overdue: r.data.review_date! < new Date().toISOString().slice(0, 10) }));
}
