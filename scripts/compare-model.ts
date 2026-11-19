import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { MODELS, type TaskName } from '@cl/agents';
import { t } from '@cl/db';
import { confirmJdSet, createRun, createSession, getDetail } from '@cl/pipeline';
import { APP_URL, OWNER_URL, WS, arg, done, freshDb, realRunner, runBlocks } from './lib';

/**
 * pnpm compare:model --session=<dev session id> --task=E6 --models=sonnet,haiku [--source-url=http://127.0.0.1:3100]
 *
 * Runs the JD set of a dev session once per model of one task on the scratch database (competence_lab_test) with the
 * REAL Claude CLI, and prints quality and cost side by side: retranslation pass rate of the indicators (27), Fleiss κ
 * (28), final coverage (B7), calls and API-equivalent cost of each block. The agent answers stored in the dev database
 * are copied first, so only the calls whose input changes with the model are made (spends tokens: usually E6–E8).
 */
const DEV_OWNER = process.env.DEV_DATABASE_OWNER_URL ?? 'postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab';
async function main() {
  const sessionId = arg('session', '');
  const task = arg('task', 'E6') as TaskName;
  const models = arg('models', 'sonnet,haiku').split(',').map((m) => (MODELS as Record<string, string>)[m.trim()] ?? m.trim());
  const base = arg('source-url', 'http://127.0.0.1:3100');
  if (!sessionId) throw new Error('Cần --session=<id phiên trong DB phát triển>');
  const info = (await (await fetch(`${base}/api/sessions/${sessionId}`)).json()) as any;
  const docs = (info.jd_set?.documents ?? []) as { name: string; text: string; source_ref: string; origin_group: string; posted_at: string }[];
  if (!docs.length) throw new Error('Phiên không có bộ JD.');
  // the session's own charter, context and industry: they are part of the agents' cache keys
  const dev = postgres(DEV_OWNER, { max: 1, onnotice: () => {} });
  const [srow] = await dev`select role_title, purpose, context, family, industry, charter from session where id = ${sessionId}`;
  await dev.end();
  if (!srow) throw new Error(`Không thấy phiên ${sessionId} trong DB phát triển.`);
  const { root_session_id: _r, audit_sampled: _a, ...charter } = (srow.charter ?? {}) as Record<string, unknown>;
  const { runner, version } = await realRunner();
  const rows: Record<string, unknown>[] = [];
  for (const model of models) {
    const db = await freshDb();
    // stored answers of the dev database: identical inputs are not sent again
    const src = postgres(DEV_OWNER, { max: 1, onnotice: () => {} });
    const dst = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
    const cached = await src`select * from agent_result`;
    for (const r of cached) await dst`insert into agent_result ${dst(r as any)} on conflict do nothing`;
    await src.end();
    await dst.end();
    const { id } = await createSession(db, WS, { name: `So sánh ${task} · ${model}`, role_title: srow.role_title, purpose: srow.purpose, context: srow.context ?? '', family: srow.family ?? undefined, industry: srow.industry ?? undefined, charter: structuredClone(charter) } as any, 'compare');
    await confirmJdSet(db, WS, id, docs.map((d) => ({ name: d.name, text: d.text, source_ref: d.source_ref, origin_group: d.origin_group, posted_at: d.posted_at || null })), 'compare');
    const run = await createRun(db, WS, id, { acknowledge_send: true, cli_version: version }, 'compare');
    const [r] = await db.select().from(t.run).where(eq(t.run.id, run.id));
    const snap = r.snapshot as any;
    await db.update(t.run).set({ snapshot: { ...snap, agent_config: { ...snap.agent_config, version: `${snap.agent_config.version}+${task}=${model}`, tasks: { ...snap.agent_config.tasks, [task]: { ...snap.agent_config.tasks[task], model } } } } }).where(eq(t.run.id, run.id));
    console.log(`\n=== ${task} = ${model}`);
    let rep: Awaited<ReturnType<typeof runBlocks>> = [];
    try {
      rep = await runBlocks(db, runner, id, 'B8');
    } catch (e) {
      console.log(`(dừng: ${(e as Error).message})`);
    }
    const b6 = (await getDetail(db, WS, id, 'B6').catch(() => null))?.raw as any;
    const b7 = (await getDetail(db, WS, id, 'B7').catch(() => null)) as any;
    const calls = await db.select().from(t.agentCall);
    const inds = (b6?.indicators ?? []) as any[];
    rows.push({
      model,
      reached: rep.at(-1)?.block,
      state: rep.at(-1)?.state,
      indicators: inds.length,
      pass_rate: inds.length ? Math.round((inds.filter((x) => x.pass).length / inds.length) * 1000) / 1000 : null,
      fleiss: b6?.fleiss?.kappa ?? null,
      competencies_passed: b6?.passed?.length ?? b6?.selected?.length ?? null,
      final_coverage: b7?.raw?.final_coverage ?? b7?.gates?.find((g: any) => g.gate_id === 'B7.G3')?.actual ?? null,
      new_calls: calls.filter((c) => !c.cacheHit).length,
      usd: Math.round(calls.reduce((a, c) => a + (c.costUsd ?? 0), 0) * 10000) / 10000,
      usd_task: Math.round(calls.filter((c) => c.taskId.startsWith(task)).reduce((a, c) => a + (c.costUsd ?? 0), 0) * 10000) / 10000,
    });
  }
  console.log('\n' + JSON.stringify(rows, null, 2));
  await done();
}
main().catch(async (e) => {
  console.error(e);
  await done();
  process.exit(1);
});
void APP_URL;
