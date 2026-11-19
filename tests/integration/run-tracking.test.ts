import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { ClaudeCliRunner, DEFAULT_AGENT_CONFIG, getBreaker, resetBreaker, runTask, type TaskContext } from '@cl/agents';
import { t, type Db } from '@cl/db';
import { attemptCalc, attemptCalls, attemptTrace, blockAttempts, listRuns, runOverview, runUsage, getState, getTrace, processNextJob, readBreaker, requeueOrphans, resumeRun, saveBreaker, setAuto, startAttempt, writeWorkerStatus } from '@cl/pipeline';
import { BlockTraceSchema } from '@cl/contract';
import { FAKE_CLAUDE, WS, closeTestDb, resetDb } from './helpers';
import { JD_A, JD_B, doc, newSession, runner } from './fixtures';

let db: Db;
let log: string;
const spawned = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const drain = async (r = runner()) => {
  for (let i = 0; i < 40 && (await processNextJob(db, r)); i++);
};
const events = async (runId: string, type: string) => db.select().from(t.event).where(and(eq(t.event.runId, runId), eq(t.event.type, type))).orderBy(asc(t.event.seq));

beforeAll(() => {
  process.env.AGENT_RETRY_DELAY_MS = '1';
});
beforeEach(async () => {
  db = await resetDb();
  await writeWorkerStatus(db, { ok: true, version: '2.1.325', message: 'ok' });
  log = path.join(mkdtempSync(path.join(os.tmpdir(), 'cl-fake-')), 'calls.jsonl');
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.FAKE_CLAUDE_MODE = 'ok';
  resetBreaker();
});
afterEach(() => {
  delete process.env.FAKE_CLAUDE_QUOTA_AFTER;
  delete process.env.AGENT_ANOMALY_INPUT_TOKENS;
  delete process.env.AGENT_ANOMALY_INPUT_TOKENS_BATCH;
  resetBreaker();
});
afterAll(closeTestDb);

const VERB = ['Lập', 'Rà soát', 'Theo dõi', 'Điều phối', 'Đo lường', 'Báo cáo', 'Thiết kế', 'Kiểm tra', 'Ưu tiên', 'Chuẩn bị', 'Thống nhất', 'Cập nhật'];
const NOUN = ['backlog', 'lộ trình', 'tiêu chí nghiệm thu', 'phản hồi khách hàng', 'chỉ số', 'rủi ro', 'phạm vi', 'kế hoạch phát hành', 'yêu cầu', 'ngân sách', 'đối tác', 'tài liệu', 'nguyên mẫu', 'kiểm thử', 'dữ liệu sử dụng', 'hợp đồng', 'đội phát triển'];

