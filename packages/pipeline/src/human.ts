/**
 * P4 · data from people: behavioural events (BEI or written), survey responses, the AI tool register.
 * Personal data never reaches the database: an event or a response that still carries identifying marks is refused
 * at save time with a de-identified proposal the person can accept (P4.2).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppError } from '@cl/contract';
import { newId, t, type Db } from '@cl/db';
import { getSession } from './sessions';
import { maskPII } from './prep';

export interface IdentifierHit {
  kind: 'email' | 'phone' | 'id_number' | 'person' | 'organisation' | 'place';
  text: string;
}
// JS `\b` only knows ASCII letters: Vietnamese words need Unicode-aware boundaries
const L0 = '(?<![\\p{L}\\p{N}])', L1 = '(?![\\p{L}\\p{N}])';
const CAP = "\\p{Lu}[\\p{L}'.-]*";
// the honorific in either case, the name strictly capitalised (no `i` flag, or \p{Lu} would match any letter)
const HONORIFIC = new RegExp(`${L0}([Aa]nh|[Cc]hị|[Ôô]ng|[Bb]à|[Cc]ô|[Cc]hú|[Ee]m|[Bb]ạn|M[Rr]s?\\.?|M[Ss]\\.?)\\s+(${CAP}(?:\\s+${CAP}){0,3})`, 'gu');
const SURNAMES = 'Nguyễn|Trần|Lê|Phạm|Hoàng|Huỳnh|Phan|Vũ|Võ|Đặng|Bùi|Đỗ|Hồ|Ngô|Dương|Lý|Trương|Đinh|Lương|Mai|Trịnh|Đoàn|Lâm|Tô|Hà|Tạ|Cao|Chu|Châu|Thái|Lưu|Văn|Đào|Kiều|Quách|Tăng|La|Vương|Khúc|Kim|Triệu|Mạc|Từ|Tôn|Thân|Hứa|Giang|Tiêu|Phùng|Doãn|Ông|Âu|Đàm|Lại|Nghiêm|Vi|Mã|Khổng|Diệp|Lục|Trình|Ninh|Quan|Bạch|Hầu|Lữ|Thạch|Nông|Phó|Yên|Ưng';
/** A known surname followed by 1–3 capitalised words, anywhere (sentence start included): a Vietnamese full name. */
const FULL_NAME = new RegExp(`${L0}((?:${SURNAMES})(?:\\s+\\p{Lu}\\p{Ll}*){1,3})${L1}`, 'gu');
const ORG = new RegExp(`${L0}((?:công ty|tập đoàn|ngân hàng|tổng công ty|cty|tnhh|cổ phần|jsc|corp|ltd|inc|dự án|project)\\.?\\s+[\\p{Lu}\\d][\\p{L}\\d&.-]*(?:\\s+[\\p{Lu}\\d][\\p{L}\\d&.-]*){0,4})`, 'giu');
/** Well-known organisations and places without a keyword in front (a gazetteer; extend as needed). */
const KNOWN = new RegExp(`${L0}(Viettel|FPT(?:\\s+Software|\\s+Telecom)?|Vingroup|Vinamilk|Vietcombank|VietinBank|BIDV|Agribank|Techcombank|VPBank|MB\\s?Bank|Sacombank|Masan|Hòa Phát|Momo|VNG|Shopee|Grab|Tiki|Hà Nội|Hồ Chí Minh|TP\\.?\\s?HCM|Sài Gòn|Đà Nẵng|Hải Phòng|Cần Thơ|Huế|Nha Trang|Bình Dương|Đồng Nai)${L1}`, 'gu');
const PLACE = new RegExp(`${L0}((?:tỉnh|thành phố|tp\\.?|quận|huyện|phường|xã)\\s+[\\p{Lu}\\d][\\p{L}\\d]*(?:\\s+\\p{Lu}\\p{L}*){0,3})`, 'giu');
const PHONE = /(?<![\p{L}\p{N}])\(?(?:\+?84|0)\)?[\s.-]?\(?\d{1,3}\)?(?:[\s.-]?\d){6,9}(?![\p{N}])/gu;
/** 9–13 digits, possibly grouped with spaces, dots or dashes (ID card, tax code, social insurance). */
const ID_NUMBER = /(?<![\p{N}])\d(?:[\s.-]?\d){8,12}(?![\p{N}])/gu;

