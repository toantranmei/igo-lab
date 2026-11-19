import { AppError } from '@cl/contract';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { asyncBufferFromFile, parquetMetadataAsync, parquetRead, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

/**
 * Hugging Face datasets as a JD source. A dataset is downloaded once (its Parquet files, into the server's
 * data directory) and everything after that — listing titles, reading the rows the user picks — is local.
 * Only Hugging Face's public hub endpoints are called, the pasted link only supplies the dataset id, and
 * nothing about the user or the session is sent.
 */
const HUB = 'https://huggingface.co/api/datasets';
const ID = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;

export function parseDatasetId(input: string): string {
  const s = input.trim();
  const m = s.match(/^https?:\/\/(?:www\.)?huggingface\.co\/datasets\/([^/?#\s]+\/[^/?#\s]+)/i);
  const id = m ? m[1] : s;
  if (!ID.test(id)) throw new AppError('HF_LINK_INVALID', 'Link không phải dataset Hugging Face. Dạng đúng: https://huggingface.co/datasets/<tác giả>/<tên>.', 422);
  return id;
}

const TITLE = ['job_title', 'title', 'position', 'job_name', 'job_position'];
const ORG = ['company_name', 'company', 'employer', 'organization'];
const DATE = ['posted_date', 'date_posted', 'post_date', 'posting_date', 'published_at', 'publish_date', 'created_at', 'created_date', 'date'];
/** Columns that make up the JD text, in reading order, with the heading shown in the assembled document. */
const BODY: [RegExp, string][] = [
  [/^(job_)?description$|^responsibilit|^duties$/i, 'Mô tả công việc'],
  [/^requirements?(_text)?$|^job_requirements?$/i, 'Yêu cầu'],
  [/^qualifications?$/i, 'Trình độ'],
  [/^technical_skills?$|^skills?$/i, 'Kỹ năng chuyên môn'],
  [/^soft_skills?$/i, 'Kỹ năng mềm'],
  [/^experience(_required|_level)?$/i, 'Kinh nghiệm'],
  [/^languages?(_required)?$/i, 'Ngoại ngữ'],
];
export interface HfColumns { title: string; org: string | null; body: { column: string; heading: string }[]; date?: string | null }
export function detectColumns(names: string[]): HfColumns {
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const pick = (c: string[]) => c.map((x) => lower.get(x)).find(Boolean) ?? null;
  const title = pick(TITLE);
  const body = BODY.flatMap(([re, heading]) => names.filter((n) => re.test(n)).map((column) => ({ column, heading })));
  if (!title || !body.length) throw new AppError('HF_SCHEMA_UNSUPPORTED', `Dataset không có cột chức danh và cột mô tả nhận diện được. Các cột: ${names.join(', ')}.`, 422, { columns: names });
  return { title, org: pick(ORG), body, date: pick(DATE) };
}
const clean = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\r\n?/g, '\n').trim());
const EMPTY = /^(n\/?a|none|null|không( có| yêu cầu)?|-+)?$/i;
/** One dataset row → one JD document (plain text, original wording, only headings added). */
export function rowToJd(row: Record<string, unknown>, cols: HfColumns) {
  const title = clean(row[cols.title]);
  const org = cols.org ? clean(row[cols.org]) : '';
  const parts = cols.body.map((b) => ({ heading: b.heading, text: clean(row[b.column]) })).filter((p) => !EMPTY.test(p.text));
  const text = [`Mô tả công việc: ${title}${org ? ` — ${org}` : ''}`, ...parts.map((p) => `${p.heading}:\n${p.text}`)].join('\n\n');
  return { title, org, text, posted_at: cols.date ? toIsoDate(row[cols.date]) : null };
}
/** A dataset date (string, number or Date) as YYYY-MM-DD, or null when it cannot be read. */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : typeof v === 'number' || typeof v === 'bigint' ? new Date(Number(v) > 1e11 ? Number(v) : Number(v) * 1000) : new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function get(url: string): Promise<any> {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      const j: any = await r.json().catch(() => ({}));
      if (r.ok && !j.error) return j;
      last = j.error ?? `HTTP ${r.status}`;
      if (r.status === 404 || r.status === 401 || r.status === 403) break;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw new AppError('HF_UNAVAILABLE', `Hugging Face không trả dữ liệu: ${last}. Dataset phải công khai; nếu là lỗi tạm thời hãy thử lại sau ít phút.`, 502, null, ['RETRY']);
}

/** Where datasets live: DATA_DIR when absolute (Docker), otherwise <repo root>/data so web and worker agree. */
export function datasetsDir(): string {
  const env = process.env.DATA_DIR;
  if (env && path.isAbsolute(env)) return path.join(env, 'datasets');
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.join(dir, env ?? 'data', 'datasets');
    dir = path.dirname(dir);
  }
  return path.resolve(env ?? 'data', 'datasets');
}
const dirOf = (dataset: string) => path.join(datasetsDir(), parseDatasetId(dataset).replace('/', '__'));

export interface LocalDataset {
  dataset: string;
  config: string;
  split: string;
  /** Commit of the dataset repo at download time. */
  revision: string | null;
  license: string | null;
  files: { name: string; rows: number; bytes: number }[];
  rows: number;
  bytes: number;
  columns: HfColumns;
  downloaded_at: string;
}

/** Downloads the dataset's Parquet files (the hub's converted copy) and reads their schema. */
export async function downloadDataset(link: string, onProgress: (text: string) => Promise<unknown> | void = () => {}): Promise<LocalDataset> {
  const dataset = parseDatasetId(link);
  const hub = await get(`${HUB}/${dataset}`);
  if (hub.private || hub.gated) throw new AppError('HF_NOT_PUBLIC', 'Dataset này yêu cầu đăng nhập hoặc chấp nhận điều khoản trên Hugging Face; chỉ hỗ trợ dataset công khai.', 422);
  const listing = await get(`${HUB}/${dataset}/parquet`);
  const configs = Object.keys(listing ?? {});
  const config = configs.includes('default') ? 'default' : configs[0];
  const splits = Object.keys(listing?.[config] ?? {});
  const split = splits.includes('train') ? 'train' : splits[0];
  const urls: string[] = listing?.[config]?.[split] ?? [];
  if (!urls.length || urls.some((u) => !u.startsWith(`${HUB}/${dataset}/parquet/`))) throw new AppError('HF_SCHEMA_UNSUPPORTED', 'Dataset chưa có bản Parquet công khai để tải.', 422);
  const dir = dirOf(dataset);
  const tmp = `${dir}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;
  const files: LocalDataset['files'] = [];
  try {
    for (let i = 0; i < urls.length; i++) {
      const res = await fetch(urls[i]);
      if (!res.ok || !res.body) throw new AppError('HF_UNAVAILABLE', `Không tải được file ${i + 1}/${urls.length}: HTTP ${res.status}.`, 502, null, ['RETRY']);
      const total = Number(res.headers.get('content-length') ?? 0);
      let got = 0;
      let last = 0;
      const name = `${i}.parquet`;
      const body = Readable.fromWeb(res.body as any);
      body.on('data', (chunk: Buffer) => {
        got += chunk.length;
        if (Date.now() - last > 1500) {
          last = Date.now();
          void onProgress(`Đang tải file ${i + 1}/${urls.length}: ${mb(got)}${total ? ` / ${mb(total)}` : ''}`);
        }
      });
      await pipeline(body, createWriteStream(path.join(tmp, name)));
      files.push({ name, rows: 0, bytes: got });
    }
    await onProgress('Đang đọc cấu trúc dữ liệu…');
    let names: string[] = [];
    for (const f of files) {
      const md = await parquetMetadataAsync(await asyncBufferFromFile(path.join(tmp, f.name)));
      f.rows = Number(md.num_rows);
      names = md.schema.slice(1).map((c) => c.name);
    }
    const columns = detectColumns(names);
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
    const license = hub?.cardData?.license ?? null;
    return { dataset, config, split, revision: hub.sha ?? null, license: Array.isArray(license) ? license.join(', ') : license, files, rows: files.reduce((n, f) => n + f.rows, 0), bytes: files.reduce((n, f) => n + f.bytes, 0), columns, downloaded_at: new Date().toISOString() };
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    if (e instanceof AppError) throw e;
    throw new AppError('HF_UNAVAILABLE', `Tải dataset thất bại: ${e instanceof Error ? e.message : e}`, 502, null, ['RETRY']);
  }
}
export async function removeDataset(dataset: string) {
  await rm(dirOf(dataset), { recursive: true, force: true });
}
async function open(ds: LocalDataset, name: string) {
  const p = path.join(dirOf(ds.dataset), name);
  if (!(await stat(p).catch(() => null))) throw new AppError('DATASET_MISSING', `File của dataset ${ds.dataset} không còn trên máy chủ. Bấm "Cập nhật" để tải lại.`, 409, null, ['REDOWNLOAD']);
  return asyncBufferFromFile(p);
}

/** Every job title of the dataset, in row order. Kept in memory briefly, for at most two datasets. */
const titleCache = new Map<string, { at: number; titles: string[] }>();
export async function localTitles(ds: LocalDataset): Promise<string[]> {
  const key = `${ds.dataset}@${ds.downloaded_at}`;
  const hit = titleCache.get(key);
  if (hit && Date.now() - hit.at < 900_000) return hit.titles;
  const titles: string[] = [];
  for (const f of ds.files) {
    const file = await open(ds, f.name);
    await parquetRead({ file, columns: [ds.columns.title], compressors, onComplete: (rows) => { for (const r of rows) titles.push(String(r[0] ?? '')); } });
  }
  if (titleCache.size >= 2) titleCache.delete([...titleCache.keys()][0]);
  titleCache.set(key, { at: Date.now(), titles });
  return titles;
}
/** Accent- and case-insensitive form used to match Vietnamese typed with or without diacritics. */
export const foldTitle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

export interface HfHit { row: number; title: string; org: string; text: string; chars: number; source_ref: string; posted_at: string | null }
/** Full JD text of specific rows, read from the local copy. */
export async function localRows(ds: LocalDataset, rows: number[]): Promise<HfHit[]> {
  const want = [...new Set(rows.filter((r) => Number.isInteger(r) && r >= 0 && r < ds.rows))].slice(0, 200);
  const columns = [...new Set([ds.columns.title, ...(ds.columns.org ? [ds.columns.org] : []), ...(ds.columns.date ? [ds.columns.date] : []), ...ds.columns.body.map((b) => b.column)])];
  const hits: HfHit[] = [];
  for (const row of want) {
    let start = 0;
    const f = ds.files.find((x) => (row < start + x.rows ? true : ((start += x.rows), false)))!;
    const [rec] = await parquetReadObjects({ file: await open(ds, f.name), columns, rowStart: row - start, rowEnd: row - start + 1, compressors });
    if (!rec) continue;
    const jd = rowToJd(rec as Record<string, unknown>, ds.columns);
    hits.push({ row, ...jd, chars: Array.from(jd.text).length, source_ref: `https://huggingface.co/datasets/${ds.dataset}${ds.revision ? ` @${ds.revision.slice(0, 8)}` : ''} · ${ds.split} · dòng ${row}` });
  }
  return hits;
}
