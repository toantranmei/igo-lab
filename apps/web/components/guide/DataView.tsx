'use client';
import type { ReactNode } from 'react';

/** Vietnamese captions for well-known record fields (same wording as the reference viewer). */
const LABELS: Record<string, string> = {
  id: 'Mã bản ghi',
  text: 'Nội dung JD',
  role: 'Vai trò',
  source: 'Địa chỉ nguồn',
  origin: 'Nguồn gốc seed',
  industry: 'Bối cảnh ngành',
  synthetic: 'Dữ liệu tổng hợp',
  skills: 'Nhãn concept có sẵn trong seed',
  skillStatements: 'Câu nhiệm vụ ↔ nhãn concept',
  concept: 'Khái niệm',
  name: 'Tên',
  weight: 'Trọng số thiết kế',
  ratings: 'Ba rating seed',
  ratingBasis: 'Căn cứ thiết kế rating',
  situation: 'Tình huống',
  action: 'Hành động',
  outcome: 'Sản phẩm công việc / kết quả seed',
  type: 'Loại bằng chứng',
  evidence: 'ID nguồn được nối vào C',
  level: 'Bậc yêu cầu trên R',
  indicator: 'Chỉ báo hành vi',
  version: 'Phiên bản',
  votes: 'Phiếu gán nhãn seed',
  agreement: 'Tỷ lệ phiếu khớp',
  approvedLessons: 'Lesson an toàn được nạp',
  minJD: 'Số JD tối thiểu',
  minCoverage: 'Coverage tối thiểu',
  minAgreement: 'Agreement tối thiểu',
  AIOnly: 'Toàn bộ block B do AI',
  writeCoreStep: 'Cửa ghi lõi',
  definition: 'Định nghĩa C',
  indicators: 'Chỉ báo',
  safe: 'Đã được đánh dấu an toàn',
};
const ORDER = ['text', 'situation', 'action', 'outcome', 'ratings', 'ratingBasis', 'skills', 'skillStatements', 'weight', 'concept', 'indicator', 'source', 'id'];
const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : 100);

/** Plain-text rendering of any scalar or structured value. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Đúng' : 'Sai';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

interface Props {
  value: unknown;
  /** Keys of records that can be opened from a chip. */
  recordKeys?: ReadonlySet<string>;
  onPickRecord?: (key: string) => void;
}

/** Generic, escaped renderer for record payloads: objects as field lists, arrays as chips. */
export default function DataView({ value, recordKeys, onPickRecord }: Props): ReactNode {
  if (value === null || value === undefined) return <span className="trace-empty">Chưa có</span>;
  if (typeof value === 'boolean') return value ? 'Đúng' : 'Sai';
  if (Array.isArray(value)) {
    if (!value.length) return <span className="trace-empty">∅ · danh sách rỗng</span>;
    return (
      <div className="trace-array">
        {value.map((x: unknown, i) => {
          if (x !== null && typeof x === 'object') {
            const id = (x as { id?: unknown }).id;
            return (
              <details key={i} open={value.length < 4}>
                <summary>
                  Bản ghi {i + 1}
                  {typeof id === 'string' || typeof id === 'number' ? ` · ${id}` : ''}
                </summary>
                <DataView value={x} recordKeys={recordKeys} onPickRecord={onPickRecord} />
              </details>
            );
          }
          const s = showValue(x);
          return (
            <span key={i}>
              {recordKeys?.has(s) && onPickRecord ? (
                <button type="button" data-trace-record={s} onClick={() => onPickRecord(s)}>
                  {s}
                </button>
              ) : (
                s
              )}
            </span>
          );
        })}
      </div>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !k.startsWith('_'))
      .sort(([a], [b]) => rank(a) - rank(b));
    if (!entries.length) return <span className="trace-empty">∅ · không có trường</span>;
    return (
      <dl className="trace-fields">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>
              {LABELS[k] ?? k}
              <code>{k}</code>
            </dt>
            <dd>
              <DataView value={v} recordKeys={recordKeys} onPickRecord={onPickRecord} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return String(value);
}
