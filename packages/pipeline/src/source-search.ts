import { asc, eq, sql } from 'drizzle-orm';
import { AppError, scrubPaths } from '@cl/contract';
import { DEFAULT_AGENT_CONFIG, runTask, type ClaudeCliRunner } from '@cl/agents';
import { newId, t, type Db } from '@cl/db';
import { downloadDataset, foldTitle, localRows, localTitles, parseDatasetId, removeDataset, type LocalDataset } from '@cl/ingest';
import { workerStatus } from './runtime';

/**
 * Public Hugging Face datasets as a JD source.
 *  - A dataset is downloaded once to the server (queued by web, done by the worker) and then chosen from a list.
 *  - Finding the JDs of a role: the user may name the role in Vietnamese or English and postings use either, so
 *      1. T14 (AI)  role → bilingual title keywords
 *      2. code      every title of the local copy is matched against the keywords (accent-insensitive)
 *      3. T15 (AI)  the distinct candidate titles are judged: is this posting really for that role?
 * The worker is the only process that calls the Claude CLI.
 */
const MAX_DISTINCT = 1200;
const BATCH = 120;
const MAX_HITS = 400;
const errOf = (e: any) => ({ code: e instanceof AppError ? e.code : 'INTERNAL', message: scrubPaths(String(e?.message ?? e)).slice(0, 500) });

// ---------- datasets ----------
const view = (d: typeof t.sourceDataset.$inferSelect) => {
  const i = d.info as LocalDataset | null;
  return { id: d.id, state: d.state, progress: d.progress, error: d.error as { code: string; message: string } | null, rows: i?.rows ?? null, bytes: i?.bytes ?? null, license: i?.license ?? null, revision: i?.revision ?? null, downloaded_at: i?.downloaded_at ?? null, columns: i ? [i.columns.title, ...(i.columns.org ? [i.columns.org] : []), ...i.columns.body.map((b) => b.column)] : [] };
};
export async function listDatasets(db: Db, workspaceId: string) {
  return (await db.select().from(t.sourceDataset).where(eq(t.sourceDataset.workspaceId, workspaceId)).orderBy(asc(t.sourceDataset.id))).map(view);
}
/** Queue a download (first time or "update"). The previous copy stays usable until the new one is complete. */
export async function queueDataset(db: Db, workspaceId: string, link: string, actor: string) {
  const id = parseDatasetId(link);
  const ws = await workerStatus(db);
  if (!ws.fresh) throw new AppError('WORKER_UNAVAILABLE', ws.message, 503, null, ['START_WORKER']);
  const now = new Date().toISOString();
  await db.insert(t.sourceDataset).values({ id, workspaceId, state: 'QUEUED', progress: 'Đang chờ worker…', createdBy: actor, updatedAt: now }).onConflictDoUpdate({ target: t.sourceDataset.id, set: { state: 'QUEUED', progress: 'Đang chờ worker…', error: null, lockedAt: null, updatedAt: now }, setWhere: sql`${t.sourceDataset.state} not in ('QUEUED', 'DOWNLOADING')` });
  return { id };
}
export async function deleteDataset(db: Db, workspaceId: string, id: string) {
  const [d] = await db.select().from(t.sourceDataset).where(eq(t.sourceDataset.id, id));
  if (!d || d.workspaceId !== workspaceId) throw new AppError('NOT_FOUND', 'Không tìm thấy dataset.', 404);
  if (d.state === 'DOWNLOADING') throw new AppError('BUSY', 'Dataset đang được tải; chờ xong rồi xóa.', 409);
  await removeDataset(id);
  await db.delete(t.sourceDataset).where(eq(t.sourceDataset.id, id));
}
async function ready(db: Db, workspaceId: string, id: string): Promise<LocalDataset> {
  const [d] = await db.select().from(t.sourceDataset).where(eq(t.sourceDataset.id, parseDatasetId(id)));
  if (!d || d.workspaceId !== workspaceId || !d.info) throw new AppError('DATASET_NOT_READY', 'Dataset chưa được tải về máy chủ. Tải về trước rồi mới quét.', 409, null, ['DOWNLOAD']);
  return d.info as LocalDataset;
}
export async function datasetRows(db: Db, workspaceId: string, id: string, rows: number[]) {
  return localRows(await ready(db, workspaceId, id), rows);
}
export async function processNextDataset(db: Db): Promise<boolean> {
  const job = await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`select id from source_dataset where state = 'QUEUED' or (state = 'DOWNLOADING' and locked_at < now() - interval '30 minutes') order by updated_at for update skip locked limit 1`)) as unknown as { id: string }[];
    if (!rows[0]) return null;
    await tx.update(t.sourceDataset).set({ state: 'DOWNLOADING', lockedAt: new Date().toISOString(), progress: 'Bắt đầu tải…' }).where(eq(t.sourceDataset.id, rows[0].id));
    return rows[0];
  });
  if (!job) return false;
  const set = (v: Partial<typeof t.sourceDataset.$inferInsert>) => db.update(t.sourceDataset).set({ ...v, updatedAt: new Date().toISOString() }).where(eq(t.sourceDataset.id, job.id));
  try {
    const info = await downloadDataset(job.id, (progress) => set({ progress }));
    await set({ state: 'READY', info, progress: '', error: null });
  } catch (e) {
    // a failed update keeps the previous copy (info) usable
    const [d] = await db.select().from(t.sourceDataset).where(eq(t.sourceDataset.id, job.id));
    await set({ state: d?.info ? 'READY' : 'FAILED', error: errOf(e), progress: '' });
  }
  return true;
}

