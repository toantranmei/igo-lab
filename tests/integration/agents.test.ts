import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { ClaudeCliRunner, DEFAULT_AGENT_CONFIG, TASKS, outputJsonSchema, runTask, taskKey, canonicalInput, type TaskContext } from '@cl/agents';
import { appendEvent, t, verifyEventChain, type Db } from '@cl/db';
import { FAKE_CLAUDE, WS, closeTestDb, resetDb, OWNER_URL } from './helpers';
import postgres from 'postgres';

let db: Db;
let log: string;
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ctx = (over: Partial<TaskContext> = {}): TaskContext => ({ db, runner: new ClaudeCliRunner({ bin: FAKE_CLAUDE, timeoutMs: 1500 }), config: DEFAULT_AGENT_CONFIG, workspaceId: WS, ...over });
const doc = { id: 'doc_a@1', segments: [{ id: 'doc_a@1#1', text: 'Product Owner' }, { id: 'doc_a@1#2', text: '- NV: Sắp xếp backlog theo giá trị [k1]' }] };

beforeAll(async () => {
  db = await resetDb();
  process.env.AGENT_RETRY_DELAY_MS = '1';
});
beforeEach(() => {
  log = path.join(mkdtempSync(path.join(os.tmpdir(), 'cl-fake-')), 'calls.jsonl');
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.FAKE_CLAUDE_MODE = 'ok';
  delete process.env.FAKE_CLAUDE_FLAG;
});
afterAll(closeTestDb);

describe('ClaudeCliRunner + bộ nhớ kết quả', () => {
  it('schema output đóng kín, không có $schema', () => {
    for (const task of Object.values(TASKS)) {
      const s = JSON.stringify(outputJsonSchema(task));
      expect(s).not.toContain('$schema');
      expect(s).toContain('"additionalProperties":false');
    }
  });
  it('task_key ổn định với thứ tự khóa và đổi theo model/effort/input', () => {
    const a = canonicalInput({ b: 1, a: [2, { d: 1, c: 2 }] });
    expect(a).toBe(canonicalInput({ a: [2, { c: 2, d: 1 }], b: 1 }));
    const k = taskKey('T1', { model: 'm', effort: 'low' }, a);
    expect(taskKey('T1', { model: 'm', effort: 'low' }, a)).toBe(k);
    expect(taskKey('T1', { model: 'm2', effort: 'low' }, a)).not.toBe(k);
    expect(taskKey('T1', { model: 'm', effort: 'high' }, a)).not.toBe(k);
    expect(taskKey('T1', { model: 'm', effort: 'low' }, a, 1)).not.toBe(k);
  });
  it('gọi CLI với đủ cờ, không lộ API key, cwd rỗng; lần hai lấy từ bộ nhớ', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    const input = { role_title: 'Product Owner', purpose: 'p', context: 'c', document: doc };
    const first = await runTask(ctx(), 'T1', input);
    delete process.env.ANTHROPIC_API_KEY;
    expect(first.output.verdict).toBe('IN_SCOPE');
    expect(first.cacheHit).toBe(false);
    const c = calls();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ taskId: 'T1.jd_scope', model: 'claude-haiku-5-5', effort: 'low', hasApiKey: false, tools: '' });
    expect(c[0].cwd).toContain('cl-agent-');
    const second = await runTask(ctx(), 'T1', { document: doc, context: 'c', purpose: 'p', role_title: 'Product Owner' });
    expect(second.cacheHit).toBe(true);
    expect(second.output).toEqual(first.output);
    expect(calls()).toHaveLength(1);
    const third = await runTask(ctx({ rerun: { T1: 1 } }), 'T1', input);
    expect(third.cacheHit).toBe(false);
    expect(calls()).toHaveLength(2);
  });
  it('sai schema: sửa một lần rồi báo AGENT_SCHEMA_INVALID; không lưu kết quả', async () => {
    process.env.FAKE_CLAUDE_MODE = 'bad_schema';
    const input = { role_title: 'Data Analyst', purpose: '', context: '', document: doc };
    await expect(runTask(ctx(), 'T1', input)).rejects.toMatchObject({ code: 'AGENT_SCHEMA_INVALID' });
    expect(calls()).toHaveLength(2);
    expect(calls()[1].repair).toBe(true);
    const rows = await db.select().from(t.agentResult).where(eq(t.agentResult.taskKey, taskKey('T1', DEFAULT_AGENT_CONFIG.tasks.T1, canonicalInput(input))));
    expect(rows).toHaveLength(0);
  });
  it('sai một lần rồi đúng: lần sửa thành công', async () => {
    process.env.FAKE_CLAUDE_MODE = 'bad_once';
    process.env.FAKE_CLAUDE_FLAG = log + '.flag';
    const r = await runTask(ctx(), 'T2', { role_title: 'Product Owner', document: doc });
    expect(r.output.tasks).toEqual([{ statement: 'Sắp xếp backlog theo giá trị', segment_ids: ['doc_a@1#2'] }]);
    expect(calls()).toHaveLength(2);
  });
  it('thoát khác 0, treo quá timeout, CLI không tồn tại', async () => {
    const input = { role_title: 'X', document: doc };
    process.env.FAKE_CLAUDE_MODE = 'exit1';
    await expect(runTask(ctx(), 'T4', input)).rejects.toMatchObject({ code: 'AGENT_CLI_ERROR' });
    process.env.FAKE_CLAUDE_MODE = 'hang';
    await expect(runTask(ctx({ runner: new ClaudeCliRunner({ bin: FAKE_CLAUDE, timeoutMs: 300 }) }), 'T4', input)).rejects.toMatchObject({ code: 'AGENT_TIMEOUT' });
    process.env.FAKE_CLAUDE_MODE = 'ok';
    const missing = new ClaudeCliRunner({ bin: '/nonexistent/claude' });
    expect((await missing.status()).ok).toBe(false);
    await expect(runTask(ctx({ runner: missing }), 'T4', input)).rejects.toMatchObject({ code: 'AGENT_CLI_UNAVAILABLE' });
    expect((await new ClaudeCliRunner({ bin: FAKE_CLAUDE }).status()).version).toBe('2.1.325');
  });
  it('ID ngoài input bị từ chối bởi kiểm tham chiếu', () => {
    expect(TASKS.T3.check({ role_title: 'x', tasks: [{ id: 'a', statement: 's' }, { id: 'b', statement: 's' }] }, { groups: [{ member_ids: ['a'], canonical_member_id: 'a' }] })).not.toHaveLength(0);
    expect(TASKS.T1.check({ role_title: 'x', purpose: '', context: '', document: doc }, { verdict: 'IN_SCOPE', reason_code: 'ROLE_MATCH', segment_ids: ['nope'] })).toHaveLength(1);
  });
});

describe('event append-only', () => {
  it('chuỗi hash đúng; role ứng dụng không UPDATE/DELETE được; sửa trực tiếp bị phát hiện', async () => {
    await appendEvent(db, { workspaceId: WS, type: 'SESSION_CREATED', actor: 'local', payload: { n: 1 } });
    await appendEvent(db, { workspaceId: WS, type: 'RUN_CREATED', actor: 'local', payload: { n: 2 } });
    expect((await verifyEventChain(db, WS)).ok).toBe(true);
    await expect(db.execute(sql`update event set actor = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from event`)).rejects.toThrow();
    const owner = postgres(OWNER_URL, { max: 1 });
    await owner`update event set actor = 'tampered' where seq = (select min(seq) from event)`;
    await owner.end();
    expect((await verifyEventChain(db, WS)).ok).toBe(false);
  });
});
