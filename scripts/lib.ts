import postgres from 'postgres';
import { ClaudeCliRunner } from '@cl/agents';
import { MAIN_BLOCK_IDS, type BlockId } from '@cl/contract';
import { DEFAULT_WORKSPACE_ID, closeDb, getDb, runMigrations, t, type Db } from '@cl/db';
import { acknowledge, confirmJdSet, createRun, createSession, getDetail, getState, processNextJob, startAttempt } from '@cl/pipeline';
import { eq } from 'drizzle-orm';

/**
 * Shared by verify:live and verify:stability. These scripts call the REAL Claude CLI (they spend tokens and
 * send the sample JDs below to Anthropic). They use a scratch database, never the working one.
 */
export const WS = DEFAULT_WORKSPACE_ID;
export const OWNER_URL = process.env.VERIFY_DATABASE_OWNER_URL ?? 'postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab_test';
export const APP_URL = process.env.VERIFY_DATABASE_URL ?? 'postgres://cl_app:cl_app_dev@127.0.0.1:5570/competence_lab_test';

export const SAMPLE_JDS = [
  {
    name: 'JD mẫu 1 (tự soạn)',
    text: `Mô tả công việc: Product Owner — nền tảng thanh toán
Trách nhiệm chính:
- Xây dựng và duy trì product backlog, sắp xếp thứ tự ưu tiên theo giá trị kinh doanh, chi phí trì hoãn và rủi ro.
- Viết user story và tiêu chí chấp nhận rõ ràng, kiểm được, thống nhất với đội phát triển trước mỗi sprint.
- Phỏng vấn người dùng và phân tích dữ liệu sử dụng để kiểm chứng giả thuyết về nhu cầu trước khi đầu tư phát triển.
- Xác định chỉ số kết quả cho từng tính năng, ghi nhận baseline và đánh giá kết quả sau phát hành.
Yêu cầu:
- Có khả năng điều phối các bên liên quan có nhu cầu xung đột và ghi lại quyết định.
- Thành thạo phân tích dữ liệu sản phẩm cơ bản bằng SQL hoặc công cụ BI.`,
  },
  {
    name: 'JD mẫu 2 (tự soạn)',
    text: `Tuyển dụng Product Owner — ứng dụng bán lẻ
Nhiệm vụ:
- Chuyển mục tiêu kinh doanh thành mục tiêu sản phẩm và lộ trình theo quý.
- Quản lý backlog: ưu tiên hạng mục dựa trên giá trị và mức độ rủi ro, giải thích đánh đổi cho các bên.
- Làm việc với đội kỹ thuật để làm rõ phạm vi sprint, nghiệm thu hạng mục theo tiêu chí chấp nhận.
- Theo dõi chỉ số sau phát hành và đề xuất điều chỉnh dựa trên dữ liệu.
Năng lực cần có:
- Khám phá nhu cầu khách hàng qua phỏng vấn và thử nghiệm.
- Giao tiếp và thống nhất kỳ vọng với các bên liên quan trong kinh doanh và kỹ thuật.`,
  },
];

export async function freshDb(): Promise<Db> {
  process.env.DATABASE_URL = APP_URL;
  await runMigrations(OWNER_URL);
  const sql = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  await sql.unsafe(`truncate ${tables.map((x) => `"${x.tablename}"`).join(', ')} restart identity cascade`);
  await sql`insert into workspace (id, name) values (${WS}, 'Workspace kiểm thử')`;
  await sql.end();
  return getDb(APP_URL);
}
export const done = () => closeDb(APP_URL);

export async function realRunner() {
  const runner = new ClaudeCliRunner();
  const s = await runner.status(true);
  if (!s.ok) {
    console.error(`✗ ${s.message}`);
    process.exit(2);
  }
  console.log(`Claude CLI ${s.version} (${runner.bin})`);
  return { runner, version: s.version };
}

export async function newRun(db: Db, cliVersion: string | null) {
  const { id } = await createSession(db, WS, { name: 'verify', role_title: 'Product Owner', purpose: 'Khung nháp nội bộ để kiểm tra đường ống', context: 'Công ty công nghệ' }, 'local');
  await confirmJdSet(db, WS, id, SAMPLE_JDS.map((d) => ({ ...d, source_ref: `sample://${d.name}`, origin_group: d.name })), 'local');
  await createRun(db, WS, id, { acknowledge_send: true, cli_version: cliVersion ?? undefined }, 'local');
  return id;
}

export interface BlockReport { block: BlockId; state: string; ms: number; calls: number; cached: number; summary: string; error?: string }
/** Runs blocks in order until `upTo` or the first block that does not pass. */
export async function runBlocks(db: Db, runner: ClaudeCliRunner, sessionId: string, upTo: BlockId, log = true): Promise<BlockReport[]> {
  const out: BlockReport[] = [];
  let seen = 0;
  for (const block of MAIN_BLOCK_IDS) {
    const t0 = Date.now();
    await startAttempt(db, WS, sessionId, block, `verify-${block}-${t0}`, { actor: 'local', skipAgentCheck: true });
    await processNextJob(db, runner);
    const state = await getState(db, WS, sessionId);
    const card = state.cards.find((c) => c.id === block)!;
    const calls = await db.select().from(t.agentCall).where(eq(t.agentCall.workspaceId, WS));
    const mine = calls.slice(seen);
    seen = calls.length;
    const r: BlockReport = { block, state: card.state, ms: Date.now() - t0, calls: mine.filter((c) => !c.cacheHit).length, cached: mine.filter((c) => c.cacheHit).length, summary: card.receipt ?? '', error: mine.find((c) => c.status !== 'OK')?.error ?? undefined };
    out.push(r);
    if (log) console.log(`${r.state === 'awaiting_view' || r.state === 'pass' ? '✓' : '✗'} ${block}  ${String(r.ms).padStart(6)} ms  ${r.calls} lời gọi CLI, ${r.cached} từ cache  ${r.summary}${r.error ? `  [${r.error}]` : ''}`);
    if (card.state !== 'awaiting_view' && card.state !== 'pass') break;
    await acknowledge(db, WS, sessionId, block, 'local');
    if (block === upTo) break;
  }
  return out;
}
export const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
export { getDetail, getState };
