import { readFileSync } from 'node:fs';
import { DEFAULT_AGENT_CONFIG, TASKS } from '@cl/agents';
import { getDb } from '@cl/db';
import { ANCHOR_THRESHOLDS, confirmJdSet, createRun, createSession, getDetail, recordMeasure, scoreE1, type AnchorSet } from '@cl/pipeline';
import { WS, arg, done, freshDb, realRunner, runBlocks } from './lib';

/**
 * pnpm anchor:eval --set=data/anchor/<file>.json [--record]
 * Runs B0–B1 (E1) of the anchor set through the REAL Claude CLI on the scratch database, scores scope accuracy and
 * P/R/F1 (formula 16) for tasks and competency candidates, prints them and, with --record, stores the measurement in
 * the main database so a failing configuration is locked (spec P1.2). Spends tokens: ≈ 1 E1 call per 4–5 JDs.
 */
async function main() {
  const file = arg('set', '');
  if (!file) throw new Error('Thiếu --set=<tệp bộ neo>');
  const set = JSON.parse(readFileSync(file, 'utf8')) as AnchorSet;
  // since 19/11/2026 the gold may come from a stronger model (pnpm anchor:label); it must differ from the model measured
  if (set.labelled_by.includes(DEFAULT_AGENT_CONFIG.tasks.E1.model)) throw new Error(`Nhãn của bộ neo do chính ${DEFAULT_AGENT_CONFIG.tasks.E1.model} gắn: không đo được model này trên nhãn của nó.`);
  const { runner, version } = await realRunner();
  const db = await freshDb();
  const { id } = await createSession(db, WS, { name: `Bộ neo ${set.id}`, role_title: set.role_title, purpose: set.purpose ?? 'Đo bộ neo', context: set.context ?? '', charter: { policy_id: 'dev-small' } }, 'anchor');
  await confirmJdSet(db, WS, id, set.jds.map((j) => ({ name: j.name, text: j.text, source_ref: j.source_ref ?? `anchor://${set.id}/${j.name}`, origin_group: set.id })), 'anchor');
  await createRun(db, WS, id, { acknowledge_send: true, cli_version: version }, 'anchor');
  await runBlocks(db, runner, id, 'B1');
  const b1 = (await getDetail(db, WS, id, 'B1')).raw as any;
  const pred = (b1.jds as any[]).map((j) => ({ name: j.name, verdict: j.verdict, tasks: (b1.extracted?.[j.ref]?.tasks ?? []).map((x: any) => x.statement), competencies: (b1.extracted?.[j.ref]?.competencies ?? []).map((x: any) => `${x.label} — ${x.definition}`) }));
  const score = scoreE1(set, pred);
  const passed = (score.scope_accuracy ?? 0) >= ANCHOR_THRESHOLDS.scope_accuracy && (score.tasks.f1 ?? 0) >= ANCHOR_THRESHOLDS.tasks_f1 && (score.competencies.f1 ?? 0) >= ANCHOR_THRESHOLDS.competencies_f1;
  console.log(JSON.stringify({ set: set.id, scope_accuracy: score.scope_accuracy, tasks: score.tasks, competencies: score.competencies, thresholds: ANCHOR_THRESHOLDS, passed }, null, 2));
  if (process.argv.includes('--record')) {
    const main = getDb(process.env.DATABASE_URL);
    const tm = DEFAULT_AGENT_CONFIG.tasks.E1;
    const mid = await recordMeasure(main, { taskId: TASKS.E1.id, model: tm.model, promptVersion: TASKS.E1.promptVersion, anchorSet: set.id, metrics: score as any, thresholds: ANCHOR_THRESHOLDS, passed, by: set.reviewed_by ?? set.labelled_by });
    console.log(`Đã ghi số đo ${mid}${passed ? '' : ' — E1 với cấu hình này sẽ bị khóa'}.`);
  }
  await done();
  process.exit(passed ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await done();
  process.exit(1);
});