/** Identifying marks in a free text (P4.2): names, organisations, places, numbers, contact data. */
export function findIdentifiers(text: string): IdentifierHit[] {
  const hits: IdentifierHit[] = [];
  const add = (kind: IdentifierHit['kind'], t: string) => {
    if (!hits.some((h) => h.text.includes(t))) hits.push({ kind, text: t });
  };
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add('email', m[0]);
  for (const m of text.matchAll(ID_NUMBER)) add('id_number', m[0].trim());
  for (const m of text.matchAll(PHONE)) add('phone', m[0].trim());
  // places and organisations first, so "Hà Nội" is not read as a person named Hà
  for (const m of text.matchAll(KNOWN)) add(/Hà Nội|Hồ Chí Minh|HCM|Sài Gòn|Đà Nẵng|Hải Phòng|Cần Thơ|Huế|Nha Trang|Bình Dương|Đồng Nai/.test(m[1]) ? 'place' : 'organisation', m[1]);
  for (const m of text.matchAll(PLACE)) add('place', m[1]);
  for (const m of text.matchAll(ORG)) add('organisation', m[1]);
  for (const m of text.matchAll(HONORIFIC)) add('person', m[0]);
  for (const m of text.matchAll(FULL_NAME)) if (!hits.some((h) => h.text.includes(m[1]) || m[1].includes(h.text))) add('person', m[1]);
  return hits;
}
/** The de-identified proposal: each mark replaced by a neutral code. */
export function deidentify(text: string): string {
  // identifiers first (whole numbers, whole names), then the generic contact mask for what is left
  let out = text;
  const hits = findIdentifiers(out);
  const code: Record<IdentifierHit['kind'], string> = { email: '[email]', phone: '[số điện thoại]', id_number: '[số định danh]', person: '[người]', organisation: '[tổ chức]', place: '[địa danh]' };
  for (const h of [...hits].sort((a, b) => b.text.length - a.text.length)) out = out.split(h.text).join(code[h.kind]);
  return maskPII(out).text;
}

const PERSON_CODE = /^[A-Z]{1,3}\d{1,4}$/;
export interface HumanEventInput {
  label: string;
  situation?: string;
  action?: string;
  outcome?: string;
  source_ref?: string;
  person_code?: string;
  person_group?: 'EXCELLENT' | 'AVERAGE';
  kind?: 'BEI' | 'WRITTEN';
  consent_ref?: string;
  retain_until?: string;
}
/** Retention dates are ISO YYYY-MM-DD and in the future; anything else would be compared as text by the purge. */
function checkRetention(d: string | undefined) {
  if (!d?.trim()) return;
  const v = d.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new AppError('VALIDATION', 'Hạn lưu phải theo dạng YYYY-MM-DD.', 422, { field: 'retain_until' });
  if (v <= new Date().toISOString().slice(0, 10)) throw new AppError('VALIDATION', 'Hạn lưu phải là một ngày trong tương lai.', 422, { field: 'retain_until' });
}
/** Checks an event before it is stored; throws DEIDENTIFY_REQUIRED with a proposal when marks remain. */
export function checkEvent(input: HumanEventInput) {
  if (!input.label?.trim() || !input.action?.trim()) throw new AppError('VALIDATION', 'Sự kiện cần tên và hành động.', 422);
  if (input.person_code && !PERSON_CODE.test(input.person_code.trim())) throw new AppError('VALIDATION', 'Mã người phải là mã giả danh dạng P01, không phải tên.', 422, { field: 'person_code' });
  if (input.person_code && !input.consent_ref?.trim()) throw new AppError('CONSENT_REQUIRED', 'Sự kiện gắn với một người cần tham chiếu đồng ý (P4.2).', 422, { field: 'consent_ref' });
  if (input.person_group && !['EXCELLENT', 'AVERAGE'].includes(input.person_group)) throw new AppError('VALIDATION', 'Nhóm phải là EXCELLENT hoặc AVERAGE.', 422);
  checkRetention(input.retain_until);
  // every free-text field that is stored (and copied into run snapshots) is checked
  const fields = { label: input.label, situation: input.situation ?? '', action: input.action ?? '', outcome: input.outcome ?? '', source_ref: input.source_ref ?? '', consent_ref: input.consent_ref ?? '' };
  const hits = Object.entries(fields).flatMap(([f, v]) => findIdentifiers(v).map((h) => ({ field: f, ...h })));
  if (hits.length)
    throw new AppError('DEIDENTIFY_REQUIRED', `Sự kiện còn ${hits.length} dấu hiệu nhận dạng (${[...new Set(hits.map((h) => h.kind))].join(', ')}). Khử trước khi lưu.`, 422, { hits, proposal: Object.fromEntries(Object.entries(fields).map(([f, v]) => [f, deidentify(v)])) }, ['USE_PROPOSAL']);
}