describe('cầu dao hạn mức', () => {
  it('30 lời gọi song song, lời gọi thứ 5 chạm hạn mức: số tiến trình claude ≤ 5 + số luồng; không thử lại; giờ hồi đọc được', async () => {
    process.env.FAKE_CLAUDE_MODE = 'quota_after';
    process.env.FAKE_CLAUDE_QUOTA_AFTER = '4';
    const r = new ClaudeCliRunner({ bin: FAKE_CLAUDE, timeoutMs: 5000, maxParallel: 3 });
    const stats = { blocked: 0 };
    const ctx: TaskContext = { db, runner: r, config: DEFAULT_AGENT_CONFIG, workspaceId: WS, stats };
    const docOf = (i: number) => ({ id: `d${i}@1`, segments: [{ id: `d${i}@1#1`, text: `Product Owner ${i}` }] });
    const res = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => runTask(ctx, 'T1', { role_title: 'Product Owner', purpose: '', context: '', document: docOf(i) })));
    expect(spawned()).toBeLessThanOrEqual(5 + 3);
    const rejected = res.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBeGreaterThanOrEqual(30 - 4 - 3);
    expect(rejected.every((x) => x.reason.code === 'AGENT_QUOTA')).toBe(true);
    expect(rejected[0].reason.details.until).toMatch(/T\d\d:30:00\.000Z$/);
    expect(getBreaker()?.code).toBe('QUOTA');
    // the refused calls are counted, not logged one row each
    const rows = await db.select().from(t.agentCall).where(eq(t.agentCall.status, 'QUOTA'));
    expect(rows.length).toBeLessThanOrEqual(4);
    expect(stats.blocked).toBe(30 - spawned());
    // once tripped, nothing spawns
    const before = spawned();
    await expect(runTask(ctx, 'T1', { role_title: 'Product Owner', purpose: '', context: '', document: docOf(99) })).rejects.toMatchObject({ code: 'AGENT_QUOTA' });
    expect(spawned()).toBe(before);
  });

  it('lượt tự động: dừng QUOTA có giờ hồi, tắt tự động, chặn xếp bước mới, chạy tiếp được khi cầu dao mở', async () => {
    const { sessionId, runId } = await newSession(db, [doc('A', JD_A), doc('B', JD_B)]);
    process.env.FAKE_CLAUDE_MODE = 'quota';
    await setAuto(db, WS, sessionId, true, 'local');
    await drain();
    const st = await getState(db, WS, sessionId);
    expect(st.auto).toMatchObject({ on: false, stop: { code: 'QUOTA', block: 'B1', actions: ['RESUME', 'SCHEDULE'] } });
    expect(st.auto!.stop!.until).toBeTruthy();
    expect(st.auto!.stop!.message).toContain('Hạn mức hồi lúc');
    expect((await readBreaker(db))?.code).toBe('QUOTA');
    await expect(startAttempt(db, WS, sessionId, 'B1', 'again', { actor: 'local', skipAgentCheck: true })).rejects.toMatchObject({ code: 'AGENT_QUOTA' });
    await expect(resumeRun(db, WS, sessionId, { actor: 'local' })).rejects.toMatchObject({ code: 'AGENT_QUOTA' });
    expect((await events(runId, 'BLOCK_STOPPED')).at(-1)!.payload).toMatchObject({ stop: { code: 'QUOTA' } });
    // limit resets
    resetBreaker();
    await saveBreaker(db, null);
    process.env.FAKE_CLAUDE_MODE = 'ok';
    await resumeRun(db, WS, sessionId, { actor: 'local' });
    await drain();
    const after = await getState(db, WS, sessionId);
    expect(after.position).toBe(9);
    expect(after.auto!.stop).toMatchObject({ code: 'DONE' });
  });
});

