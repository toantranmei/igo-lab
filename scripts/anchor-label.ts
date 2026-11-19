import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { MODELS } from '@cl/agents';
import { t } from '@cl/db';
import { confirmJdSet, createRun, createSession, getDetail, type AnchorSet } from '@cl/pipeline';
import { WS, arg, done, freshDb, realRunner, runBlocks } from './lib';

/**
 * pnpm anchor:label --jds=<file.json> --role="Product Owner" [--id=po-50] [--purpose=…] [--context=…] [--out=data/anchor/<id>.json] [--dry]
 *
 * Builds the gold labels of an anchor set without human labelling (decision of 19/11/2026): people only supply the
 * JDs; a stronger model than the one being measured reads every JD with the SAME E1 task (prompt and schema) and its
 * answer becomes the gold for scope, tasks and competency candidates. Default labeller: Opus 5.5 at high effort, while
 * the pipeline's E1 runs on Haiku at low effort, so `pnpm anchor:eval` measures Haiku against Opus.
 *
 * Input: a JSON array of { name, text, source_ref?, posted_at? }. Runs B0–B1 on the scratch database with the REAL
 * Claude CLI (spends tokens: ≈ 1 call per 4–5 JDs). --dry prints what would be sent and stops before any call.
 */
async function main() {
  const file = arg('jds', '');
  const role = arg('role', '');
  if (!file || !role) throw new Error('Cần --jds=<tệp JSON> và --role="<chức danh>"');
  const jds = JSON.parse(readFileSync(file, 'utf8')) as { name: string; text: string; source_ref?: string; posted_at?: string }[];
  if (!Array.isArray(jds) || !jds.length || jds.some((j) => !j.name || !j.text?.trim())) throw new Error('Tệp JD phải là mảng { name, text } không rỗng.');
  const id = arg('id', `anchor-${new Date().toISOString().slice(0, 10)}`);
  const model = arg('model', MODELS.opus);
  const effort = arg('effort', 'high');
  const out = arg('out', path.join('data', 'anchor', `${id}.json`));
  console.log(`Gắn nhãn ${jds.length} JD cho "${role}" bằng ${model} (effort ${effort}) → ${out}`);
  if (process.argv.includes('--dry')) return void (await done());

  const { runner, version } = await realRunner();
  const db = await freshDb();
  const purpose = arg('purpose', 'Gắn nhãn bộ neo');
  const context = arg('context', '');
  const { id: sessionId } = await createSession(db, WS, { name: `Gắn nhãn ${id}`, role_title: role, purpose, context, charter: { policy_id: 'dev-small' } }, 'anchor');
  await confirmJdSet(db, WS, sessionId, jds.map((j) => ({ name: j.name, text: j.text, source_ref: j.source_ref ?? `anchor://${id}/${j.name}`, origin_group: id, posted_at: j.posted_at ?? null })), 'anchor');
  const run = await createRun(db, WS, sessionId, { acknowledge_send: true, cli_version: version }, 'anchor');
  // the labeller replaces E1 for this scratch run only
  const [r] = await db.select().from(t.run).where(eq(t.run.id, run.id));
  const snap = r.snapshot as any;
  await db.update(t.run).set({ snapshot: { ...snap, agent_config: { ...snap.agent_config, version: `${snap.agent_config.version}+label`, tasks: { ...snap.agent_config.tasks, E1: { model, effort } } } } }).where(eq(t.run.id, run.id));
  await runBlocks(db, runner, sessionId, 'B1');
  const b1 = (await getDetail(db, WS, sessionId, 'B1')).raw as any;
  const byName = new Map(jds.map((j) => [j.name, j]));
  const set: AnchorSet = {
    id,
    role_title: role,
    purpose,
    context,
    labelled_by: `${model} (effort ${effort}) · ${new Date().toISOString()}`,
    jds: (b1.jds as any[])
      // a JD the labeller did not read (duplicate, too old, empty after cutting) has no gold and is left out
      .filter((j) => j.parse_ok && !j.duplicate_of && !j.too_old && (j.verdict === 'OUT_OF_SCOPE' || b1.extracted?.[j.ref] !== undefined))
      .map((j) => ({
        name: j.name,
        text: byName.get(j.name)?.text ?? '',
        source_ref: byName.get(j.name)?.source_ref,
        gold: {
          verdict: j.verdict,
          tasks: (b1.extracted?.[j.ref]?.tasks ?? []).map((x: any) => x.statement),
          competencies: (b1.extracted?.[j.ref]?.competencies ?? []).map((x: any) => ({ label: x.label, definition: x.definition })),
        },
      })),
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(set, null, 2));
  const left = jds.length - set.jds.length;
  console.log(`Đã ghi ${set.jds.length} JD có nhãn${left ? ` (bỏ ${left} JD trùng, quá hạn hoặc không còn nội dung)` : ''}. Đo E1: pnpm anchor:eval --set=${out} --record`);
  await done();
}
main().catch(async (e) => {
  console.error(e);
  await done();
  process.exit(1);
});
