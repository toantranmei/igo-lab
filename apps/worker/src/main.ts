import { ClaudeCliRunner, getBreaker, onBreakerTrip, restoreBreaker } from '@cl/agents';
import { closeDb, getDb } from '@cl/db';
import { purgeExpiredHumanData, processNextDataset, processNextJob, processNextSourceSearch, processScheduled, readBreaker, requeueOrphans, saveBreaker, writeWorkerStatus } from '@cl/pipeline';

/**
 * Worker: the only process that talks to the Claude CLI. It polls the job table, runs one block
 * attempt at a time and writes a heartbeat so the web UI can tell whether Live runs are possible.
 */
const db = getDb();
const runner = new ClaudeCliRunner();
let stopping = false;

async function heartbeat() {
  const s = await runner.status(true);
  await writeWorkerStatus(db, { ok: s.ok, version: s.version, message: s.message, breaker: getBreaker() });
  return s;
}

async function main() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) console.warn('[worker] ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN đang được đặt; chúng bị loại khỏi tiến trình con để CLI dùng phiên đăng nhập.');
  // a breaker tripped before a restart still holds: a restart must not spend more of an exhausted limit
  // CL_BREAKER_RESTORE=0 only for the throw-away e2e environment, whose database is reset on every run
  if (process.env.CL_BREAKER_RESTORE !== '0') restoreBreaker(await readBreaker(db));
  onBreakerTrip((b) => {
    console.warn(`[worker] cầu dao ngắt (${b.code}) tới ${b.until}: ${b.message}`);
    void saveBreaker(db, b).catch((e) => console.error('[worker] lưu cầu dao:', e?.message ?? e));
  });
  const orphans = await requeueOrphans(db, { all: true });
  if (orphans) console.log(`[worker] xếp lại ${orphans} job bị bỏ dở bởi worker trước.`);
  const first = await heartbeat();
  console.log(`[worker] ${first.message} (bin: ${runner.bin})`);
  // On a timer, not in the loop: one block can run for many minutes and the web must still see the worker alive.
  const beat = setInterval(() => void heartbeat().catch((e) => console.error('[worker] heartbeat:', e?.message ?? e)), Number(process.env.WORKER_HEARTBEAT_MS ?? 20000));
  const purge = () => purgeExpiredHumanData(db).then((n) => n.events + n.survey && console.log(`[worker] xóa dữ liệu người hết hạn lưu: ${n.events} sự kiện, ${n.survey} phiếu.`)).catch((e) => console.error('[worker] purge:', e?.message ?? e));
  void purge();
  const purgeTimer = setInterval(() => void purge(), 6 * 3600 * 1000);
  const idle = Number(process.env.WORKER_POLL_MS ?? 700);
  while (!stopping) {
    try {
      const worked = (await processNextJob(db, runner)) || (await processScheduled(db)) || (await processNextSourceSearch(db, runner)) || (await processNextDataset(db));
      if (!worked) await new Promise((r) => setTimeout(r, idle));
    } catch (e) {
      console.error('[worker] lỗi vòng lặp:', e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  clearInterval(beat);
  clearInterval(purgeTimer);
  await closeDb();
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stopping = true));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
