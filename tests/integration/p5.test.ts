import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { t, type Db } from '@cl/db';
import { confirmJdSet, createBatch, createRun, dictionaryQuality, escalateBatchAudit, getCandidate, getDetail, getSession, listProduction, reviewsDue } from '@cl/pipeline';
import { commitCandidate, decideCandidate } from '@cl/registry';
import { WS, closeTestDb, resetDb } from './helpers';
import { JD_A, JD_B, doc, jd, runThrough } from './fixtures';

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

async function publish(sessionId: string) {
  const c = (await getCandidate(db, WS, sessionId))!;
  await decideCandidate(db, WS, c.id, { decision: 'ACCEPT', dropped_item_ids: [], reason: 'Đã xem', actor: 'local' });
  return commitCandidate(db, WS, c.id, { expected_base_release_id: c.base_release_id, actor: 'local' });
}

describe('P5 · sản xuất hàng loạt', () => {
  it('lô 1 khung gốc + 3 phái sinh: phái sinh kế thừa, không gọi AI cho chỉ báo kế thừa, có tỷ lệ trùng; thẩm định 1/5 phái sinh', async () => {
    const b = await createBatch(db, WS, { name: 'Lô PO', purpose: 'Khung nội bộ', charter: { policy_id: 'dev-small', owner: 'Trưởng nhóm' }, items: [{ role_title: 'Product Owner', framework_type: 'ROOT' }, { role_title: 'Product Owner', level: 'Senior', framework_type: 'DERIVED_LEVEL', root_index: 0 }, { role_title: 'Product Owner', level: 'Junior', framework_type: 'DERIVED_LEVEL', root_index: 0 }, { role_title: 'Product Owner', industry: 'Ngân hàng', framework_type: 'INDUSTRY_VARIANT', root_index: 0 }] }, 'local');
    const [root, ...der] = b.sessions as string[];
    const derCharters = await Promise.all(der.map(async (sid) => (await getSession(db, WS, sid)).charter as any));
    expect(derCharters.every((c) => c.root_session_id === root && c.policy_id === 'dev-small' && c.owner === 'Trưởng nhóm')).toBe(true);
    expect(derCharters.filter((c) => c.audit_sampled).length).toBe(1); // ⌈3/5⌉
    // root: full line, published
    await confirmJdSet(db, WS, root, [doc('A', JD_A), doc('B', JD_B)], 'local');
    await createRun(db, WS, root, { acknowledge_send: true }, 'local');
    await runThrough(db, root, 'B8');
    await publish(root);
    // each derived framework: JDs with the same competencies
    for (const [k, sid] of der.entries()) {
      const before = calls().length;
      await confirmJdSet(db, WS, sid, [doc(`D${k}`, jd(`Công ty phái sinh ${k}`, ['NV: Sắp xếp backlog theo giá trị [k1]', 'NV: Viết tiêu chí nghiệm thu cho hạng mục [k2]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]', 'NL: Viết tiêu chí nghiệm thu — Khả năng mô tả điều kiện hoàn thành kiểm được [k2]']))], 'local');
      await createRun(db, WS, sid, { acknowledge_send: true }, 'local');
      await runThrough(db, sid, 'B8');
      const mine = calls().slice(before).map((c) => c.taskId);
      expect(mine).not.toContain('E6.indicator_write');
      expect(mine).not.toContain('E7.retranslation');
      const b6 = (await getDetail(db, WS, sid, 'B6')).raw as any;
      expect(b6.inherited).toBe(12); // 2 competencies × 3 levels × 2
      const b7 = (await getDetail(db, WS, sid, 'B7')).raw as any;
      expect(mine.includes('E8.audit_review')).toBe(b7.audit_sampled);
      const b8 = (await getDetail(db, WS, sid, 'B8')).raw as any;
      expect(b8.overlap_with_root).toBe(1);
    }
    const prod = await listProduction(db, WS);
    expect(prod).toHaveLength(4);
    expect(prod.filter((x) => x.framework_type !== 'ROOT').every((x) => x.overlap_with_root === 1 && x.inherited_indicators === 12)).toBe(true);
    // a failed audit in the batch puts every framework in the sample
    expect(await escalateBatchAudit(db, WS, der[0])).toBe(2);
    expect((await listProduction(db, WS)).every((x) => x.audit_sampled)).toBe(true);
    // quality report and review dates
    const q = (await dictionaryQuality(db, WS))!;
    expect(q.competencies).toBe(3);
    expect(q.coverage.score).toBeGreaterThan(0);
    expect(await reviewsDue(db, WS, 365 * 3)).not.toHaveLength(0);
    expect((await db.select().from(t.productionItem)).length).toBe(4);
  });
});
