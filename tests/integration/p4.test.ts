import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { t, type Db } from '@cl/db';
import { POLICIES, addUserEvent, confirmJdSet, createRun, createSession, deidentify, findIdentifiers, getDetail, setSurvey } from '@cl/pipeline';
import { WS, closeTestDb, resetDb } from './helpers';
import { jd, runThrough } from './fixtures';

let db: Db;
beforeAll(() => {
  process.env.AGENT_RETRY_DELAY_MS = '1';
});
beforeEach(async () => {
  db = await resetDb();
  process.env.FAKE_CLAUDE_LOG = path.join(mkdtempSync(path.join(os.tmpdir(), 'cl-fake-')), 'calls.jsonl');
  process.env.FAKE_CLAUDE_MODE = 'ok';
});
afterAll(closeTestDb);

const W = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
const jds = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `J${i}`,
    // a traceable URL makes E = 2 and a posting 18 months ago D = 1, so with A = C = 3 the JD reaches P1 (L = 18)
    source_ref: `https://jobs.example.vn/po/${i}`,
    posted_at: new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10),
    origin_group: `Nguồn ${i}`,
    text: jd(`${W[i % 8]} ${i} ${W[(i * 3) % 8]} ${i * 13}`, [`NV: Sắp xếp backlog đợt ${i} của nhóm ${W[(i * 5) % 8]} theo giá trị kỳ vọng [k1]`, `NV: Viết tiêu chí nghiệm thu mục ${i}-${W[(i * 7) % 8]} trước phát hành [k2]`, 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]', 'NL: Viết tiêu chí nghiệm thu — Khả năng mô tả điều kiện hoàn thành kiểm được [k2]']),
  }));

