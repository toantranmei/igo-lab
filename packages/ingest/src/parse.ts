import { NORMALIZER_VERSION, SEGMENTER_VERSION, cpLength, detectLanguage, findPii, normalizeText, segmentText, sha256Hex, type PiiHit, type Segment } from './normalize';

export const PARSER_VERSION = 'parse-v1';
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'] as const;

export interface UploadLimits {
  maxFiles: number;
  maxFileMb: number;
  maxCharsPerDoc: number;
}
export function uploadLimits(env: Record<string, string | undefined> = process.env): UploadLimits {
  return { maxFiles: Number(env.MAX_FILES ?? 20), maxFileMb: Number(env.MAX_FILE_MB ?? 10), maxCharsPerDoc: Number(env.MAX_CHARS_PER_DOC ?? 60000) };
}

export type IngestWarningCode = 'EMPTY' | 'ENCODING' | 'PDF_NO_TEXT' | 'TOO_LONG' | 'UNSUPPORTED' | 'PARSE_ERROR' | 'DUPLICATE_BYTES' | 'DUPLICATE_TEXT' | 'NEAR_DUPLICATE' | 'PII' | 'MISSING_FIELD' | 'TOO_LARGE';
export interface IngestWarning {
  code: IngestWarningCode;
  severity: 'error' | 'warn' | 'info';
  message: string;
  ref?: string;
}

export interface ParsedDocument {
  original_name: string;
  source_kind: 'paste' | 'file';
  extension: string;
  blob_sha256: string | null;
  bytes: number;
  pages: number | null;
  normalized_text: string;
  content_sha256: string;
  chars: number;
  segments: Segment[];
  language: string;
  pii: PiiHit[];
  warnings: IngestWarning[];
  normalizer_version: string;
  parser_version: string;
  segmenter_version: string;
}

async function extract(name: string, bytes: Uint8Array): Promise<{ text: string; pages: number | null; warnings: IngestWarning[] }> {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  const warnings: IngestWarning[] = [];
  if (ext === '.txt' || ext === '.md') {
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { text, pages: null, warnings };
  }
  if (ext === '.pdf') {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text, totalPages } = await extractText(pdf, { mergePages: false });
      const pages = (Array.isArray(text) ? text : [text]).map((p) => p.trim());
      const joined = pages.filter(Boolean).join('\n\n');
      if (!joined.trim()) warnings.push({ code: 'PDF_NO_TEXT', severity: 'error', message: 'PDF không có lớp văn bản (có thể là bản scan). MVP không OCR; hãy dán nội dung hoặc tải bản có text.' });
      return { text: joined, pages: totalPages, warnings };
    } catch (e) {
      return { text: '', pages: null, warnings: [{ code: 'PARSE_ERROR', severity: 'error', message: 'Không đọc được PDF: ' + (e instanceof Error ? e.message : String(e)) }] };
    }
  }
  if (ext === '.docx') {
    try {
      const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
      const r = await (mammoth as { extractRawText(i: { buffer: Buffer }): Promise<{ value: string }> }).extractRawText({ buffer: Buffer.from(bytes) });
      return { text: r.value, pages: null, warnings };
    } catch (e) {
      return { text: '', pages: null, warnings: [{ code: 'PARSE_ERROR', severity: 'error', message: 'Không đọc được DOCX: ' + (e instanceof Error ? e.message : String(e)) }] };
    }
  }
  return { text: '', pages: null, warnings: [{ code: 'UNSUPPORTED', severity: 'error', message: `Định dạng ${ext || '(không rõ)'} chưa được hỗ trợ. Dùng .txt, .md, .pdf có text hoặc .docx.` }] };
}

