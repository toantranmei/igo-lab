import { ClaudeCliRunner } from '@cl/agents';
import { closeDb, getDb } from '@cl/db';
import { processNextJob, writeWorkerStatus } from '@cl/pipeline';

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
  let lastBeat = Date.now();
  const idle = Number(process.env.WORKER_POLL_MS ?? 700);
  while (!stopping) {
    try {
      if (Date.now() - lastBeat > Number(process.env.WORKER_HEARTBEAT_MS ?? 20000)) {
        await heartbeat();
        lastBeat = Date.now();
      }
      const worked = await processNextJob(db, runner);
      if (!worked) await new Promise((r) => setTimeout(r, idle));
    } catch (e) {
      console.error('[worker] lỗi vòng lặp:', e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await closeDb();
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stopping = true));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
