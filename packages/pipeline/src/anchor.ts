/**
 * Anchor set (spec §5.3): JDs with gold labels for scope, tasks and competency candidates. Since 19/11/2026 people
 * only supply the JDs; the gold comes from a stronger model than the one measured (`pnpm anchor:label`).
 * Precision, recall and F1 (white paper formula 16) per agent × model × prompt version; an agent whose latest
 * measurement is below its threshold is locked (P1.2) and the pipeline refuses to call it.
 */
import { and, desc, eq } from 'drizzle-orm';
import { AppError } from '@cl/contract';
import { TASKS, type TaskModel, type TaskName } from '@cl/agents';
import { newId, t, type Db } from '@cl/db';
import { textSimilarity } from './prep';

export interface AnchorJd {
  name: string;
  text: string;
  source_ref?: string;
  gold: { verdict: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'UNSURE'; tasks: string[]; competencies: { label: string; definition?: string }[] };
}
export interface AnchorSet {
  id: string;
  role_title: string;
  purpose?: string;
  context?: string;
  /** Who labelled it and when: a model id (e.g. claude-opus-5-5) or a person. */
  labelled_by: string;
  reviewed_by?: string;
  jds: AnchorJd[];
}

export interface Prf {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}
/** Formula (16): P = TP/(TP+FP), R = TP/(TP+FN), F1 = 2TP/(2TP+FP+FN); null when the denominator is 0. */
export function prf(tp: number, fp: number, fn: number): Prf {
  const r = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 10000 : null);
  return { tp, fp, fn, precision: r(tp, tp + fp), recall: r(tp, tp + fn), f1: r(2 * tp, 2 * tp + fp + fn) };
}
/**
 * One-to-one matching of predicted items to gold items by text similarity (greedy on the best pairs).
 * A pair counts as a true positive when its similarity reaches `threshold`.
 */
export function matchItems(gold: string[], pred: string[], threshold = 0.5): Prf & { pairs: [number, number, number][] } {
  const cand: [number, number, number][] = [];
  gold.forEach((g, i) => pred.forEach((p, j) => cand.push([i, j, textSimilarity(g, p)])));
  cand.sort((a, b) => b[2] - a[2]);
  const ug = new Set<number>(), up = new Set<number>();
  const pairs: [number, number, number][] = [];
  for (const [i, j, s] of cand) {
    if (s < threshold || ug.has(i) || up.has(j)) continue;
    ug.add(i);
    up.add(j);
    pairs.push([i, j, Math.round(s * 1000) / 1000]);
  }
  return { ...prf(pairs.length, pred.length - pairs.length, gold.length - pairs.length), pairs };
}

export interface E1Prediction {
  name: string;
  verdict: string;
  tasks: string[];
  competencies: string[];
}
/** E1 on the anchor set: scope accuracy and pooled P/R/F1 for tasks and competency candidates. */
export function scoreE1(set: AnchorSet, pred: E1Prediction[]) {
  let tp = { t: 0, c: 0 }, fp = { t: 0, c: 0 }, fn = { t: 0, c: 0 }, scopeOk = 0;
  const perJd = set.jds.map((g) => {
    const p = pred.find((x) => x.name === g.name) ?? { name: g.name, verdict: 'MISSING', tasks: [], competencies: [] };
    if (p.verdict === g.gold.verdict) scopeOk++;
    const mt = matchItems(g.gold.tasks, p.tasks);
    const mc = matchItems(g.gold.competencies.map((c) => c.label + (c.definition ? ` — ${c.definition}` : '')), p.competencies);
    tp.t += mt.tp, fp.t += mt.fp, fn.t += mt.fn, tp.c += mc.tp, fp.c += mc.fp, fn.c += mc.fn;
    return { name: g.name, scope_ok: p.verdict === g.gold.verdict, tasks: { tp: mt.tp, fp: mt.fp, fn: mt.fn }, competencies: { tp: mc.tp, fp: mc.fp, fn: mc.fn } };
  });
  return { scope_accuracy: set.jds.length ? Math.round((scopeOk / set.jds.length) * 10000) / 10000 : null, tasks: prf(tp.t, fp.t, fn.t), competencies: prf(tp.c, fp.c, fn.c), per_jd: perJd };
}

/** Default acceptance thresholds; the product owner fixes the final ones before the P1 acceptance run (spec §5.4.3). */
export const ANCHOR_THRESHOLDS = { scope_accuracy: 0.9, tasks_f1: 0.7, competencies_f1: 0.6 };

export async function recordMeasure(db: Db, m: { taskId: string; model: string; promptVersion: string; anchorSet: string; metrics: Record<string, unknown>; thresholds: Record<string, number>; passed: boolean; by: string }) {
  const id = newId('msr');
  await db.insert(t.agentMeasure).values({ id, taskId: m.taskId, model: m.model, promptVersion: m.promptVersion, anchorSet: m.anchorSet, metrics: m.metrics, thresholds: m.thresholds, passed: m.passed, measuredBy: m.by });
  return id;
}

/** Latest measurement of an agent configuration, or null when it was never measured. */
export async function latestMeasure(db: Db, taskId: string, tm: TaskModel, promptVersion: string) {
  const [r] = await db.select().from(t.agentMeasure).where(and(eq(t.agentMeasure.taskId, taskId), eq(t.agentMeasure.model, tm.model), eq(t.agentMeasure.promptVersion, promptVersion))).orderBy(desc(t.agentMeasure.measuredAt)).limit(1);
  return r ?? null;
}

/**
 * P1.2: an agent whose latest anchor measurement failed is locked. A configuration that was never measured runs
 * (the anchor set does not exist yet); the run screen shows it as "chưa đo trên bộ neo".
 */
export async function assertAgentsUnlocked(db: Db, tasks: TaskName[], config: { tasks: Record<string, TaskModel> }) {
  for (const name of tasks) {
    const task = TASKS[name];
    const m = await latestMeasure(db, task.id, config.tasks[name], task.promptVersion);
    if (m && !m.passed) throw new AppError('AGENT_LOCKED', `${task.id} (${config.tasks[name]?.model ?? '—'}, prompt ${task.promptVersion}) bị khóa: lần đo gần nhất trên bộ neo "${m.anchorSet}" chưa đạt ngưỡng.`, 409, { task_id: task.id, measure_id: m.id, metrics: m.metrics, thresholds: m.thresholds }, ['OPEN_STEP']);
  }
}
