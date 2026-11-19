/**
 * P1 code steps that run before any AI call (spec §5.1, §5.2a). All deterministic and cheap:
 * K1 near-duplicate JDs, K2 masking of personal data, K3 short codes, K5 text pre-clustering,
 * K6 long-tail cut (in blocks-b), K7 generic sentences, K8 sections that do not describe the job,
 * plus packing of items into calls under a size budget.
 */
import type { LoadedDoc, SnapSegment } from './types';

const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ K1 · near-duplicate JDs (formula 4) */

/** Word 3-gram shingles of a text. */
export function shingles(text: string, n = 3): Set<string> {
  const w = norm(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (w.length < n) {
    if (w.length) out.add(w.join(' '));
    return out;
  }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export const NEAR_DUP_THRESHOLD = 0.85;
/** For each doc, the earlier doc it nearly duplicates (J ≥ threshold), with J. Exact hash matches give J = 1. */
export function nearDuplicates(docs: { ref: string; text: string; content_sha256: string }[], threshold = NEAR_DUP_THRESHOLD) {
  const sh = docs.map((d) => shingles(d.text));
  const out = new Map<string, { of: string; j: number }>();
  docs.forEach((d, i) => {
    for (let k = 0; k < i; k++) {
      if (out.has(docs[k].ref)) continue; // compare with originals only
      const j = d.content_sha256 === docs[k].content_sha256 ? 1 : jaccard(sh[i], sh[k]);
      if (j >= threshold) {
        out.set(d.ref, { of: docs[k].ref, j: Math.round(j * 10000) / 10000 });
        break;
      }
    }
  });
  return out;
}

/* ------------------------------------------------------------------ K2 · personal data masking */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?<![\p{L}\p{N}])\(?(?:\+?84|0)\)?[\s.-]?\(?\d{1,3}\)?(?:[\s.-]?\d){6,9}(?![\p{N}])/gu;
const URLISH = /(?<![\p{L}\p{N}])(?:https?:\/\/|www\.)\S+/giu;
const HONOR = '(?:[Aa]nh|[Cc]hị|[Ôô]ng|[Bb]à|[Cc]ô|[Cc]hú|[Ee]m|M[Rr]s?\\.?|M[Ss]\\.?)';
const NAME = "\\p{Lu}[\\p{L}'.-]*(?:\\s+\\p{Lu}[\\p{L}'.-]*){0,4}";
/** Contact keyword (any case), then an optional honorific + capitalised name before or after the colon. */
const CONTACT_KEY = /(?<![\p{L}\p{N}])((?:người\s+)?(?:liên\s*hệ|phụ\s*trách\s*tuyển\s*dụng|người\s*phụ\s*trách|contact(?:\s*person)?|hr|recruiter))/giu;
const NAME_AFTER = new RegExp(`^(\\s*(?:${HONOR}\\s+)?)(${NAME})?(\\s*[:：-]\\s*)(?:(${HONOR}\\s+)?(${NAME}))?`, 'u');
/** Honorific + capitalised name anywhere (e.g. "Anh Nguyễn Văn An (HR)"). */
const HONOR_NAME = new RegExp(`(?<![\\p{L}\\p{N}])${HONOR}\\s+${NAME}`, 'gu');
export function maskPII(text: string): { text: string; hits: number } {
  let hits = 0;
  const count = (r: string) => (hits++, r);
  let t = text
    .replace(EMAIL, () => count('[email]'))
    .replace(PHONE, () => count('[số điện thoại]'))
    .replace(URLISH, () => count('[liên kết]'));
  // after each contact keyword, mask a name written before or after the colon
  let out = '';
  let last = 0;
  for (const m of t.matchAll(CONTACT_KEY)) {
    const end = m.index! + m[0].length;
    if (end < last) continue;
    const n = NAME_AFTER.exec(t.slice(end));
    out += t.slice(last, end);
    last = end;
    if (!n || (!n[2] && !n[5])) continue;
    out += `${n[1]}${n[2] ? count('[người liên hệ]') : ''}${n[3]}${n[5] ? count('[người liên hệ]') : ''}`;
    last = end + n[0].length;
  }
  t = out + t.slice(last);
  t = t.replace(HONOR_NAME, () => count('[người]'));
  return { text: t, hits };
}

/* ------------------------------------------------------------------ K7 · generic sentences */

/** Sentences that describe no particular work. Configurable through policy.generic_patterns (regex sources). */
export const GENERIC_PATTERNS = [
  'các công việc khác (theo|do) (yêu cầu|sự phân công|cấp trên)',
  'thực hiện (các )?(nhiệm vụ|công việc) khác',
  'theo sự phân công của',
  'other (duties|tasks) as (assigned|required)',
  'any other (duties|tasks)',
];
export const isGeneric = (text: string, patterns = GENERIC_PATTERNS) => patterns.some((p) => new RegExp(p, 'iu').test(text));

/* ------------------------------------------------------------------ K8 · sections that do not describe the job */

const OFF = /^(?:[-•*#\s\d.)]*)(quyền lợi|phúc lợi|chế độ đãi ngộ|đãi ngộ|thu nhập|mức lương|benefits?|perks|what we offer|chúng tôi cung cấp|về chúng tôi|giới thiệu (về )?công ty|about (us|the company)|who we are|cách (thức )?ứng tuyển|hồ sơ (ứng tuyển|bao gồm)|how to apply|nộp hồ sơ|địa (chỉ|điểm) làm việc|location|thời gian làm việc|working (hours|time)|thông tin liên hệ|liên hệ)\b[^.]{0,60}:?\s*$/iu;
const ON = /^(?:[-•*#\s\d.)]*)(mô tả công việc|nhiệm vụ|trách nhiệm|công việc chính|yêu cầu|tiêu chuẩn|kỹ năng|năng lực|job description|responsibilities|duties|requirements|qualifications|skills|what you will do|your role)\b[^.]{0,60}:?\s*$/iu;
/**
 * Marks segments under headings such as benefits, company introduction, how to apply or address, until the next
 * job heading. The cut segments are kept (and stay traceable); they are only left out of what AI reads.
 */
export function offJobSegments(segments: SnapSegment[]): Set<string> {
  const off = new Set<string>();
  let inOff = false;
  // a heading is short: ends with ":" or has at most 5 words ("Liên hệ đối tác để thống nhất…" is a task, not a heading)
  const heading = (t: string) => t.length <= 60 && (t.endsWith(':') || t.split(/\s+/).length <= 5);
  for (const s of segments) {
    const t = s.text.trim();
    if (ON.test(t) && (heading(t) || /^(mô tả công việc|job description)\b/i.test(t))) inOff = false;
    else if (heading(t) && OFF.test(t)) inOff = true;
    if (inOff) off.add(s.id);
  }
  return off;
}

/* ------------------------------------------------------------------ K3 · short codes */

/** Long ids ↔ short codes used inside one call (s1, t1, k1, c1, d1…). */
export class ShortIds {
  private toShort = new Map<string, string>();
  private toLong = new Map<string, string>();
  private n = new Map<string, number>();
  short(prefix: string, long: string): string {
    const key = `${prefix}|${long}`;
    let s = this.toShort.get(key);
    if (!s) {
      const k = (this.n.get(prefix) ?? 0) + 1;
      this.n.set(prefix, k);
      s = `${prefix}${k}`;
      this.toShort.set(key, s);
      this.toLong.set(s, long);
    }
    return s;
  }
  long(short: string): string | undefined {
    return this.toLong.get(short);
  }
  longs(shorts: string[]): string[] {
    return shorts.map((x) => this.toLong.get(x)).filter((x): x is string => !!x);
  }
}

/** What AI may read of a JD: masked text, without off-job sections and generic sentences. */
export interface PreparedDoc {
  doc: LoadedDoc;
  /** Segments sent to AI, masked. */
  segments: { id: string; text: string }[];
  cut_off_job: string[];
  cut_generic: string[];
  masked: number;
}
export function prepareDoc(doc: LoadedDoc, opts: { generic?: string[] } = {}): PreparedDoc {
  const off = offJobSegments(doc.segments);
  const segments: { id: string; text: string }[] = [];
  const cut_generic: string[] = [];
  let masked = 0;
  for (const s of doc.segments) {
    if (off.has(s.id)) continue;
    if (isGeneric(s.text, opts.generic)) {
      cut_generic.push(s.id);
      continue;
    }
    const m = maskPII(s.text);
    masked += m.hits;
    segments.push({ id: s.id, text: m.text });
  }
  return { doc, segments, cut_off_job: [...off], cut_generic, masked };
}
/** "s12 <text>" lines with short segment codes. */
export const linesOf = (segments: { id: string; text: string }[], ids: ShortIds) => segments.map((s) => `${ids.short('s', s.id)} ${s.text.replace(/\s+/g, ' ').trim()}`).join('\n');
/** Masked text of one segment for agent inputs that send segments as objects. */
export const maskedText = (text: string) => maskPII(text).text;

/* ------------------------------------------------------------------ packing */

/** Characters of user input per call: ≈ 6 000 tokens with the 1.6 chars/token measured, minus room for the frame. */
export const BATCH_CHARS = () => Number(process.env.AGENT_BATCH_CHARS || 7000);
/** Groups items in order into batches whose size stays under `budget` characters (an oversize item gets its own batch). */
export function pack<T>(items: T[], size: (x: T) => number, budget = BATCH_CHARS(), maxItems = Infinity): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let n = 0;
  for (const x of items) {
    const k = size(x);
    if (cur.length && (n + k > budget || cur.length >= maxItems)) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(x);
    n += k;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ K5 · text pre-clustering */

const trigrams = (s: string) => {
  const p = `  ${norm(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
};
export const textSimilarity = (a: string, b: string) => jaccard(trigrams(a), trigrams(b));
export const PRECLUSTER_THRESHOLD = 0.8;
/**
 * Greedy single-pass clustering: identical normalised text always joins; otherwise an item joins the first cluster
 * whose first member is at least `threshold` similar (character trigrams). Order is the input order, so it is stable.
 */
export function precluster<T extends { id: string }>(items: T[], text: (x: T) => string, threshold = PRECLUSTER_THRESHOLD): T[][] {
  const clusters: { head: Set<string>; key: string; members: T[] }[] = [];
  const byKey = new Map<string, number>();
  for (const x of items) {
    const key = norm(text(x));
    const exact = byKey.get(key);
    if (exact !== undefined) {
      clusters[exact].members.push(x);
      continue;
    }
    const tg = trigrams(text(x));
    const k = clusters.findIndex((c) => jaccard(c.head, tg) >= threshold);
    if (k >= 0) clusters[k].members.push(x);
    else {
      byKey.set(key, clusters.length);
      clusters.push({ head: tg, key, members: [x] });
    }
  }
  return clusters.map((c) => c.members);
}
