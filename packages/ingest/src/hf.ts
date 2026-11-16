import { AppError } from '@cl/contract';
import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

/**
 * Hugging Face dataset import: the user pastes a dataset link, searches by job title and picks rows.
 * Only Hugging Face's public endpoints are called (the pasted link only supplies
 * the dataset id), and nothing about the user or the session is sent — the keyword is matched locally.
 */
const API = 'https://datasets-server.huggingface.co';
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
export interface HfColumns { title: string; org: string | null; body: { column: string; heading: string }[] }
export function detectColumns(names: string[]): HfColumns {
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const pick = (c: string[]) => c.map((x) => lower.get(x)).find(Boolean) ?? null;
  const title = pick(TITLE);
  const body = BODY.flatMap(([re, heading]) => names.filter((n) => re.test(n)).map((column) => ({ column, heading })));
  if (!title || !body.length) throw new AppError('HF_SCHEMA_UNSUPPORTED', `Dataset không có cột chức danh và cột mô tả nhận diện được. Các cột: ${names.join(', ')}.`, 422, { columns: names });
  return { title, org: pick(ORG), body };
}
const clean = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\r\n?/g, '\n').trim());
const EMPTY = /^(n\/?a|none|null|không( có| yêu cầu)?|-+)?$/i;
/** One dataset row → one JD document (plain text, original wording, only headings added). */
export function rowToJd(row: Record<string, unknown>, cols: HfColumns) {
  const title = clean(row[cols.title]);
  const org = cols.org ? clean(row[cols.org]) : '';
  const parts = cols.body.map((b) => ({ heading: b.heading, text: clean(row[b.column]) })).filter((p) => !EMPTY.test(p.text));
  const text = [`Mô tả công việc: ${title}${org ? ` — ${org}` : ''}`, ...parts.map((p) => `${p.heading}:\n${p.text}`)].join('\n\n');
  return { title, org, text };
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

interface Meta { dataset: string; config: string; split: string; columns: HfColumns; total: number | null; license: string | null }
const metaCache = new Map<string, { at: number; meta: Meta }>();
export async function datasetMeta(dataset: string): Promise<Meta> {
  const hit = metaCache.get(dataset);
  if (hit && Date.now() - hit.at < 600_000) return hit.meta;
  const info = await get(`${API}/info?dataset=${encodeURIComponent(dataset)}`);
  const configs = Object.keys(info.dataset_info ?? {});
  const config = configs.includes('default') ? 'default' : configs[0];
  if (!config) throw new AppError('HF_SCHEMA_UNSUPPORTED', 'Dataset chưa có bản xem dạng bảng trên Hugging Face.', 422);
  const ci = info.dataset_info[config];
  const splits = Object.keys(ci.splits ?? {});
  const split = splits.includes('train') ? 'train' : splits[0];
  const hub = await get(`${HUB}/${dataset}`).catch(() => null);
  const license = hub?.cardData?.license ?? null;
  const meta: Meta = { dataset, config, split, columns: detectColumns(Object.keys(ci.features ?? {})), total: ci.splits?.[split]?.num_examples ?? null, license: Array.isArray(license) ? license.join(', ') : license };
  metaCache.set(dataset, { at: Date.now(), meta });
  return meta;
}

export interface HfHit { row: number; title: string; org: string; text: string; chars: number; source_ref: string }

/**
 * Job titles of the whole split, read straight from the dataset's Parquet files (only that one column, by
 * HTTP range requests). This does not depend on Hugging Face's search/filter endpoints, which fail on their
 * own from time to time, and gives exact match counts. Kept in memory briefly, for at most two datasets.
 */
const titleCache = new Map<string, { at: number; titles: string[] }>();
async function allTitles(meta: Meta): Promise<string[]> {
  const hit = titleCache.get(meta.dataset);
  if (hit && Date.now() - hit.at < 900_000) return hit.titles;
  const list = await get(`${HUB}/${meta.dataset}/parquet`);
  const urls: string[] = list?.[meta.config]?.[meta.split] ?? [];
  if (!urls.length || urls.some((u) => !u.startsWith(`${HUB}/${meta.dataset}/parquet/`))) throw new AppError('HF_SCHEMA_UNSUPPORTED', 'Dataset chưa có bản Parquet công khai để đọc.', 422);
  const titles: string[] = [];
  try {
    for (const url of urls) {
      const file = await asyncBufferFromUrl({ url });
      const metadata = await parquetMetadataAsync(file);
      await parquetRead({ file, metadata, columns: [meta.columns.title], compressors, onComplete: (rows) => { for (const r of rows) titles.push(String(r[0] ?? '')); } });
    }
  } catch (e) {
    throw new AppError('HF_UNAVAILABLE', `Không đọc được file Parquet của dataset: ${e instanceof Error ? e.message : e}. Thử lại sau ít phút.`, 502, null, ['RETRY']);
  }
  if (titleCache.size >= 2) titleCache.delete([...titleCache.keys()][0]);
  titleCache.set(meta.dataset, { at: Date.now(), titles });
  return titles;
}
export async function datasetTitles(link: string) {
  const meta = await datasetMeta(parseDatasetId(link));
  return { meta, titles: await allTitles(meta) };
}
/** Accent- and case-insensitive form used to match Vietnamese typed with or without diacritics. */
export const foldTitle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

/** Full JD text of specific rows (the user's selection), read one by one from the public rows endpoint. */
export async function fetchRows(link: string, rows: number[]): Promise<HfHit[]> {
  const meta = await datasetMeta(parseDatasetId(link));
  const want = [...new Set(rows.filter((r) => Number.isInteger(r) && r >= 0))].slice(0, 50);
  const ds = `dataset=${encodeURIComponent(meta.dataset)}&config=${encodeURIComponent(meta.config)}&split=${encodeURIComponent(meta.split)}`;
  const hits: HfHit[] = [];
  for (let i = 0; i < want.length; i += 3) {
    const got = await Promise.all(want.slice(i, i + 3).map((idx) => get(`${API}/rows?${ds}&offset=${idx}&length=1`)));
    got.forEach((res, k) => {
      const r = res.rows?.[0];
      if (!r) return;
      const jd = rowToJd(r.row, meta.columns);
      const row = want[i + k];
      hits.push({ row, ...jd, chars: Array.from(jd.text).length, source_ref: `https://huggingface.co/datasets/${meta.dataset} · ${meta.split} · dòng ${row}` });
    });
  }
  return hits;
}
