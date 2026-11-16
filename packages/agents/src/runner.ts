import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface CliRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model: string;
  effort: string;
}
export interface CliResponse {
  ok: boolean;
  structured: unknown;
  errorCode?: 'CLI_NOT_FOUND' | 'CLI_ERROR' | 'TIMEOUT' | 'NO_STRUCTURED_OUTPUT' | 'NOT_LOGGED_IN';
  errorMessage?: string;
  durationMs: number;
  usage?: unknown;
  costUsd?: number;
  model?: string;
}
export interface AgentStatus {
  ok: boolean;
  bin: string;
  version: string | null;
  message: string;
}

export const MIN_CLI_VERSION = '2.1.0';

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function cmpVersion(a: string, b: string) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Runs one `claude -p` process per task call: no tools, no user/project settings, no MCP, no session
 * persistence, a full system-prompt replacement and an output JSON Schema. The prompt goes in on stdin
 * and the process runs in an empty temp directory so nothing on the host can leak into the call.
 */
export class ClaudeCliRunner {
  readonly bin: string;
  readonly timeoutMs: number;
  private sem: Semaphore;
  private cachedStatus: { at: number; value: AgentStatus } | null = null;

  constructor(opts: { bin?: string; timeoutMs?: number; maxParallel?: number } = {}) {
    this.bin = opts.bin ?? process.env.CLAUDE_BIN ?? 'claude';
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.AGENT_TIMEOUT_MS ?? 180000);
    this.sem = new Semaphore(opts.maxParallel ?? Number(process.env.AGENT_MAX_PARALLEL ?? 3));
  }

  /** Child environment: API-key variables are removed because the CLI would prefer them over the login/token. */
  private env(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return env;
  }

  private exec(args: string[], stdin: string | null, timeoutMs: number, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: NodeJS.ErrnoException }> {
    return new Promise((resolve) => {
      let stdout = '', stderr = '', timedOut = false, done = false;
      const child = spawn(this.bin, args, { cwd, env: this.env(), stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      const finish = (code: number | null, spawnError?: NodeJS.ErrnoException) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut, spawnError });
      };
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => finish(null, e as NodeJS.ErrnoException));
      child.on('close', (code) => finish(code));
      child.stdin.on('error', () => {});
      child.stdin.end(stdin ?? '');
    });
  }

  async status(force = false): Promise<AgentStatus> {
    if (!force && this.cachedStatus && Date.now() - this.cachedStatus.at < 30000) return this.cachedStatus.value;
    let value: AgentStatus;
    const r = await this.exec(['--version'], null, 15000);
    if (r.spawnError || r.code !== 0) {
      value = { ok: false, bin: this.bin, version: null, message: `Không tìm thấy Claude CLI ("${this.bin}"). Cài Claude Code, đăng nhập bằng \`claude\` (hoặc đặt CLAUDE_CODE_OAUTH_TOKEN cho worker), rồi khởi động lại worker.` };
    } else {
      const version = (r.stdout.match(/\d+\.\d+\.\d+/) ?? [null])[0];
      if (!version || cmpVersion(version, MIN_CLI_VERSION) < 0) value = { ok: false, bin: this.bin, version, message: `Claude CLI ${version ?? '?'} cũ hơn mức tối thiểu ${MIN_CLI_VERSION}. Chạy \`claude update\`.` };
      else if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) value = { ok: true, bin: this.bin, version, message: `Claude CLI ${version}. Lưu ý: ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN đang được đặt; worker đã loại chúng khỏi tiến trình con để dùng phiên đăng nhập CLI.` };
      else value = { ok: true, bin: this.bin, version, message: `Claude CLI ${version} sẵn sàng.` };
    }
    this.cachedStatus = { at: Date.now(), value };
    return value;
  }

  async run(req: CliRequest): Promise<CliResponse> {
    return this.sem.run(async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), 'cl-agent-'));
      const started = Date.now();
      try {
        const args = [
          '-p',
          '--model', req.model,
          '--effort', req.effort,
          '--system-prompt', req.system,
          '--json-schema', JSON.stringify(req.schema),
          '--output-format', 'json',
          '--tools', '',
          '--strict-mcp-config',
          '--disable-slash-commands',
          '--setting-sources', '',
          '--no-session-persistence',
        ];
        const r = await this.exec(args, req.user, this.timeoutMs, cwd);
        const durationMs = Date.now() - started;
        if (r.spawnError) return { ok: false, structured: null, errorCode: 'CLI_NOT_FOUND', errorMessage: r.spawnError.message, durationMs };
        if (r.timedOut) return { ok: false, structured: null, errorCode: 'TIMEOUT', errorMessage: `Quá ${this.timeoutMs} ms`, durationMs };
        let parsed: any = null;
        try {
          parsed = JSON.parse(r.stdout);
        } catch {
          /* not JSON */
        }
        if (!parsed || r.code !== 0 || parsed.is_error) {
          const text = String(parsed?.result ?? r.stderr ?? r.stdout ?? '').slice(0, 500);
          const notLoggedIn = /log ?in|not authenticated|credential|oauth|401/i.test(text);
          return { ok: false, structured: null, errorCode: notLoggedIn ? 'NOT_LOGGED_IN' : 'CLI_ERROR', errorMessage: text || `claude thoát với mã ${r.code}`, durationMs, usage: parsed?.usage, costUsd: parsed?.total_cost_usd };
        }
        const model = parsed.modelUsage ? Object.keys(parsed.modelUsage)[0] : undefined;
        if (parsed.structured_output === undefined || parsed.structured_output === null)
          return { ok: false, structured: null, errorCode: 'NO_STRUCTURED_OUTPUT', errorMessage: 'CLI không trả structured_output', durationMs, usage: parsed.usage, costUsd: parsed.total_cost_usd, model };
        return { ok: true, structured: parsed.structured_output, durationMs: parsed.duration_ms ?? durationMs, usage: parsed.usage, costUsd: parsed.total_cost_usd, model };
      } finally {
        await rm(cwd, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
}
