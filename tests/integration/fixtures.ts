import { MAIN_BLOCK_IDS, type BlockId } from '@cl/contract';
import { ClaudeCliRunner } from '@cl/agents';
import type { Db } from '@cl/db';
import { acknowledge, confirmJdSet, createRun, createSession, processNextJob, startAttempt } from '@cl/pipeline';
import { FAKE_CLAUDE, WS } from './helpers';

export const jd = (org: string, lines: string[]) => [`Mô tả công việc: Product Owner — ${org}`, ...lines].join('\n');
export const JD_A = jd('Công ty A', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NV: Viết tiêu chí nghiệm thu cho hạng mục [k2]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]', 'NL: Viết tiêu chí nghiệm thu — Khả năng mô tả điều kiện hoàn thành kiểm được [k2]']);
export const JD_B = jd('Công ty B', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NV: Đo lường kết quả sau phát hành [k3]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]', 'NL: Đo lường giá trị — Khả năng chọn chỉ số và đọc kết quả sau phát hành [k3]']);
export const JD_OTHER = 'Mô tả công việc: Kế toán trưởng\nNV: Lập báo cáo tài chính [k9]\nNL: Lập báo cáo — Khả năng lập báo cáo tài chính [k9]';
/** Second-run JD: same name as an existing competency but a wider definition (→ UPDATE) plus a brand-new one (→ ADD). */
export const JD_C = jd('Công ty C', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NV: Điều phối các bên liên quan [k4]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị, chi phí trì hoãn và rủi ro [k1]', 'NL: Điều phối bên liên quan — Khả năng thống nhất kỳ vọng giữa các bên [k4]']);

export const runner = (over: { timeoutMs?: number } = {}) => new ClaudeCliRunner({ bin: FAKE_CLAUDE, timeoutMs: over.timeoutMs ?? 5000 });
export const doc = (name: string, text: string, org = 'Tổ chức ' + name) => ({ name, text, source_ref: `paste://${name}`, origin_group: org });

export async function newSession(db: Db, docs: ReturnType<typeof doc>[], name = 'Phiên thử') {
  const { id } = await createSession(db, WS, { name, role_title: 'Product Owner', purpose: 'Xây khung năng lực nháp', context: 'Công ty phần mềm' }, 'local');
  await confirmJdSet(db, WS, id, docs, 'local');
  const run = await createRun(db, WS, id, { acknowledge_send: true, cli_version: '2.1.325' }, 'local');
  return { sessionId: id, runId: run.id };
}
let n = 0;
export async function step(db: Db, sessionId: string, block: BlockId, r = runner(), opts: { rerun_tasks?: string[] } = {}) {
  await startAttempt(db, WS, sessionId, block, `k-${++n}-${Date.now()}`, { actor: 'local', skipAgentCheck: true, ...opts });
  await processNextJob(db, r);
}
export async function runThrough(db: Db, sessionId: string, upTo: BlockId = 'B8', r = runner()) {
  for (const b of MAIN_BLOCK_IDS) {
    await step(db, sessionId, b, r);
    await acknowledge(db, WS, sessionId, b, 'local').catch(() => {});
    if (b === upTo) break;
  }
}