export async function addHumanEvent(db: Db, workspaceId: string, sessionId: string, input: HumanEventInput, actor: string) {
  await getSession(db, workspaceId, sessionId);
  checkEvent(input);
  const id = newId('evt');
  await db.insert(t.userEvent).values({ id, workspaceId, sessionId, label: input.label.trim(), situation: input.situation?.trim() ?? '', action: input.action!.trim(), outcome: input.outcome?.trim() ?? '', sourceRef: input.source_ref?.trim() ?? '', personCode: input.person_code?.trim() || null, personGroup: input.person_group ?? null, kind: input.kind ?? (input.person_code ? 'WRITTEN' : 'WRITTEN'), consentRef: input.consent_ref?.trim() || null, retainUntil: input.retain_until?.trim() || null, submittedBy: actor });
  return { id };
}

export interface SurveyRow {
  respondent_code: string;
  competency_label: string;
  importance?: number | null;
  discrimination?: number | null;
  level?: number | null;
}
/** P4.1 survey responses (pseudonymous respondents, scores 1–5); replaces the previous set of the session. */
export async function setSurvey(db: Db, workspaceId: string, sessionId: string, input: { rows: SurveyRow[]; consent_ref: string; retain_until?: string }, actor: string) {
  await getSession(db, workspaceId, sessionId);
  if (!input.consent_ref?.trim()) throw new AppError('CONSENT_REQUIRED', 'Kết quả khảo sát cần tham chiếu đồng ý.', 422);
  checkRetention(input.retain_until);
  const marks = [input.consent_ref, ...input.rows.map((r) => r.competency_label)].flatMap((v) => findIdentifiers(String(v ?? '')));
  if (marks.length) throw new AppError('DEIDENTIFY_REQUIRED', `Khảo sát còn ${marks.length} dấu hiệu nhận dạng (${[...new Set(marks.map((h) => h.kind))].join(', ')}).`, 422, { hits: marks });
  const ok = (x: unknown) => x == null || (Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 5);
  for (const [i, r] of input.rows.entries()) {
    if (!PERSON_CODE.test(String(r.respondent_code ?? '').trim())) throw new AppError('VALIDATION', `Dòng ${i + 1}: mã người trả lời phải là mã giả danh (P01…).`, 422);
    if (!String(r.competency_label ?? '').trim()) throw new AppError('VALIDATION', `Dòng ${i + 1}: thiếu tên năng lực.`, 422);
    if (!ok(r.importance) || !ok(r.discrimination) || !ok(r.level)) throw new AppError('VALIDATION', `Dòng ${i + 1}: điểm phải là số nguyên 1–5.`, 422);
  }
  await db.transaction(async (tx) => {
    await tx.delete(t.surveyResponse).where(eq(t.surveyResponse.sessionId, sessionId));
    if (input.rows.length) await tx.insert(t.surveyResponse).values(input.rows.map((r) => ({ id: newId('svy'), workspaceId, sessionId, respondentCode: r.respondent_code.trim(), competencyLabel: r.competency_label.trim(), importance: r.importance ?? null, discrimination: r.discrimination ?? null, level: r.level ?? null, consentRef: input.consent_ref.trim(), retainUntil: input.retain_until?.trim() || null, submittedBy: actor })));
  });
  return { rows: input.rows.length, respondents: new Set(input.rows.map((r) => r.respondent_code.trim())).size };
}
export const listSurvey = (db: Db, sessionId: string) => db.select().from(t.surveyResponse).where(eq(t.surveyResponse.sessionId, sessionId)).orderBy(asc(t.surveyResponse.createdAt));