function finish(name: string, kind: 'paste' | 'file', raw: string, bytes: Uint8Array | null, pages: number | null, warnings: IngestWarning[], limits: UploadLimits): ParsedDocument {
  const normalized_text = normalizeText(raw);
  const chars = cpLength(normalized_text);
  if (!normalized_text && !warnings.some((w) => w.severity === 'error')) warnings.push({ code: 'EMPTY', severity: 'error', message: 'Tài liệu rỗng sau khi trích văn bản.' });
  if (normalized_text.includes('�')) warnings.push({ code: 'ENCODING', severity: 'warn', message: 'Có ký tự không giải mã được (U+FFFD): kiểm tra mã hóa hoặc phông của file gốc.' });
  if (chars > limits.maxCharsPerDoc) warnings.push({ code: 'TOO_LONG', severity: 'error', message: `Văn bản dài ${chars} ký tự, vượt giới hạn ${limits.maxCharsPerDoc}.` });
  const pii = findPii(normalized_text);
  if (pii.length) warnings.push({ code: 'PII', severity: 'info', message: `Phát hiện ${pii.length} email/số điện thoại. Nên loại bỏ nếu không cần cho phân tích.` });
  return {
    original_name: name,
    source_kind: kind,
    extension: kind === 'paste' ? '' : name.toLowerCase().slice(name.lastIndexOf('.')),
    blob_sha256: bytes ? sha256Hex(bytes) : null,
    bytes: bytes ? bytes.byteLength : Buffer.byteLength(raw),
    pages,
    normalized_text,
    content_sha256: sha256Hex(normalized_text),
    chars,
    segments: segmentText(normalized_text),
    language: detectLanguage(normalized_text),
    pii,
    warnings,
    normalizer_version: NORMALIZER_VERSION,
    parser_version: PARSER_VERSION,
    segmenter_version: SEGMENTER_VERSION,
  };
}

export function parsePasted(name: string, text: string, limits = uploadLimits()): ParsedDocument {
  return finish(name || 'Bản dán', 'paste', text, null, null, [], limits);
}

export async function parseFile(name: string, bytes: Uint8Array, limits = uploadLimits()): Promise<ParsedDocument> {
  if (bytes.byteLength > limits.maxFileMb * 1024 * 1024) {
    return finish(name, 'file', '', bytes, null, [{ code: 'TOO_LARGE', severity: 'error', message: `File ${(bytes.byteLength / 1048576).toFixed(1)} MB vượt giới hạn ${limits.maxFileMb} MB.` }], limits);
  }
  const { text, pages, warnings } = await extract(name, bytes);
  return finish(name, 'file', text, bytes, pages, warnings, limits);
}

/** Cross-document checks inside one batch and against documents already stored in the workspace. */
export function crossCheck(docs: ParsedDocument[], existing: { ref: string; content_sha256: string; blob_sha256: string | null; text?: string }[] = [], nearThreshold = 0.85): IngestWarning[][] {
  return docs.map((d, i) => {
    const w: IngestWarning[] = [];
    const others = [...docs.slice(0, i).map((o, j) => ({ ref: `#${j + 1} ${o.original_name}`, content_sha256: o.content_sha256, blob_sha256: o.blob_sha256, text: o.normalized_text })), ...existing];
    for (const o of others) {
      if (d.blob_sha256 && o.blob_sha256 && d.blob_sha256 === o.blob_sha256) w.push({ code: 'DUPLICATE_BYTES', severity: 'warn', message: `Trùng byte với ${o.ref}.`, ref: o.ref });
      else if (d.content_sha256 === o.content_sha256 && d.normalized_text) w.push({ code: 'DUPLICATE_TEXT', severity: 'warn', message: `Trùng nội dung đã chuẩn hóa với ${o.ref}.`, ref: o.ref });
      else if (o.text && d.normalized_text) {
        const j = shingle(d.normalized_text, o.text);
        if (j >= nearThreshold) w.push({ code: 'NEAR_DUPLICATE', severity: 'info', message: `Gần trùng với ${o.ref} (Jaccard ${(j * 100).toFixed(0)}%). Đề xuất kiểm lại; không tự gộp.`, ref: o.ref });
      }
    }
    return w;
  });
}
import { shingleJaccard as shingle } from './normalize';
