/**
 * Occupation anchoring for B2 (white paper §5.3, gate G2): the Vietnamese occupation list (VSCO 2020, QĐ 34/2020/QĐ-TTg)
 * and the external standard O*NET, joined through ISCO-08 (data/reference, built by scripts/reference/build-reference.ts).
 * Code shortlists occupations from the role title and the task statements; E23 picks one VN code and 1–4 O*NET
 * occupations from that shortlist only; code checks the pick and takes the O*NET tasks with their Importance.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface VscoRow { code: string; level: number; title_vi: string; parent_code: string | null; isco08: string | null; isco08_note?: string }
interface OnetTask { task_id: number; statement: string; importance: number | null; relevance: number | null; type: string }
interface OnetOcc { onet_soc: string; title: string; description: string; tasks: OnetTask[] }
interface CrossRow { isco08: string; isco08_title: string | null; onet: { onet_soc: string; title: string; direct: boolean; esco_support: number }[] }
export interface ReferenceData {
  vsco: VscoRow[];
  onet: Map<string, OnetOcc>;
  cross: Map<string, CrossRow>;
  versions: { vsco: string; onet: string; crosswalk: string };
  attribution: string;
}

let cache: ReferenceData | null | undefined;
/** Finds data/reference upward from the working directory (tests run at the root, the worker in apps/worker). */
function referenceDir(): string | null {
  if (process.env.REFERENCE_DIR) return process.env.REFERENCE_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'data', 'reference');
    if (existsSync(path.join(p, 'vsco2020.json'))) return p;
    dir = path.dirname(dir);
  }
  return null;
}
export function loadReference(): ReferenceData | null {
  if (cache !== undefined) return cache;
  const dir = referenceDir();
  if (!dir) return (cache = null);
  const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const v = read('vsco2020.json');
  const o = read('onet.json');
  const c = read('isco08_onet.json');
  cache = {
    vsco: v.rows,
    onet: new Map((o.occupations as OnetOcc[]).map((x) => [x.onet_soc, x])),
    cross: new Map((c.crosswalk as CrossRow[]).map((x) => [x.isco08, x])),
    versions: { vsco: `QĐ 34/2020/QĐ-TTg (tải ${v.meta?.retrieved ?? '?'})`, onet: `O*NET ${o.meta?.onet_version ?? '?'}`, crosswalk: String(c.meta?.source ?? 'ESCO → O*NET-SOC') },
    attribution: String(o.meta?.attribution ?? ''),
  };
  return cache;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const STOP = new Set(['va', 'cac', 'cua', 'cho', 'voi', 'trong', 'nguoi', 'nhan', 'vien', 'khac', 'nghe', 'chua', 'duoc', 'phan', 'loai', 'and', 'or', 'of', 'the', 'to', 'in', 'for', 'with', 'all', 'other', 'workers', 'a', 'an', 'on', 'by', 'as', 'at', 'from', 'such']);
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

/**
 * The level-4 VN list as compact lines "code title" for E23, sent with the first E23 call of a run only. Titles are
 * written without diacritics (≈ 23k ASCII characters, ≈ 7k real tokens instead of ≈ 12k); the stored title keeps them.
 */
export function catalogLines(ref: ReferenceData): string {
  return ref.vsco.filter((r) => r.level === 4).map((r) => `${r.code} ${fold(r.title_vi)}`).join('\n');
}
export const CATALOG_CHARS = 23000;

export interface OccupationAnchor {
  vn_code: string;
  title_vi: string;
  isco08: string | null;
  isco08_note: string | null;
  external: { onet_soc: string; title: string; reason: string }[];
}
/**
 * From the VN code E23 picked: its ISCO-08 group, then up to `k` O*NET occupations linked to that group, ranked by a
 * direct ISCO link, ESCO support and word overlap with the role title and task statements. Null for an unknown code.
 */
export function anchorOccupation(ref: ReferenceData, vnCode: string, roleTitle: string, statements: string[], k = 2): OccupationAnchor | null {
  const row = ref.vsco.find((r) => r.code === vnCode && r.level >= 4);
  if (!row) return null;
  const role = new Set(words(roleTitle));
  const taskW = new Map<string, number>();
  for (const st of statements) for (const w of new Set(words(st))) taskW.set(w, (taskW.get(w) ?? 0) + 1);
  const overlap = (text: string) => [...new Set(words(text))].reduce((s, w) => s + (role.has(w) ? 3 : 0) + (taskW.get(w) ?? 0) / Math.max(1, statements.length), 0);
  const links = (row.isco08 ? ref.cross.get(row.isco08)?.onet ?? [] : []).filter((x) => ref.onet.get(x.onet_soc)?.tasks.some((t) => t.importance !== null));
  const ranked = links
    .map((x) => ({ x, s: (x.direct ? 2 : 0) + Math.min(x.esco_support, 5) * 0.2 + overlap(`${x.title} ${ref.onet.get(x.onet_soc)!.description}`) * 0.3 }))
    .sort((a, b) => b.s - a.s || a.x.onet_soc.localeCompare(b.x.onet_soc))
    .slice(0, k);
  return {
    vn_code: row.code,
    title_vi: row.title_vi,
    isco08: row.isco08,
    isco08_note: row.isco08_note ?? null,
    external: ranked.map(({ x }) => ({ onet_soc: x.onet_soc, title: x.title, reason: `ISCO-08 ${row.isco08} → O*NET ${x.direct ? 'liên kết trực tiếp' : `qua ${x.esco_support} nghề ESCO`}` })),
  };
}

/** O*NET tasks of the chosen occupations, Core first, by Importance (IM, 1–5), at most `max`. */
export function externalTasks(ref: ReferenceData, onetSocs: string[], max = 20) {
  const all = onetSocs.flatMap((soc) => (ref.onet.get(soc)?.tasks ?? []).filter((t) => t.importance !== null).map((t) => ({ ref: `onet:${soc}#${t.task_id}`, onet_soc: soc, statement: t.statement, importance: t.importance as number, type: t.type })));
  return all.sort((a, b) => (a.type === 'Core' ? 0 : 1) - (b.type === 'Core' ? 0 : 1) || b.importance - a.importance || a.ref.localeCompare(b.ref)).slice(0, max);
}
