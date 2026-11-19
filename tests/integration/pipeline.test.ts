import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { t, verifyEventChain, type Db } from '@cl/db';
import { acknowledge, confirmJdSet, createRun, getCandidate, getDetail, getState, getTrace, processNextJob, startAttempt, addUserEvent } from '@cl/pipeline';
import { commitCandidate, decideCandidate, decideLessons, getStop, latestRelease, loadDictionary, reopenWorkspace, revertRelease } from '@cl/registry';
import { BlockTraceSchema } from '@cl/contract';
import { WS, closeTestDb, resetDb } from './helpers';
import { JD_A, JD_B, JD_C, JD_OTHER, doc, jd, newSession, runThrough, runner, step } from './fixtures';

let db: Db;
let log: string;
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const publish = async (sessionId: string, dropped: string[] = []) => {
  const c = (await getCandidate(db, WS, sessionId))!;
  await decideCandidate(db, WS, c.id, { decision: 'ACCEPT', dropped_item_ids: dropped, reason: 'Đã xem hồ sơ', actor: 'local' });
  return commitCandidate(db, WS, c.id, { expected_base_release_id: c.base_release_id, actor: 'local' });
};

beforeAll(async () => {
  process.env.AGENT_RETRY_DELAY_MS = '1';
});
beforeEach(async () => {
  db = await resetDb();
  log = path.join(mkdtempSync(path.join(os.tmpdir(), 'cl-fake-')), 'calls.jsonl');
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.FAKE_CLAUDE_MODE = 'ok';
});
afterAll(closeTestDb);

