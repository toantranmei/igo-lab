import { eq, sql } from 'drizzle-orm';
import { AppError, scrubPaths } from '@cl/contract';
import { DEFAULT_AGENT_CONFIG, runTask, type ClaudeCliRunner } from '@cl/agents';
import { newId, t, type Db } from '@cl/db';
import { datasetTitles, foldTitle, parseDatasetId } from '@cl/ingest';
import { workerStatus } from './runtime';

/**
 * AI-assisted scan of a public Hugging Face dataset for JDs of one role.
 * The user may name the role in Vietnamese or English and the postings may use either language, so:
 *   1. T14 (AI)  role → bilingual title keywords
 *   2. code      every title of the dataset is matched against the keywords (accent-insensitive)
 *   3. T15 (AI)  the distinct candidate titles are judged: is this posting really for that role?
 * Web only queues the scan; the worker — the one process allowed to call the Claude CLI — runs it.
 */
const MAX_DISTINCT = 1200;
const BATCH = 120;
const MAX_HITS = 400;

export interface SourceSearchResult {
  dataset: string;
  license: string | null;
  dataset_rows: number;
  keywords: string[];
  candidate_titles: number;
  candidate_rows: number;
  judged_titles: number;
  truncated: boolean;
  total_rows: number;
  hits: { row: number; title: string }[];
}

export async function createSourceSearch(db: Db, workspaceId: string, input: { link?: string; role?: string }, actor: string) {
  const dataset = parseDatasetId(String(input.link ?? ''));
  const role = String(input.role ?? '').replace(/\s+/g, ' ').trim();
  if (role.length < 2 || role.length > 120) throw new AppError('VALIDATION', 'Nhập vị trí cần tìm (tiếng Việt hoặc tiếng Anh).', 422);
  const ws = await workerStatus(db);
  if (!ws.ok) throw new AppError('AGENT_CLI_UNAVAILABLE', ws.message, 503, null, ['START_WORKER']);
  const id = newId('src');
  await db.insert(t.sourceSearch).values({ id, workspaceId, dataset, role, createdBy: actor, progress: 'Đang chờ worker…' });
  return { id };
}
export async function getSourceSearch(db: Db, workspaceId: string, id: string) {
  const [s] = await db.select().from(t.sourceSearch).where(eq(t.sourceSearch.id, id));
  if (!s || s.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không tìm thấy lượt quét.', 404);
  return { id: s.id, dataset: s.dataset, role: s.role, state: s.state, progress: s.progress, result: s.result as SourceSearchResult | null, error: s.error as { code: string; message: string } | null };
}

export async function processNextSourceSearch(db: Db, runner: ClaudeCliRunner): Promise<boolean> {
  const job = await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`select id from source_search where state = 'QUEUED' or (state = 'RUNNING' and locked_at < now() - interval '15 minutes') order by created_at for update skip locked limit 1`)) as unknown as { id: string }[];
    if (!rows[0]) return null;
    await tx.update(t.sourceSearch).set({ state: 'RUNNING', lockedAt: new Date().toISOString() }).where(eq(t.sourceSearch.id, rows[0].id));
    const [s] = await tx.select().from(t.sourceSearch).where(eq(t.sourceSearch.id, rows[0].id));
    return s;
  });
  if (!job) return false;
  const say = (progress: string) => db.update(t.sourceSearch).set({ progress }).where(eq(t.sourceSearch.id, job.id));
  try {
    const status = await runner.status();
    const ctx = { db, runner, config: DEFAULT_AGENT_CONFIG, workspaceId: job.workspaceId, cliVersion: status.version };
    await say('AI đang sinh từ khóa chức danh tiếng Việt và tiếng Anh…');
    const { output: kw } = await runTask(ctx, 'T14', { role_title: job.role });
    const keywords = [...new Set([foldTitle(job.role), ...kw.keywords.map(foldTitle)])].filter((k) => k.length >= 3);
    await say(`Đang tải cột chức danh của ${job.dataset}…`);
    const { meta, titles } = await datasetTitles(job.dataset);

    // code: candidate rows by keyword, grouped by identical (folded) title so each wording is judged once
    const groups = new Map<string, { title: string; rows: number[] }>();
    for (let i = 0; i < titles.length; i++) {
      const f = foldTitle(titles[i]);
      if (!f || !keywords.some((k) => f.includes(k))) continue;
      const g = groups.get(f);
      if (g) g.rows.push(i);
      else groups.set(f, { title: titles[i].replace(/\s+/g, ' ').trim().slice(0, 200), rows: [i] });
    }
    const all = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.rows[0] - b.rows[0]);
    const judged = all.slice(0, MAX_DISTINCT).map((g, i) => ({ id: `t${i + 1}`, ...g }));
    await say(`AI đang duyệt ${judged.length} chức danh khác nhau (${all.reduce((n, g) => n + g.rows.length, 0)} tin khớp từ khóa)…`);
    const batches: (typeof judged)[] = [];
    for (let i = 0; i < judged.length; i += BATCH) batches.push(judged.slice(i, i + BATCH));
    const verdicts = await Promise.all(batches.map((b) => runTask(ctx, 'T15', { role_title: job.role, titles: b.map((x) => ({ id: x.id, title: x.title })) })));
    const ok = new Set(verdicts.flatMap((v) => v.output.match_ids));
    const matched = judged.filter((x) => ok.has(x.id));
    const rows = matched.flatMap((g) => g.rows.map((row) => ({ row, title: g.title }))).sort((a, b) => a.row - b.row);
    const result: SourceSearchResult = {
      dataset: meta.dataset,
      license: meta.license,
      dataset_rows: titles.length,
      keywords,
      candidate_titles: all.length,
      candidate_rows: all.reduce((n, g) => n + g.rows.length, 0),
      judged_titles: judged.length,
      truncated: all.length > judged.length || rows.length > MAX_HITS,
      total_rows: rows.length,
      hits: rows.slice(0, MAX_HITS),
    };
    await db.update(t.sourceSearch).set({ state: 'DONE', result, progress: 'Xong.' }).where(eq(t.sourceSearch.id, job.id));
  } catch (e: any) {
    const error = { code: e instanceof AppError ? e.code : 'INTERNAL', message: scrubPaths(String(e?.message ?? e)).slice(0, 500) };
    await db.update(t.sourceSearch).set({ state: 'FAILED', error, progress: '' }).where(eq(t.sourceSearch.id, job.id));
  }
  return true;
}
