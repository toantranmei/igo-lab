import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a throw-away database and a fake Claude CLI: no real model is ever called here.
 * Ports and the DB name differ from the dev defaults so a running dev server is not disturbed.
 */
const PORT = Number(process.env.E2E_PORT ?? 3111);
const DB = 'postgres://cl_app:cl_app_dev@127.0.0.1:5570/competence_lab_test';
const DATA_DIR = path.resolve(__dirname, '.e2e-data');
const env = { DATABASE_URL: DB, DATA_DIR, CLAUDE_BIN: path.resolve(__dirname, 'tests/fake-claude/claude.mjs'), FAKE_CLAUDE_CONTROL: path.join(DATA_DIR, 'fake-mode'), AGENT_RETRY_DELAY_MS: '1', WORKER_POLL_MS: '150', WORKER_HEARTBEAT_MS: '1500', NEXT_TELEMETRY_DISABLED: '1' };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: `pnpm --filter @cl/web exec next build && pnpm --filter @cl/web exec next start -p ${PORT} -H 127.0.0.1`, url: `http://127.0.0.1:${PORT}/api/limits`, reuseExistingServer: false, timeout: 300_000, env: { ...process.env, ...env } as Record<string, string> },
    // same build, but the local actor may only view: used by the permission checks of A09
    { command: `pnpm --filter @cl/web exec next start -p ${PORT + 1} -H 127.0.0.1`, url: `http://127.0.0.1:${PORT + 1}/api/limits`, reuseExistingServer: false, timeout: 60_000, env: { ...process.env, ...env, LOCAL_ACTOR_PERMISSIONS: 'VIEW' } as Record<string, string> },
    { command: 'pnpm --filter @cl/worker start', wait: { stdout: /\[worker\]/ }, reuseExistingServer: false, timeout: 60_000, stdout: 'pipe', env: { ...process.env, ...env } as Record<string, string> },
  ],
});