describe('bất thường, ngân sách, giờ của bước', () => {
  it('đầu vào vượt ngưỡng: dừng ANOMALY trước khi gọi; chấp nhận vượt chạy tiếp và ghi người xác nhận', async () => {
    const { sessionId, runId } = await newSession(db, [doc('A', JD_A)]);
    process.env.AGENT_ANOMALY_INPUT_TOKENS = '1300';
    process.env.AGENT_ANOMALY_INPUT_TOKENS_BATCH = '1300'; // E23 carries the occupation list and has the batch limit
    await setAuto(db, WS, sessionId, true, 'local');
    await drain();
    const st = await getState(db, WS, sessionId);
    expect(st.auto!.stop).toMatchObject({ code: 'ANOMALY', block: 'B1', cause: 'ANOMALY_INPUT', actions: ['ACCEPT_OVER', 'OPEN_STEP'] });
    expect(st.auto!.stop!.details).toMatchObject({ limit: 1300 });
    expect(spawned()).toBe(0);
    await resumeRun(db, WS, sessionId, { actor: 'reviewer', acceptOver: true });
    await processNextJob(db, runner());
    const ev = await events(runId, 'OVER_ACCEPTED');
    expect(ev).toHaveLength(1);
    expect(ev[0].actor).toBe('reviewer');
    expect(spawned()).toBeGreaterThan(0);
    // B2 is a new attempt without the acceptance: it stops again
    await drain();
    expect((await getState(db, WS, sessionId)).auto!.stop).toMatchObject({ code: 'ANOMALY', block: 'B2' });
  });

  it('vượt trần token của bước: dừng BUDGET', async () => {
    const { sessionId, runId } = await newSession(db, [doc('A', JD_A), doc('B', JD_B)]);
    const [run] = await db.select().from(t.run).where(eq(t.run.id, runId));
    const snap = run.snapshot as any;
    await db.update(t.run).set({ snapshot: { ...snap, budget: { ...snap.budget, block_tokens: { ...snap.budget.block_tokens, B1: 1500 } } } }).where(eq(t.run.id, runId));
    await setAuto(db, WS, sessionId, true, 'local');
    await drain();
    expect((await getState(db, WS, sessionId)).auto!.stop).toMatchObject({ code: 'BUDGET', block: 'B1', cause: 'BUDGET_BLOCK' });
    // a plain (or scheduled) resume never lifts a budget stop; a rerun does not get a fresh block budget either
    await expect(resumeRun(db, WS, sessionId, { actor: 'local' })).rejects.toMatchObject({ code: 'ACCEPT_OVER_REQUIRED' });
    await resumeRun(db, WS, sessionId, { actor: 'reviewer', acceptOver: true });
    const st = await db.select().from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, runId), eq(t.blockAttempt.block, 'B1')));
    expect((st.find((a) => a.current)!.options as any).accept_over).toMatchObject({ budget: true, run: false });
  });

  it('BLOCK_STARTED / BLOCK_DONE có giờ thật; finished_at lấy lúc xong; ngân sách nằm trong snapshot', async () => {
    const { sessionId, runId } = await newSession(db, [doc('A', JD_A), doc('B', JD_B)]);
    const [run] = await db.select().from(t.run).where(eq(t.run.id, runId));
    expect((run.snapshot as any).budget.run_tokens).toBeGreaterThan(0);
    process.env.FAKE_CLAUDE_DELAY_MS = '60';
    try {
      await setAuto(db, WS, sessionId, true, 'local');
      await drain();
    } finally {
      delete process.env.FAKE_CLAUDE_DELAY_MS;
    }
    const started = await events(runId, 'BLOCK_STARTED');
    const done = await events(runId, 'BLOCK_DONE');
    expect(started).toHaveLength(9);
    expect(done).toHaveLength(9);
    expect(started[0].payload).toMatchObject({ attempt_no: 1, reason: 'auto' });
    const atts = await db.select().from(t.blockAttempt).where(eq(t.blockAttempt.runId, runId));
    for (const a of atts) {
      expect(a.startedAt).toBeTruthy();
      expect(Date.parse(a.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(a.startedAt!));
      expect(a.computedAt).toBe(a.finishedAt);
    }
    const b1 = atts.find((a) => a.block === 'B1')!;
    expect(Date.parse(b1.finishedAt!) - Date.parse(b1.startedAt!)).toBeGreaterThanOrEqual(50);
    const d1 = done.find((e) => e.block === 'B1')!.payload as any;
    expect(d1.duration_ms).toBe(Date.parse(b1.finishedAt!) - Date.parse(b1.startedAt!));
    expect(d1.calls).toBe(1); // E1 reads both JDs in one call
    expect(d1.tokens).toBeGreaterThan(0);

    // read side of the Run screen
    const ov = await runOverview(db, WS, runId);
    expect(ov.steps).toHaveLength(9);
    expect(ov.metrics.steps_done).toBe(9);
    expect(ov.stop).toMatchObject({ code: 'DONE' });
    expect(ov.steps[1]).toMatchObject({ block: 'B1', status: 'done', calls: 1, duration_ms: d1.duration_ms });
    expect(ov.metrics.quota.estimated).toBe(true);
    expect(ov.poll_ms).toBe(30000);
    const u = await runUsage(db, WS, runId);
    expect(u.total.calls).toBe(ov.metrics.calls);
    expect(u.total.total).toBe(u.total.input + u.total.cache_write + u.total.cache_read + u.total.output);
    expect(u.blocks.find((b) => b.block === 'B1')!.calls).toBe(1);
    const runs = await listRuns(db, WS, sessionId);
    expect(runs[0]).toMatchObject({ run_no: 1, progress: { done: 9, total: 9 }, running: false, jd_count: 2 });
    const hist = await blockAttempts(db, WS, runId, 'B1');
    expect(hist[0]).toMatchObject({ attempt_no: 1, reason: 'auto', status: 'DONE', calls: 1 });
    const cl = await attemptCalls(db, WS, b1.id, { sort: 'time' });
    expect(cl.rows).toHaveLength(1);
    expect(cl.tasks[0]).toMatchObject({ task_id: 'E1.jd_read', calls: 1 });
  });

  it('lỗi giống nhau gộp một dòng có số đếm', async () => {
    const { sessionId, runId } = await newSession(db, [doc('A', JD_A), doc('B', JD_B)]);
    process.env.FAKE_CLAUDE_MODE = 'bad_schema';
    await setAuto(db, WS, sessionId, true, 'local');
    await drain();
    const [b1] = await db.select().from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, runId), eq(t.blockAttempt.block, 'B1')));
    const cl = await attemptCalls(db, WS, b1.id);
    expect(cl.total).toBeGreaterThanOrEqual(2);
    expect(cl.rows.length).toBeLessThan(cl.total);
    expect(cl.rows.some((r) => r.count > 1)).toBe(true);
    expect((await runOverview(db, WS, runId)).stop).toMatchObject({ code: 'AI_ERROR', block: 'B1' });
  });

  it('vết B2 của 175 JD < 1 MB; bản dựng lại vẫn đủ before/after/draft; có bản ghi phép tính', async () => {
    const big = Array.from({ length: 175 }, (_, i) =>
      // distinct wording per JD, so K1 does not (rightly) fold them as near-duplicates
      doc(`J${i}`, [`Mô tả công việc: Product Owner — Công ty ${i}`, ...Array.from({ length: 8 }, (_, k) => `NV: ${VERB[(i + k) % VERB.length]} ${NOUN[(i * 7 + k) % NOUN.length]} ${NOUN[(i * 3 + 2 * k) % NOUN.length]} đợt ${i}-${k} [k${k}]`), 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục [k1]'].join('\n')),
    );
    const { sessionId, runId } = await newSession(db, big, 'Bộ lớn');
    const r = runner();
    for (const b of ['B0', 'B1', 'B2'] as const) {
      await startAttempt(db, WS, sessionId, b, `big-${b}`, { actor: 'local', skipAgentCheck: true });
      await processNextJob(db, r);
      await db.update(t.viewCursor).set({ acknowledgedAt: new Date().toISOString() }).where(and(eq(t.viewCursor.runId, runId), eq(t.viewCursor.block, b)));
    }
    const [b2] = await db.select().from(t.blockAttempt).where(and(eq(t.blockAttempt.runId, runId), eq(t.blockAttempt.block, 'B2')));
    expect(b2.status).toBe('DONE');
    const stored = JSON.stringify(b2.trace).length;
    console.log("B2 trace bytes", stored);
    const full = (await getTrace(db, WS, sessionId, 'B2'))!;
    expect(BlockTraceSchema.safeParse(full).success).toBe(true);
    expect(stored).toBeLessThan(1_000_000);
    expect(JSON.stringify(full).length).toBeGreaterThan(stored * 5); // what used to be stored
    const last = full.events.at(-1)!;
    expect(last.draft.length).toBeGreaterThan(100);
    const calc = await attemptCalc(db, WS, b2.id, 'B2.weight');
    expect(calc.rows.length).toBe((b2.output as any).tasks.length);
    expect(calc.rows[0]).toMatchObject({ formula: expect.stringContaining('w ='), inputs: { valid_jds: 175 } });
    const tr = await attemptTrace(db, WS, b2.id);
    expect(tr.beats.length).toBe(full.events.length);
  });

  it('vết của bước đang chạy đọc được trước khi bước xong', async () => {
    const { sessionId } = await newSession(db, Array.from({ length: 9 }, (_, i) => doc(`R${i}`, JD_A.replace('Công ty A', `Công ty R${i}`))));
    const r = runner();
    await startAttempt(db, WS, sessionId, 'B0', 'r0', { actor: 'local', skipAgentCheck: true });
    await processNextJob(db, r);
    await setAuto(db, WS, sessionId, true, 'local'); // acknowledges B0 and queues B1
    process.env.FAKE_CLAUDE_DELAY_MS = '2500'; // one E1 call reads all nine JDs
    try {
      const [att] = await db.select().from(t.blockAttempt).where(and(eq(t.blockAttempt.block, 'B1'), eq(t.blockAttempt.current, true)));
      const running = processNextJob(db, r);
      let seen = null as null | Awaited<ReturnType<typeof attemptTrace>>;
      for (let i = 0; i < 40 && !seen; i++) {
        await new Promise((x) => setTimeout(x, 100));
        const tr = await attemptTrace(db, WS, att.id);
        if (tr.running && tr.beats.length) seen = tr;
      }
      expect(seen?.beats[0].kind).toBe('RECEIVE');
      await running;
    } finally {
      delete process.env.FAKE_CLAUDE_DELAY_MS;
    }
  });

  it('job mồ côi (worker chết giữa chừng) được xếp lại khi worker khởi động', async () => {
    const { sessionId } = await newSession(db, [doc('A', JD_A)]);
    await startAttempt(db, WS, sessionId, 'B0', 'k1', { actor: 'local', skipAgentCheck: true });
    await db.update(t.job).set({ state: 'RUNNING', lockedAt: new Date(Date.now() - 10 * 60000).toISOString() });
    expect(await requeueOrphans(db)).toBe(1);
    expect((await db.select().from(t.job))[0].state).toBe('QUEUED');
    await db.update(t.job).set({ state: 'RUNNING', lockedAt: new Date().toISOString() });
    expect(await requeueOrphans(db)).toBe(0);
  });
});
