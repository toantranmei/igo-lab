import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { t, type Db } from '@cl/db';
import { getDetail, recordMeasure, startAttempt } from '@cl/pipeline';
import { DEFAULT_AGENT_CONFIG, TASKS } from '@cl/agents';
import { WS, closeTestDb, resetDb } from './helpers';
import { JD_A, JD_B, doc, jd, newSession, runThrough } from './fixtures';

let db: Db;
let log: string;
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
beforeAll(() => {
  process.env.AGENT_RETRY_DELAY_MS = '1';
});
beforeEach(async () => {
  db = await resetDb();
  log = path.join(mkdtempSync(path.join(os.tmpdir(), 'cl-fake-')), 'calls.jsonl');
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.FAKE_CLAUDE_MODE = 'ok';
});
afterAll(closeTestDb);

/** A realistic JD: company intro, job, benefits, contact block with personal data. */
const RICH = jd('Công ty D', [
  'Về chúng tôi:',
  'Công ty D là nền tảng thương mại điện tử với 2 triệu người dùng.',
  'Mô tả công việc:',
  'NV: Sắp xếp backlog theo giá trị [k1]',
  'NV: Viết tiêu chí nghiệm thu cho hạng mục [k2]',
  'Thực hiện các công việc khác theo yêu cầu của cấp trên.',
  'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]',
  'NL: Viết tiêu chí nghiệm thu — Khả năng mô tả điều kiện hoàn thành kiểm được [k2]',
  'Quyền lợi',
  'Lương tháng 13, bảo hiểm sức khỏe cao cấp cho cả gia đình.',
  'Liên hệ: Trần Thị Mai, mai.tran@congtyd.vn, 0903 456 789',
]);

