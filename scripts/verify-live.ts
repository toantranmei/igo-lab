import { MAIN_BLOCK_IDS, type BlockId } from '@cl/contract';
import { WS, arg, done, freshDb, getDetail, newRun, realRunner, runBlocks } from './lib';

/**
 * pnpm verify:live [--upto=B8]
 * Runs one Live session with two sample JDs through the REAL Claude CLI on a scratch database and
 * prints what each block did. Use --upto=B1 for a cheap smoke test (2 small calls).
 */
async function main() {
  const upTo = arg('upto', 'B8') as BlockId;
  if (!(MAIN_BLOCK_IDS as readonly string[]).includes(upTo)) throw new Error(`--upto phải là một trong ${MAIN_BLOCK_IDS.join(', ')}`);
  const { runner, version } = await realRunner();
  console.log(`Gửi 2 JD mẫu (tự soạn, không có dữ liệu thật) tới Anthropic qua Claude CLI, chạy tới ${upTo}…`);
  const db = await freshDb();
  const sid = await newRun(db, version);
  const reports = await runBlocks(db, runner, sid, upTo);
  const last = reports.at(-1)!;
  const ok = last.block === upTo && (last.state === 'awaiting_view' || last.state === 'pass');
  if (reports.some((r) => r.block === 'B3')) {
    const b3 = await getDetail(db, WS, sid, 'B3');
    const groups = ((b3.raw as any)?.groups ?? []) as { label: string; decision?: string }[];
    console.log(`\nNăng lực ứng viên ở B3 (${groups.length}):`);
    for (const g of groups) console.log(`  · ${g.label}${g.decision ? `  [${g.decision}]` : ''}`);
  }
  const total = reports.reduce((n, r) => n + r.calls, 0);
  console.log(`\n${ok ? '✓ ĐẠT' : `✗ DỪNG ở ${last.block} (${last.state})`} · ${total} lời gọi CLI · ${Math.round(reports.reduce((n, r) => n + r.ms, 0) / 1000)} giây`);
  await done();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => {
  console.error('✗', e?.code ?? '', e?.message ?? e);
  await done().catch(() => {});
  process.exit(1);
});