// ---------- AI scan ----------
export interface SourceSearchResult {
  dataset: string;
  revision: string | null;
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
export async function createSourceSearch(db: Db, workspaceId: string, input: { dataset?: string; role?: string }, actor: string) {
  const ds = await ready(db, workspaceId, String(input.dataset ?? ''));
  const role = String(input.role ?? '').replace(/\s+/g, ' ').trim();
  if (role.length < 2 || role.length > 120) throw new AppError('VALIDATION', 'Nhập vị trí cần tìm (tiếng Việt hoặc tiếng Anh).', 422);
  const ws = await workerStatus(db);
  if (!ws.ok) throw new AppError('AGENT_CLI_UNAVAILABLE', ws.message, 503, null, ['START_WORKER']);
  const id = newId('src');
  await db.insert(t.sourceSearch).values({ id, workspaceId, dataset: ds.dataset, role, createdBy: actor, progress: 'Đang chờ worker…' });
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
    const ds = await ready(db, job.workspaceId, job.dataset);
    const status = await runner.status();
    const ctx = { db, runner, config: DEFAULT_AGENT_CONFIG, workspaceId: job.workspaceId, cliVersion: status.version };
    await say('AI đang sinh từ khóa chức danh tiếng Việt và tiếng Anh…');
    const { output: kw } = await runTask(ctx, 'T14', { role_title: job.role });
    const keywords = [...new Set([foldTitle(job.role), ...kw.keywords.map(foldTitle)])].filter((k) => k.length >= 3);
    await say(`Đang đọc ${ds.rows.toLocaleString('vi-VN')} chức danh của ${ds.dataset}…`);
    const titles = await localTitles(ds);

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
    const candidateRows = all.reduce((n, g) => n + g.rows.length, 0);
    const judged = all.slice(0, MAX_DISTINCT).map((g, i) => ({ id: `t${i + 1}`, ...g }));
    await say(`AI đang duyệt ${judged.length} chức danh khác nhau (${candidateRows} tin khớp từ khóa)…`);
    const batches: (typeof judged)[] = [];
    for (let i = 0; i < judged.length; i += BATCH) batches.push(judged.slice(i, i + BATCH));
    const verdicts = await Promise.all(batches.map((b) => runTask(ctx, 'T15', { role_title: job.role, titles: b.map((x) => ({ id: x.id, title: x.title })) })));
    const ok = new Set(verdicts.flatMap((v) => v.output.match_ids));
    const rows = judged.filter((x) => ok.has(x.id)).flatMap((g) => g.rows.map((row) => ({ row, title: g.title }))).sort((a, b) => a.row - b.row);
    const result: SourceSearchResult = { dataset: ds.dataset, revision: ds.revision, license: ds.license, dataset_rows: titles.length, keywords, candidate_titles: all.length, candidate_rows: candidateRows, judged_titles: judged.length, truncated: all.length > judged.length || rows.length > MAX_HITS, total_rows: rows.length, hits: rows.slice(0, MAX_HITS) };
    await db.update(t.sourceSearch).set({ state: 'DONE', result, progress: 'Xong.' }).where(eq(t.sourceSearch.id, job.id));
  } catch (e) {
    await db.update(t.sourceSearch).set({ state: 'FAILED', error: errOf(e), progress: '' }).where(eq(t.sourceSearch.id, job.id));
  }
  return true;
}