describe('P1 · bước code trước AI và gọi theo lô', () => {
  it('không email, số điện thoại, tên người liên hệ, phúc lợi hay câu chung chung nào tới AI; JD trùng gần đúng không được gửi', async () => {
    const near = RICH.replace('2 triệu người dùng', 'hai triệu người dùng');
    const { sessionId } = await newSession(db, [doc('D', RICH), doc('D2', near), doc('B', JD_B)], 'P1 che');
    await runThrough(db, sessionId, 'B8');
    const inputs = (await db.select().from(t.agentResult)).map((r) => r.inputCanonical).join('\n');
    expect(inputs).not.toMatch(/mai\.tran@|0903|456 789|Trần Thị Mai/);
    expect(inputs).not.toContain('bảo hiểm sức khỏe');
    expect(inputs).not.toContain('2 triệu người dùng');
    expect(inputs).not.toContain('công việc khác theo yêu cầu');
    const b1 = (await getDetail(db, WS, sessionId, 'B1')).raw as any;
    const d2 = b1.jds.find((j: any) => j.name === 'D2');
    expect(d2.duplicate_of).toBe(b1.jds.find((j: any) => j.name === 'D').ref);
    expect(d2.near_duplicate_j).toBeGreaterThanOrEqual(0.85);
    expect(b1.prep).toMatchObject({ near_duplicates: 1 });
    expect(b1.prep.cut_off_job).toBeGreaterThanOrEqual(4);
    // one E1 call read the two distinct JDs
    const e1 = calls().filter((c) => c.taskId === 'E1.jd_read');
    expect(e1).toHaveLength(1);
    expect(JSON.parse((await db.select().from(t.agentResult).where(eq(t.agentResult.taskId, 'E1.jd_read')))[0].inputCanonical).jds).toHaveLength(2);
    // the whole B0–B8 line: a handful of calls, each well under the 8 000-token input limit (the guard would have stopped it)
    expect(calls().length).toBeLessThanOrEqual(16);
    expect(new Set(calls().map((c) => c.taskId))).toEqual(new Set(['E1.jd_read', 'E23.task_review', 'E4.candidate_review', 'E4M.granularity_merge', 'E9.recode', 'E5.task_matrix', 'E10.seat_score', 'E6.indicator_write', 'E7.retranslation', 'E8.audit_review']));
    // model policy §12.5: Haiku and Sonnet only, low effort
    expect(calls().every((c) => c.effort === 'low')).toBe(true);
    expect(calls().every((c) => /haiku|sonnet/.test(c.model))).toBe(true);
    expect(calls().filter((c) => ['E6.indicator_write', 'E9.recode'].includes(c.taskId)).every((c) => /sonnet/.test(c.model))).toBe(true);
    // level C (this policy): the auditor runs on Haiku; Opus is kept for levels A/B, where (31) decides the tier
    expect(calls().filter((c) => c.taskId === 'E8.audit_review').every((c) => /haiku/.test(c.model))).toBe(true);
  });

  it('chạy lại cùng bộ JD không phát sinh lời gọi mới; ma trận đặt danh sách năng lực ở system prompt', async () => {
    const a = await newSession(db, [doc('A', JD_A), doc('B', JD_B)], 'P1 a');
    await runThrough(db, a.sessionId, 'B8');
    const n = calls().length;
    const b = await newSession(db, [doc('A', JD_A), doc('B', JD_B)], 'P1 b');
    await runThrough(db, b.sessionId, 'B8');
    expect(calls().length).toBe(n);
    const e5 = (await db.select().from(t.agentResult).where(eq(t.agentResult.taskId, 'E5.task_matrix')))[0];
    expect(JSON.parse(e5.inputCanonical).competencies.length).toBeGreaterThan(0);
    const b5 = (await getDetail(db, WS, a.sessionId, 'B5')).raw as any;
    expect(b5.coverage).toBe(1);
  });

  it('ngày đăng (SOP): tin quá 24 tháng bị loại trước khi gửi AI; tin không rõ ngày vẫn dùng với D = 0; ngày sai dạng bị từ chối', async () => {
    const old = { ...doc('Cũ', JD_B), posted_at: '2023-01-15' };
    const fresh = { ...doc('Mới', JD_A), posted_at: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10) };
    const undated = doc('Không ngày', jd('Công ty E', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]']));
    const { sessionId } = await newSession(db, [old, fresh, undated], 'Ngày đăng');
    await runThrough(db, sessionId, 'B1');
    const b1 = (await getDetail(db, WS, sessionId, 'B1')).raw as any;
    const by = (n: string) => b1.jds.find((j: any) => j.name === n);
    expect(by('Cũ')).toMatchObject({ valid: false, too_old: true, posted_at: '2023-01-15' });
    expect(by('Cũ').why).toContain('quá 24 tháng');
    expect(by('Mới').criteria.D).toBe(3);
    expect(by('Không ngày')).toMatchObject({ valid: true, posted_at: null });
    expect(by('Không ngày').criteria.D).toBe(0);
    expect(b1.prep).toMatchObject({ too_old: 1, undated: 1 });
    // the old posting never reached the AI
    const items = await db.select({ input: t.agentResult.inputCanonical }).from(t.agentResult).where(eq(t.agentResult.taskId, `${TASKS.E1.id}#item`));
    expect(items.map((x) => JSON.parse(x.input).ref).sort()).toEqual([by('Mới').ref, by('Không ngày').ref].sort());
    await expect(newSession(db, [{ ...doc('Sai', JD_A), posted_at: '15/01/2026' }], 'Sai ngày')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('agent có số đo bộ neo chưa đạt bị khóa (P1.2); đổi phiên bản prompt hoặc model thì mở', async () => {
    const { sessionId } = await newSession(db, [doc('A', JD_A)], 'P1 khóa');
    await runThrough(db, sessionId, 'B0');
    await recordMeasure(db, { taskId: TASKS.E1.id, model: DEFAULT_AGENT_CONFIG.tasks.E1.model, promptVersion: TASKS.E1.promptVersion, anchorSet: 'neo-thu', metrics: { tasks: { f1: 0.4 } }, thresholds: { tasks_f1: 0.7 }, passed: false, by: 'người duyệt' });
    await expect(startAttempt(db, WS, sessionId, 'B1', 'lock-1', { actor: 'local', skipAgentCheck: true })).rejects.toMatchObject({ code: 'AGENT_LOCKED' });
    await recordMeasure(db, { taskId: TASKS.E1.id, model: 'claude-sonnet-5-5', promptVersion: TASKS.E1.promptVersion, anchorSet: 'neo-thu', metrics: {}, thresholds: {}, passed: false, by: 'x' });
    // a measurement of another model does not lock the configured one any further, and a later pass unlocks it
    await recordMeasure(db, { taskId: TASKS.E1.id, model: DEFAULT_AGENT_CONFIG.tasks.E1.model, promptVersion: TASKS.E1.promptVersion, anchorSet: 'neo-thu', metrics: { tasks: { f1: 0.8 } }, thresholds: { tasks_f1: 0.7 }, passed: true, by: 'người duyệt' });
    await expect(startAttempt(db, WS, sessionId, 'B1', 'lock-2', { actor: 'local', skipAgentCheck: true })).resolves.toMatchObject({ id: 'B1' });
  });
});