describe('P4 · dữ liệu từ con người', () => {
  it('sự kiện còn tên người, tên công ty bị chặn khi lưu, kèm bản đã khử; có mã người thì cần tham chiếu đồng ý', async () => {
    const { id } = await createSession(db, WS, { name: 'Khử', role_title: 'Product Owner', purpose: 'x', charter: { policy_id: 'dev-small' } }, 'local');
    const raw = { label: 'Quý 2', situation: 'Anh Nguyễn Văn An ở Công ty ABC Tech gặp backlog quá tải', action: 'Thực hiện Ưu tiên backlog theo chi phí trì hoãn', outcome: 'Giảm 30% hạng mục', source_ref: 'biên bản 12/5' };
    await expect(addUserEvent(db, WS, id, raw, 'local')).rejects.toMatchObject({ code: 'DEIDENTIFY_REQUIRED', details: { proposal: { situation: expect.stringContaining('[người]') } } });
    expect(findIdentifiers(raw.situation).map((h) => h.kind).sort()).toEqual(['organisation', 'person']);
    const fixed = { ...raw, situation: deidentify(raw.situation) };
    expect(fixed.situation).not.toMatch(/Nguyễn|ABC/);
    await expect(addUserEvent(db, WS, id, { ...fixed, person_code: 'P01' }, 'local')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(addUserEvent(db, WS, id, { ...fixed, person_code: 'Nguyễn An', consent_ref: 'ĐY-01' }, 'local')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(addUserEvent(db, WS, id, { ...fixed, person_code: 'P01', person_group: 'EXCELLENT', consent_ref: 'ĐY-01' }, 'local')).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('mức B có 3 người, 6 sự kiện thật và khảo sát 5 người: G4, G5 đạt bằng dữ liệu; các cổng khác đạt bằng dữ liệu thì lên tầng Sản phẩm thị trường', async () => {
    const { id } = await createSession(db, WS, { name: 'Mức B', role_title: 'Product Owner', purpose: 'Khung tuyển dụng', industry: 'Phần mềm', charter: { policy_id: 'sop-b', level: 'Chuyên viên', framework_type: 'ROOT', owner: 'Trưởng nhóm', outcomes: ['Sản phẩm ra đúng hạn', 'Giá trị kinh doanh đo được', 'Nhóm hiểu rõ ưu tiên'] } }, 'local');
    await confirmJdSet(db, WS, id, jds(15), 'local');
    for (const [k, p] of ['P01', 'P02', 'P03'].entries())
      for (const n of [1, 2]) await addUserEvent(db, WS, id, { label: `Sự kiện ${p}-${n}`, situation: 'Backlog quá tải trước kỳ phát hành', action: n === 1 ? 'Thực hiện Ưu tiên backlog theo chi phí trì hoãn' : 'Thực hiện Viết tiêu chí nghiệm thu cho từng hạng mục', outcome: 'Giảm hạng mục tồn', source_ref: `phiếu ${p}-${n}`, person_code: p, person_group: k < 2 ? 'EXCELLENT' : 'AVERAGE', kind: 'WRITTEN', consent_ref: `ĐY-${p}` }, 'local');
    await setSurvey(db, WS, id, { consent_ref: 'ĐY-KS', rows: ['R01', 'R02', 'R03', 'R04', 'R05'].flatMap((r) => [{ respondent_code: r, competency_label: 'Ưu tiên backlog', importance: 5, discrimination: 4, level: 3 }, { respondent_code: r, competency_label: 'Viết tiêu chí nghiệm thu', importance: 4, discrimination: 4, level: 3 }]) }, 'local');
    const run = await createRun(db, WS, id, { acknowledge_send: true, cli_version: '2.1.325' }, 'local');
    // two settings of this small fixture: a 2-competency core (SOP: 8–14) and κ on 6 re-coded sentences (SOP: ≥ 10);
    const [r] = await db.select().from(t.run).where(eq(t.run.id, run.id));
    const snap = r.snapshot as any;
    await db.update(t.run).set({ snapshot: { ...snap, policy: { ...POLICIES['sop-b'], core_min: 1, kappa_min_items: 5 } } }).where(eq(t.run.id, run.id));
    await runThrough(db, id, 'B8');
    const b4 = await getDetail(db, WS, id, 'B4');
    expect(b4.gates.find((g) => g.gate_id === 'B4.G4')).toMatchObject({ status: 'PASS' });
    expect(b4.gates.find((g) => g.gate_id === 'B4.G4')!.deviation).toBeUndefined();
    expect((b4.raw as any).sample).toMatchObject({ people: 3, excellent: 2, average: 1, events: 6, ok: true });
    expect((b4.raw as any).themes.every((x: any) => x.class)).toBe(true);
    const b5 = await getDetail(db, WS, id, 'B5');
    expect(b5.gates.find((g) => g.gate_id === 'B5.G3')).toMatchObject({ status: 'PASS' });
    expect((b5.raw as any).scores.every((x: any) => x.from_survey && x.respondents === 5)).toBe(true);
    const b6 = await getDetail(db, WS, id, 'B6');
    expect(b6.gates.find((g) => g.gate_id === 'B6.G4')).toMatchObject({ status: 'PASS' });
    const b8 = (await getDetail(db, WS, id, 'B8')).raw as any;
    expect(b8.deviations).toEqual([]); // the occupation anchor (G2) is now decided on data
    // level B: the auditor is Opus, a model that made nothing, so (31) holds on data
    expect((await getDetail(db, WS, id, 'B7')).gates.find((g) => g.gate_id === 'B7.G6')).toMatchObject({ status: 'PASS', actual: 'claude-opus-5-5' });
    expect(b8.tier).toBe('MARKET');
    // P4.6: T7 read the events; only a hash of its input is kept
    const t7 = await db.select().from(t.agentResult).where(eq(t.agentResult.taskId, 'T7.claim_support'));
    expect(t7.length).toBeGreaterThan(0);
    expect(t7.every((x) => x.inputCanonical.startsWith('sha256:'))).toBe(true);
    // P4.5: the run points at the AI tool register
    expect((snap as any).ai_tool).toMatchObject({ id: 'anthropic-claude-cli', no_training: true });
  });
});
