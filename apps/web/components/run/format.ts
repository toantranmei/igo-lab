import type { attemptCalls, blockAttempts, listRuns, runLog, runOverview, runUsage, attemptTrace, attemptCalc, attemptTech } from '@cl/pipeline';

type R<F extends (...a: any) => any> = Awaited<ReturnType<F>>;
export type Overview = R<typeof runOverview>;
export type OverviewStepT = Overview['steps'][number];
export type RunRow = R<typeof listRuns>[number];
export type Usage = R<typeof runUsage>;
export type Calls = R<typeof attemptCalls>;
export type Attempts = R<typeof blockAttempts>;
export type LogRows = R<typeof runLog>;
export type TraceRows = R<typeof attemptTrace>;
export type CalcRows = R<typeof attemptCalc>;
export type Tech = R<typeof attemptTech>;

const nf = new Intl.NumberFormat('vi-VN');
export const num = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
/** 10 712 345 → "10,7 tr"; 52 400 → "52,4 n". */
export function tokens(n: number | null | undefined) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} n`;
  return nf.format(n);
}
export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`);
export function dur(ms: number | null | undefined) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export const hhmm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—');
export const hhmmss = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export const dayTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const STATUS_TEXT: Record<string, string> = { OK: 'thành công', CACHED: 'lấy từ đã lưu', QUOTA: 'hết hạn mức', CLI_ERROR: 'lỗi CLI', TIMEOUT: 'quá giờ', SCHEMA_INVALID: 'sai schema', REJECTED: 'bị code từ chối' };
export const statusChip = (s: string) => (s === 'OK' ? 'ok' : s === 'CACHED' ? 'mute' : s === 'QUOTA' ? 'warn' : 'bad');
export const REASON_TEXT: Record<string, string> = { auto: 'chạy tự động', resume: 'chạy tiếp', rerun: 'chạy lại', manual: 'bấm chạy' };
