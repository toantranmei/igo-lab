import { createHash } from 'node:crypto';

export const NORMALIZER_VERSION = 'norm-v1';
export const SEGMENTER_VERSION = 'seg-v1';

/** norm-v1: NFC, CRLF/CR → LF, strip trailing whitespace per line, collapse 3+ newlines to 2, trim. */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Code-point helpers: every published offset is a Unicode code-point index, half-open [start, end). */
export const codePoints = (s: string) => Array.from(s);
export const cpLength = (s: string) => codePoints(s).length;
export const cpSlice = (s: string, start: number, end: number) => codePoints(s).slice(start, end).join('');

export interface Segment {
  n: number;
  start: number;
  end: number;
  text: string;
  text_sha256: string;
}

const MAX_SEGMENT = 400;

/**
 * seg-v1: one segment per non-empty line (leading bullet markers stay inside the segment so offsets
 * remain exact); a line longer than 400 code points is split further after sentence terminators.
 */
export function segmentText(normalized: string): Segment[] {
  const cps = codePoints(normalized);
  const out: Segment[] = [];
  const push = (start: number, end: number) => {
    while (start < end && /\s/.test(cps[start])) start++;
    while (end > start && /\s/.test(cps[end - 1])) end--;
    if (end <= start) return;
    const text = cps.slice(start, end).join('');
    out.push({ n: out.length + 1, start, end, text, text_sha256: sha256Hex(text) });
  };
  let lineStart = 0;
  for (let i = 0; i <= cps.length; i++) {
    if (i === cps.length || cps[i] === '\n') {
      if (i - lineStart > MAX_SEGMENT) {
        let s = lineStart;
        for (let j = lineStart; j < i; j++) {
          const boundary = /[.!?;…]/.test(cps[j]) && (j + 1 === i || /\s/.test(cps[j + 1]));
          if (boundary && j + 1 - s >= 40) {
            push(s, j + 1);
            s = j + 1;
          }
        }
        push(s, i);
      } else push(lineStart, i);
      lineStart = i + 1;
    }
  }
  return out;
}

export const segmentId = (documentId: string, version: number, n: number) => `${documentId}@${version}#${n}`;
export function parseSegmentId(id: string): { documentId: string; version: number; n: number } | null {
  const m = /^(.+)@(\d+)#(\d+)$/.exec(id);
  return m ? { documentId: m[1], version: Number(m[2]), n: Number(m[3]) } : null;
}

/** Word 5-shingle Jaccard, used only to *suggest* a near-duplicate check. */
export function shingleJaccard(a: string, b: string, k = 5): number {
  const sh = (s: string) => {
    const w = s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + k <= w.length; i++) set.add(w.slice(i, i + k).join(' '));
    if (!set.size && w.length) set.add(w.join(' '));
    return set;
  };
  const A = sh(a), B = sh(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface PiiHit {
  kind: 'email' | 'phone';
  start: number;
  end: number;
  text: string;
}
/** Regex-only hints so the user can remove personal data before a run. Offsets are code points. */
export function findPii(normalized: string): PiiHit[] {
  const hits: PiiHit[] = [];
  const toCp = (utf16: number) => cpLength(normalized.slice(0, utf16));
  for (const m of normalized.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) hits.push({ kind: 'email', start: toCp(m.index!), end: toCp(m.index! + m[0].length), text: m[0] });
  for (const m of normalized.matchAll(/(?<![\w])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\w])/g)) hits.push({ kind: 'phone', start: toCp(m.index!), end: toCp(m.index! + m[0].length), text: m[0] });
  return hits.sort((a, b) => a.start - b.start);
}

export function detectLanguage(text: string): 'vi' | 'en' | 'unknown' {
  if (!text.trim()) return 'unknown';
  const vi = (text.match(/[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/gi) ?? []).length;
  return vi / Math.max(1, text.length) > 0.01 ? 'vi' : 'en';
}
