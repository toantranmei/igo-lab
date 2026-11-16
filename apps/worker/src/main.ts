import { ClaudeCliRunner } from '@cl/agents';
import { closeDb, getDb } from '@cl/db';
import { processNextDataset, processNextJob, processNextSourceSearch, writeWorkerStatus } from '@cl/pipeline';

/**
 * Worker: the only process that talks to the Claude CLI. It polls the job table, runs one block
 * attempt at a time and writes a heartbeat so the web UI can tell whether Live runs are possible.
 */
const db = getDb();
const runner = new ClaudeCliRunner();
let stopping = false;

async function heartbeat() {
  const s = await runner.status(true);
  await writeWorkerStatus(db, { ok: s.ok, version: s.version, message: s.message });
  return s;
}

async function main() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) console.warn('[worker] ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN đang được đặt; chúng bị loại khỏi tiến trình con để CLI dùng phiên đăng nhập.');
  const first = await heartbeat();
  console.log(`[worker] ${first.message} (bin: ${runner.bin})`);
  // On a timer, not in the loop: one block can run for many minutes and the web must still see the worker alive.
  const beat = setInterval(() => void heartbeat().catch((e) => console.error('[worker] heartbeat:', e?.message ?? e)), Number(process.env.WORKER_HEARTBEAT_MS ?? 20000));
  const idle = Number(process.env.WORKER_POLL_MS ?? 700);
  while (!stopping) {
    try {
      const worked = (await processNextJob(db, runner)) || (await processNextSourceSearch(db, runner)) || (await processNextDataset(db));
      if (!worked) await new Promise((r) => setTimeout(r, idle));
    } catch (e) {
      console.error('[worker] lỗi vòng lặp:', e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  clearInterval(beat);
  await closeDb();
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stopping = true));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
