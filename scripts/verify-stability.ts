import type { BlockId } from '@cl/contract';
import { WS, arg, done, freshDb, getDetail, newRun, realRunner, runBlocks } from './lib';

/**
 * pnpm verify:stability [--runs=3] [--upto=B3]
 * Repeats the same Live run N times from an EMPTY cache (so every agent call really reaches the CLI)
 * and reports how much the B3 candidate competencies differ between runs. Costs N full runs up to --upto.
 * Inside the app this variation is not visible to users: a stored answer is reused for identical input.
 */
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 1;
};
async function main() {
  const runs = Math.max(2, Number(arg('runs', '3')));
  const upTo = arg('upto', 'B3') as BlockId;
  const { runner, version } = await realRunner();
  console.log(`Chạy ${runs} lần độc lập tới ${upTo} (mỗi lần xóa cache, gọi CLI thật)…`);
  const sets: Set<string>[] = [];
  const counts: string[] = [];
  for (let i = 0; i < runs; i++) {
    const db = await freshDb();
    const sid = await newRun(db, version);
    const reports = await runBlocks(db, runner, sid, upTo, false);
    const last = reports.at(-1)!;
    if (!reports.some((r) => r.block === 'B3')) {
      console.log(`  lần ${i + 1}: dừng ở ${last.block} (${last.state}) ${last.error ?? ''}`);
      sets.push(new Set());
      counts.push('-');
      continue;
    }
    const raw = (await getDetail(db, WS, sid, 'B3')).raw as any;
    const labels = new Set<string>((raw?.groups ?? []).map((g: any) => norm(g.label)));
    sets.push(labels);
    counts.push(JSON.stringify(raw?.counts ?? {}));
    console.log(`  lần ${i + 1}: ${labels.size} năng lực ứng viên · ${reports.reduce((n, r) => n + r.calls, 0)} lời gọi · ${[...labels].join(' | ')}`);
  }
  const pairs: number[] = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) pairs.push(jaccard(sets[i], sets[j]));
  const mean = pairs.reduce((a, b) => a + b, 0) / pairs.length;
  console.log(`\nSố năng lực mỗi lần: ${sets.map((s) => s.size).join(', ')}`);
  console.log(`Độ trùng nhãn giữa các cặp lần chạy (Jaccard trên nhãn đã chuẩn hóa): trung bình ${(mean * 100).toFixed(0)}%, thấp nhất ${(Math.min(...pairs) * 100).toFixed(0)}%`);
  console.log(`Quyết định ADD/UPDATE/REUSE giống nhau ở mọi lần: ${new Set(counts).size === 1 ? 'có' : 'không'}`);
  console.log('Lưu ý: nhãn do model đặt nên có thể khác chữ dù cùng nội hàm; con số này là cận dưới của độ ổn định ngữ nghĩa.');
  await done();
}
main().catch(async (e) => {
  console.error('✗', e?.code ?? '', e?.message ?? e);
  await done().catch(() => {});
  process.exit(1);
});