export const DEFAULT_AI_TOOL = 'anthropic-claude-cli';
/** Puts the default entry back if the register is empty (called when a run is created, never on a read). */
export async function ensureDefaultAiTool(db: Db) {
  const [any] = await db.select({ id: t.aiTool.id }).from(t.aiTool).limit(1);
  if (!any) await db.insert(t.aiTool).values({ id: DEFAULT_AI_TOOL, provider: 'Anthropic', channel: 'Claude Code CLI (claude -p)', accountType: 'Tài khoản Claude của tổ chức đăng nhập trên máy worker', retention: 'Theo điều khoản thương mại của Anthropic cho tài khoản đó; cần pháp chế xác nhận', noTraining: true, note: 'Mục mặc định.' }).onConflictDoNothing();
}
export async function aiToolEntry(db: Db, id = DEFAULT_AI_TOOL) {
  const [r] = await db.select().from(t.aiTool).where(and(eq(t.aiTool.id, id)));
  return r ? { id: r.id, provider: r.provider, channel: r.channel, account_type: r.accountType, retention: r.retention, no_training: r.noTraining } : null;
}

/** P4.2 retention: events and survey responses past their retention date are deleted (runs keep only their snapshot copy). */
export async function purgeExpiredHumanData(db: Db, today = new Date().toISOString().slice(0, 10)) {
  const ev = (await db.execute(sql`delete from user_event where retain_until is not null and retain_until < ${today} returning id`)) as unknown as unknown[];
  const sv = (await db.execute(sql`delete from survey_response where retain_until is not null and retain_until < ${today} returning id`)) as unknown as unknown[];
  // the copies inside run snapshots are redacted too (the ids stay so the run's outputs still resolve)
  const runs = (await db.execute(sql`select id, snapshot from run where jsonb_array_length(coalesce(snapshot -> 'events', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(snapshot -> 'survey', '[]'::jsonb)) > 0`)) as unknown as { id: string; snapshot: any }[];
  let redacted = 0;
  for (const r of runs) {
    const expired = (x: any) => x?.retain_until && x.retain_until < today && !x.redacted;
    const ev2 = (r.snapshot.events ?? []).map((e: any) => (expired(e) ? (redacted++, { id: e.id, label: '[đã xóa theo hạn lưu]', situation: '', action: '', outcome: '', source_ref: '', person_code: null, person_group: e.person_group ?? null, kind: e.kind, retain_until: e.retain_until, redacted: true }) : e));
    const sv2 = (r.snapshot.survey ?? []).filter((x: any) => !expired(x) || (redacted++, false));
    if (redacted) await db.update(t.run).set({ snapshot: { ...r.snapshot, events: ev2, survey: sv2 } }).where(eq(t.run.id, r.id));
  }
  return { events: ev.length, survey: sv.length, snapshots: redacted };
}