describe('dây chuyền Live với CLI giả', () => {
  it('lượt 1 trên từ điển rỗng: B0→B8, số liệu do code tính, trace hợp lệ, commit có receipt', async () => {
    const { sessionId, runId } = await newSession(db, [doc('A', JD_A), doc('B', JD_B), doc('Khác', JD_OTHER)]);
    await runThrough(db, sessionId);
    const s = await getState(db, WS, sessionId);
    expect(s.position).toBe(9);
    expect(s.halted).toBe(false);
    expect(s.cards.filter((c) => c.id !== 'FAST').every((c) => c.state === 'pass')).toBe(true);
    const b1 = await getDetail(db, WS, sessionId, 'B1');
    expect((b1.raw as any).valid).toBe(2);
    expect((b1.raw as any).jds.find((j: any) => j.name === 'Khác').verdict).toBe('OUT_OF_SCOPE');
    const b2 = (await getDetail(db, WS, sessionId, 'B2')).raw as any;
    expect(b2.tasks).toHaveLength(3);
    expect(b2.tasks[0]).toMatchObject({ statement: 'Sắp xếp backlog theo giá trị', weight: 1 });
    expect(b2.sum_w).toBe(2);
    const b3 = (await getDetail(db, WS, sessionId, 'B3')).raw as any;
    expect(b3.counts).toEqual({ REUSE: 0, UPDATE: 0, ADD: 3, NEEDS_REVIEW: 0 });
    const b4 = await getDetail(db, WS, sessionId, 'B4');
    expect(b4.gates[0]).toMatchObject({ status: 'NOT_APPLICABLE' });
    expect(b4.gates[0].reason).toBeTruthy();
    // P1 drops the hypothesis agent (T13): code lists the groups that still need real evidence
    expect((b4.raw as any).hypotheses).toHaveLength(0);
    expect((b4.raw as any).evidence_needed).toHaveLength(3);
    const b5 = (await getDetail(db, WS, sessionId, 'B5')).raw as any;
    expect(b5.coverage).toBe(1);
    // E10: three seats always score; the level is the median of their votes (26)
    expect(Object.values(b5.levels).every((l) => l === 3)).toBe(true);
    expect(b5.scores.every((x: any) => x.rwg === 1 && x.keep)).toBe(true);
    // every stored trace satisfies the shared contract and is ordered RECEIVE → READ → GATE → HANDOFF
    for (const b of ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'] as const) {
      const tr = BlockTraceSchema.parse(await getTrace(db, WS, sessionId, b));
      const kinds = tr.events.map((e) => e.kind);
      expect(kinds[0]).toBe('RECEIVE');
      expect(kinds.at(-1)).toBe('HANDOFF');
      expect(kinds.filter((k) => k === 'GATE')).toHaveLength(tr.gates.length);
      const order = { RECEIVE: 0, READ: 1, GATE: 2, HANDOFF: 3 } as const;
      expect([...kinds].sort((x, y) => order[x] - order[y])).toEqual(kinds);
    }
    const b1t = (await getTrace(db, WS, sessionId, 'B1'))!;
    const reads = b1t.events.filter((e) => e.title.startsWith('Đọc JD'));
    expect(reads[1].substitution).toContain('1 + 1 = 2');
    expect(reads[0].source).toMatchObject({ task_id: 'E1.jd_read', model: 'haiku', effort: 'low' });
    // nothing is published before the decision
    expect(await latestRelease(db, WS)).toBeNull();
    const cand = (await getCandidate(db, WS, sessionId))!;
    expect(cand.status).toBe('READY');
    await expect(commitCandidate(db, WS, cand.id, { expected_base_release_id: null, actor: 'local' })).rejects.toMatchObject({ code: 'DECISION_REQUIRED' });
    await expect(decideCandidate(db, WS, cand.id, { decision: 'ACCEPT', reason: ' ', actor: 'local' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const receipt = await publish(sessionId);
    expect(receipt.version_label).toBe('1.0.0');
    expect(receipt.counts.ADD).toBeGreaterThanOrEqual(3);
    const again = await commitCandidate(db, WS, cand.id, { expected_base_release_id: null, actor: 'local' });
    expect(again).toMatchObject({ release_id: receipt.release_id, replayed: true });
    const d = await loadDictionary(db, WS, receipt.release_id);
    expect(d.C.map((c) => c.data.display_code)).toEqual(['C01', 'C02', 'C03']);
    expect(d.R[0].data.requirements).toHaveLength(3);
    expect(d.R[0].data.requirements.every((q) => q.required_level === 3 && q.competency_version === 1 && q.indicators.length === 6 && q.evidence_ids.length > 0)).toBe(true);
    expect(d.V.every((v) => v.data.evidence_class === 'JD')).toBe(true);
    // (34)–(36): level C, deviation tickets → Internal tier; software → 12-month review
    expect(d.R[0].data).toMatchObject({ tier: 'INTERNAL' });
    expect(d.R[0].data.review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const after = await getState(db, WS, sessionId);
    expect(after.completed).toBe(true);
    expect(after.dictionary.version).toBe('1.0.0');
    expect(after.history).toHaveLength(1);
    expect(after.history[0].receipt?.release_id).toBe(receipt.release_id);
    expect((await verifyEventChain(db, WS)).ok).toBe(true);
    const types = (await db.select().from(t.event).where(eq(t.event.runId, runId))).map((e) => e.type);
    for (const ty of ['INPUT_LOCKED', 'JOB_RESULT', 'GATE_RESULT', 'AGENT_CALL', 'CANDIDATE_READY', 'AUDIT', 'APPROVAL', 'RELEASE_COMMITTED', 'ACKNOWLEDGED']) expect(types).toContain(ty);
  });

  it('chạy lại cùng dữ liệu: 0 lời gọi CLI, output giống hệt', async () => {
    const a = await newSession(db, [doc('A', JD_A), doc('B', JD_B)], 'P1');
    await runThrough(db, a.sessionId, 'B7');
    const first = calls().length;
    // P1 batches: one E1 read for both JDs, one review per step, one matrix… instead of one call per JD and per task
    expect(first).toBeGreaterThanOrEqual(5);
    expect(first).toBeLessThanOrEqual(16); // + E9 re-coding, three E10 seats
    const b = await newSession(db, [doc('A', JD_A), doc('B', JD_B)], 'P2');
    await runThrough(db, b.sessionId, 'B7');
    expect(calls().length - first).toBe(0);
    for (const blk of ['B2', 'B3', 'B5', 'B6'] as const) {
      const x = (await getDetail(db, WS, a.sessionId, blk)).raw, y = (await getDetail(db, WS, b.sessionId, blk)).raw;
      expect(JSON.stringify(y)).toBe(JSON.stringify(x));
    }
    const cached = await db.select().from(t.agentCall).where(and(eq(t.agentCall.runId, b.runId), eq(t.agentCall.cacheHit, false)));
    expect(cached).toHaveLength(0);
    // an explicit "run the agent again" bypasses the stored answer for that task only
    await step(db, b.sessionId, 'B2', runner(), { rerun_tasks: ['E23'] });
    expect(calls().length - first).toBe(1);
    expect(calls().at(-1).taskId).toBe('E23.task_review');
    expect((await getState(db, WS, b.sessionId)).cards.find((c) => c.id === 'B3')!.state).toBe('stale');
  });

  it('lượt 2: REUSE / UPDATE / ADD so với release nền; khung 1.0 vẫn giữ nội dung cũ', async () => {
    const one = await newSession(db, [doc('A', JD_A), doc('B', JD_B)]);
    await runThrough(db, one.sessionId);
    const r1 = await publish(one.sessionId);
    const d1 = await loadDictionary(db, WS, r1.release_id);
    const backlog = d1.C.find((c) => c.data.label === 'Ưu tiên backlog')!;
    await confirmJdSet(db, WS, one.sessionId, [doc('A', JD_A), doc('B', JD_B), doc('C', JD_C)], 'local');
    await createRun(db, WS, one.sessionId, { acknowledge_send: true }, 'local');
    await runThrough(db, one.sessionId);
    const b3 = (await getDetail(db, WS, one.sessionId, 'B3')).raw as any;
    expect(b3.counts).toMatchObject({ REUSE: 3, ADD: 1 });
    expect(b3.groups.find((g: any) => g.label === 'Ưu tiên backlog').competency_id).toBe(backlog.id);
    const cand = (await getCandidate(db, WS, one.sessionId))!;
    const cItems = (cand.items as any[]).filter((i) => i.entity === 'C');
    expect(cItems.map((i) => i.action).sort()).toEqual(['ADD', 'REUSE', 'REUSE', 'REUSE']);
    const r2 = await publish(one.sessionId);
    expect(r2.version_label).toBe('1.1.0'); // (39): a new competency raises MINOR
    const d2 = await loadDictionary(db, WS, r2.release_id);
    expect(d2.C).toHaveLength(4);
    // (38): the framework's competency set changed (S) → MAJOR
    expect(d2.RAll.map((f) => f.data.version_label)).toEqual(['1.0.0', '2.0.0']);
    expect(d2.RAll[0].data.requirements).toHaveLength(3);
    expect(d2.RAll[1].data.requirements).toHaveLength(4);
    const st = await getState(db, WS, one.sessionId);
    expect(st.history.map((h) => `${h.fromVersion}→${h.toVersion}`)).toEqual(['0.0→1.0.0', '1.0.0→1.1.0']);
    expect(st.dictionary.R.find((f) => f.version === '1.0.0')!.competencies).toHaveLength(3);
    // restore = a new release pointing back, history kept
    const rv = await revertRelease(db, WS, { release_id: r2.release_id, reason: 'Thử khôi phục', actor: 'local' });
    const d3 = await loadDictionary(db, WS, rv.release_id);
    expect(d3.C).toHaveLength(3);
    expect((await db.select().from(t.release)).length).toBe(3);
    expect(rv.version_label).toBe('1.1.1'); // P3.8: a revert raises PATCH
    // P3 acceptance 4: writing again after the revert does not reuse a code@version key
    await confirmJdSet(db, WS, one.sessionId, [doc('A', JD_A), doc('B', JD_B), doc('C', JD_C)], 'local');
    await createRun(db, WS, one.sessionId, { acknowledge_send: true }, 'local');
    await runThrough(db, one.sessionId);
    const r4 = await publish(one.sessionId);
    expect(r4.version_label).toBe('1.2.0');
    const d4 = await loadDictionary(db, WS, r4.release_id);
    expect(d4.C.find((c) => c.data.label === 'Điều phối bên liên quan')!.version).toBe(2);
    // review fix: the semantic label never repeats after a revert (1.0.0 was used by the reverted version)
    expect((d4.C.find((c) => c.data.label === 'Điều phối bên liên quan')!.data as any).semver).toBe('2.0.0');
  });

  it('UPDATE định nghĩa dùng chung nêu khung bị ảnh hưởng; NEEDS_REVIEW không vào release', async () => {
    const one = await newSession(db, [doc('A', JD_A)]);
    await runThrough(db, one.sessionId);
    await publish(one.sessionId);
    const upd = jd('Công ty D', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị, chi phí trì hoãn và rủi ro [k1]', 'NL: Viết tiêu chí nghiệm thu — Khả năng mô tả điều kiện hoàn thành review_test [k2]']);
    const two = await newSession(db, [doc('D', upd)], 'Phiên 2');
    await runThrough(db, two.sessionId);
    const cand = (await getCandidate(db, WS, two.sessionId))!;
    const items = cand.items as any[];
    const u = items.find((i) => i.entity === 'C' && i.action === 'UPDATE');
    expect(u.name).toBe('Ưu tiên backlog');
    expect(u.affected.join(' ')).toContain('Product Owner');
    expect(items.some((i) => i.action === 'NEEDS_REVIEW')).toBe(true);
    const r = await publish(two.sessionId);
    const d = await loadDictionary(db, WS, r.release_id);
    expect(d.C.find((c) => c.data.label === 'Ưu tiên backlog')!.version).toBe(2);
    // P3.7: no framework of the new release uses it any more → Deprecated (a new version, nothing deleted)
    const wtc = d.C.find((c) => c.data.label === 'Viết tiêu chí nghiệm thu')!;
    expect(wtc.version).toBe(2);
    expect(wtc.data.status).toBe('DEPRECATED');
    // (38): a new definition is D → MAJOR
    expect(d.C.find((c) => c.data.label === 'Ưu tiên backlog')!.data as any).toMatchObject({ semver: '2.0.0' });
    // the 1.0 frame still locks competency@1
    expect(d.RAll[0].data.requirements.find((q) => q.competency_id === u.id)!.competency_version).toBe(1);
    expect(d.RAll[1].data.requirements.map((q) => q.competency_id)).toEqual([u.id]);
  });

  it('commit nguyên khối, base đổi, bỏ từng mục', async () => {
    const a = await newSession(db, [doc('A', JD_A)], 'A');
    const b = await newSession(db, [doc('B', JD_B)], 'B');
    await runThrough(db, a.sessionId);
    await runThrough(db, b.sessionId);
    const ca = (await getCandidate(db, WS, a.sessionId))!;
    await decideCandidate(db, WS, ca.id, { decision: 'ACCEPT', reason: 'ok', actor: 'local' });
    await expect(commitCandidate(db, WS, ca.id, { expected_base_release_id: null, actor: 'local', failAfterWrites: true })).rejects.toMatchObject({ code: 'INJECTED_FAILURE' });
    expect(await latestRelease(db, WS)).toBeNull();
    expect(await db.select().from(t.dictRecord)).toHaveLength(0);
    expect((await db.select().from(t.candidate).where(eq(t.candidate.id, ca.id)))[0].status).toBe('DECIDED');
    const dropId = (ca.items as any[]).find((i) => i.entity === 'C').item_id;
    await decideCandidate(db, WS, ca.id, { decision: 'ACCEPT', dropped_item_ids: [dropId], reason: 'bỏ một mục', actor: 'local' });
    const ra = await commitCandidate(db, WS, ca.id, { expected_base_release_id: null, actor: 'local' });
    const da = await loadDictionary(db, WS, ra.release_id);
    expect(da.C).toHaveLength(1);
    expect(da.R[0].data.requirements).toHaveLength(1);
    expect(da.I).toHaveLength(6); // levels 1, 3, 5 × 2 indicators (29)
    const cb = (await getCandidate(db, WS, b.sessionId))!;
    await decideCandidate(db, WS, cb.id, { decision: 'ACCEPT', reason: 'ok', actor: 'local' });
    await expect(commitCandidate(db, WS, cb.id, { expected_base_release_id: null, actor: 'local' })).rejects.toMatchObject({ code: 'BASE_CHANGED' });
    await expect(commitCandidate(db, WS, cb.id, { expected_base_release_id: ra.release_id, actor: 'local' })).rejects.toMatchObject({ code: 'BASE_CHANGED' });
    expect((await db.select().from(t.release)).length).toBe(1);
  });

  it('finding CRITICAL → STOP: chặn job mới, chặn commit; mở lại cần lý do và lesson đã quyết', async () => {
    const bad = jd('Công ty X', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NL: Ưu tiên backlog — Khả năng critical_test sắp xếp hạng mục [k1]']);
    const a = await newSession(db, [doc('X', bad)]);
    await runThrough(db, a.sessionId);
    const st = await getState(db, WS, a.sessionId);
    expect(st.halted).toBe(true);
    expect(st.audit!.findings[0]).toMatchObject({ severity: 'CRITICAL' });
    expect(st.lessons[0].status).toBe('PENDING');
    expect(await getStop(db, WS)).not.toBeNull();
    const c = (await getCandidate(db, WS, a.sessionId))!;
    await decideCandidate(db, WS, c.id, { decision: 'ACCEPT', reason: 'thử', actor: 'local' });
    await expect(commitCandidate(db, WS, c.id, { expected_base_release_id: null, actor: 'local' })).rejects.toMatchObject({ code: 'WORKSPACE_STOPPED' });
    await expect(startAttempt(db, WS, a.sessionId, 'B8', 'again', { actor: 'local', skipAgentCheck: true })).rejects.toMatchObject({ code: 'WORKSPACE_STOPPED' });
    await expect(createRun(db, WS, a.sessionId, { acknowledge_send: true }, 'local')).rejects.toMatchObject({ code: 'WORKSPACE_STOPPED' });
    await expect(reopenWorkspace(db, WS, { reason: '', actor: 'local' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(reopenWorkspace(db, WS, { reason: 'đã sửa', actor: 'local' })).rejects.toMatchObject({ code: 'LESSON_PENDING' });
    await decideLessons(db, WS, { decision: 'SAFE', reason: 'đã thêm kiểm', actor: 'local' });
    expect((await reopenWorkspace(db, WS, { reason: 'đã sửa', actor: 'local' })).reopened).toBe(true);
    expect(await getStop(db, WS)).toBeNull();
    // the SAFE lesson is loaded by the next run
    const next = await newSession(db, [doc('A', JD_A)], 'Sau STOP');
    const [run] = await db.select().from(t.run).where(eq(t.run.id, next.runId));
    expect((run.snapshot as any).lessons_loaded).toHaveLength(1);
  });

  it('thứ tự, idempotency, chờ "Đã hiểu", cổng chặn và lỗi agent giữ bản nháp', async () => {
    const a = await newSession(db, [doc('Khác', JD_OTHER)]);
    await expect(startAttempt(db, WS, a.sessionId, 'B2', 'x1', { actor: 'local', skipAgentCheck: true })).rejects.toMatchObject({ code: 'ORDER' });
    await expect(startAttempt(db, WS, a.sessionId, 'FAST', 'x2', { actor: 'local', skipAgentCheck: true })).rejects.toMatchObject({ code: 'ORDER' });
    const p1 = await startAttempt(db, WS, a.sessionId, 'B0', 'same', { actor: 'local' });
    const p2 = await startAttempt(db, WS, a.sessionId, 'B0', 'same', { actor: 'local' });
    const p3 = await startAttempt(db, WS, a.sessionId, 'B0', 'other-key', { actor: 'local' });
    expect([p1, p2, p3].every((p) => p.id === 'B0')).toBe(true);
    expect(await db.select().from(t.blockAttempt)).toHaveLength(1);
    expect(await getTrace(db, WS, a.sessionId, 'B0')).toBeNull();
    expect((await getState(db, WS, a.sessionId)).cards[0].state).toBe('running');
    await processNextJob(db, runner());
    expect((await getState(db, WS, a.sessionId)).cards[0].state).toBe('awaiting_view');
    await expect(startAttempt(db, WS, a.sessionId, 'B1', 'x3', { actor: 'local', skipAgentCheck: true })).rejects.toMatchObject({ code: 'PENDING_VIEW' });
    await acknowledge(db, WS, a.sessionId, 'B0', 'local');
    // agent failure: attempt FAILED with a code, earlier draft intact, retry creates attempt 2
    process.env.FAKE_CLAUDE_MODE = 'bad_schema';
    await step(db, a.sessionId, 'B1');
    let st = await getState(db, WS, a.sessionId);
    expect(st.cards[1].state).toBe('error');
    expect((await getDetail(db, WS, a.sessionId, 'B1')).error).toMatchObject({ code: 'AGENT_SCHEMA_INVALID' });
    expect(st.cards[0].state).toBe('pass');
    process.env.FAKE_CLAUDE_MODE = 'ok';
    await step(db, a.sessionId, 'B1');
    st = await getState(db, WS, a.sessionId);
    // the only JD is for another role → gate blocks and stays blocked after "Đã hiểu"
    expect(st.cards[1].state).toBe('awaiting_view');
    await acknowledge(db, WS, a.sessionId, 'B1', 'local');
    st = await getState(db, WS, a.sessionId);
    expect(st.cards[1].state).toBe('blocked');
    expect(st.halted).toBe(true);
    expect(st.haltReasons[0]).toContain('Số JD hợp lệ');
    const g = (await getDetail(db, WS, a.sessionId, 'B1')).gates;
    expect(g[1]).toMatchObject({ status: 'NOT_EVALUATED', actual: 'Không tính được' });
    await expect(startAttempt(db, WS, a.sessionId, 'B2', 'x4', { actor: 'local', skipAgentCheck: true })).rejects.toMatchObject({ code: 'ORDER' });
    const attempts = await db.select().from(t.blockAttempt).where(eq(t.blockAttempt.block, 'B1'));
    expect(attempts.map((x) => x.attemptNo).sort()).toEqual([1, 2]);
    // not-run block preview: descriptive only, creates no job
    const jobs = (await db.select().from(t.job)).length;
    const pv = await getTrace(db, WS, a.sessionId, 'B5');
    expect(pv!.attempt_id).toBe('preview');
    expect((await db.select().from(t.job)).length).toBe(jobs);
  });

  it('sự kiện thật được kiểm (T7); nhóm chưa có sự kiện thật được liệt kê, không gọi AI đề xuất giả thuyết; nhánh nhanh chỉ ghi bản thử', async () => {
    const { createSession } = await import('@cl/pipeline');
    const { id } = await createSession(db, WS, { name: 'Có sự kiện', role_title: 'Product Owner', purpose: 'Nháp', charter: { policy_id: 'dev-small' } }, 'local');
    await confirmJdSet(db, WS, id, [doc('A', JD_A)], 'local');
    await addUserEvent(db, WS, id, { label: 'Quý 2', situation: 'Backlog quá tải', action: 'Thực hiện Ưu tiên backlog theo chi phí trì hoãn', outcome: 'Giảm 30% hạng mục', source_ref: 'biên bản họp 12/5' }, 'local');
    await createRun(db, WS, id, { acknowledge_send: true }, 'local');
    await runThrough(db, id, 'B4');
    const b4 = await getDetail(db, WS, id, 'B4');
    expect(b4.gates[0]).toMatchObject({ status: 'PASS', actual: '1/1' });
    expect((b4.raw as any).supported).toHaveLength(1);
    expect((b4.raw as any).hypotheses).toHaveLength(0);
    expect((b4.raw as any).evidence_needed).toHaveLength(1);
    await step(db, id, 'FAST');
    await acknowledge(db, WS, id, 'FAST', 'local');
    const st = await getState(db, WS, id);
    expect(st.trial).toMatchObject({ trial: true });
    expect(st.trial!.competencies.every((c) => c.level === null && c.indicator === null)).toBe(true);
    expect(st.fast.done).toBe(true);
    expect(await db.select().from(t.dictRecord)).toHaveLength(0);
    expect(st.inputs.events.map((e) => e.evidenceClass)).toEqual(['REAL']);
  });
});
