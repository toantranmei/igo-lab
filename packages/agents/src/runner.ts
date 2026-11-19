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
  /** Aborted when the block stops: calls still waiting for a slot return CANCELLED without spawning. */
  signal?: AbortSignal;
}
export type CliErrorCode = 'CLI_NOT_FOUND' | 'CLI_ERROR' | 'TIMEOUT' | 'NO_STRUCTURED_OUTPUT' | 'NOT_LOGGED_IN' | 'QUOTA' | 'CANCELLED';
export interface CliResponse {
  ok: boolean;
  structured: unknown;
  errorCode?: CliErrorCode;
  errorMessage?: string;
  /** true when the breaker refused the call: no `claude` process was spawned. */
  blocked?: boolean;
  /** For QUOTA / breaker refusals: when the limit resets (ISO). */
  until?: string | null;
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

/* ---------------------------------------------------------------- usage-limit circuit breaker */

export const QUOTA_PATTERN = /hit your .*limit|usage limit/i;

/** Offset (ms) of a time zone at a given instant: local wall clock − UTC. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Reads the reset time out of a usage-limit message, e.g. "resets 2:30am (Asia/Saigon)" or "resets 11pm".
 * Returns the next instant (after `now`) with that wall-clock time in that zone, or null when there is none.
 */
export function parseQuotaReset(text: string, now = new Date()): string | null {
  const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  let zone = m[4]?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const off = tzOffsetMs(zone, now);
  const local = new Date(now.getTime() + off); // wall clock in that zone, expressed as UTC fields
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, min) - off;
  if (target <= now.getTime()) target += 24 * 3600 * 1000;
  // re-anchor in case a DST change lies between now and the target
  target -= tzOffsetMs(zone, new Date(target)) - off;
  return new Date(target).toISOString();
}

export type BreakerCode = 'QUOTA' | 'NOT_LOGGED_IN' | 'AI_ERROR';
export interface BreakerState {
  code: BreakerCode;
  message: string;
  /** Reopens by itself at this time (ISO). */
  until: string;
  tripped_at: string;
}
/** Without a readable reset time the breaker stays open this long, then lets one call probe. */
const FALLBACK_HOLD_MS: Record<BreakerCode, number> = { QUOTA: 60 * 60 * 1000, NOT_LOGGED_IN: 2 * 60 * 1000, AI_ERROR: 2 * 60 * 1000 };
export const AI_ERROR_STREAK = 3;

/** One breaker per process: every runner instance in the worker shares it, so one usage-limit error stops all queued calls. */
const breaker = { state: null as BreakerState | null, cliErrorStreak: 0, listeners: new Set<(s: BreakerState) => void>() };

export function getBreaker(now = Date.now()): BreakerState | null {
  if (breaker.state && new Date(breaker.state.until).getTime() <= now) breaker.state = null;
  return breaker.state;
}
export function tripBreaker(code: BreakerCode, message: string, until?: string | null, now = Date.now()): BreakerState {
  const s: BreakerState = { code, message: message.slice(0, 300), until: until ?? new Date(now + FALLBACK_HOLD_MS[code]).toISOString(), tripped_at: new Date(now).toISOString() };
  breaker.state = s;
  breaker.cliErrorStreak = 0;
  for (const l of breaker.listeners) l(s);
  return s;
}
/** Restores a breaker persisted by an earlier worker process (ignored when already expired). */
export function restoreBreaker(s: BreakerState | null | undefined) {
  if (s && new Date(s.until).getTime() > Date.now()) breaker.state = s;
}
export function resetBreaker() {
  breaker.state = null;
  breaker.cliErrorStreak = 0;
}
/** Called whenever the breaker trips (the worker persists it so the web can refuse new runs). */
export function onBreakerTrip(fn: (s: BreakerState) => void): () => void {
  breaker.listeners.add(fn);
  return () => breaker.listeners.delete(fn);
}
const blockedResponse = (s: BreakerState): CliResponse => ({ ok: false, structured: null, errorCode: s.code === 'NOT_LOGGED_IN' ? 'NOT_LOGGED_IN' : s.code === 'QUOTA' ? 'QUOTA' : 'CLI_ERROR', errorMessage: `Cầu dao đang ngắt (${s.code}) tới ${s.until}: ${s.message}`, durationMs: 0, blocked: true, until: s.until });

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
    // A token copied from the wrapped output of `claude setup-token` often carries spaces or line breaks; the CLI then
    // answers "Not logged in" without calling the API (seen on production, 19/11/2026). Tokens contain no whitespace.
    if (env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN.replace(/\s+/g, '');
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
    const cancelled = (): CliResponse => ({ ok: false, structured: null, errorCode: 'CANCELLED', errorMessage: 'Bước đã dừng; lời gọi đang chờ bị hủy.', durationMs: 0, blocked: true });
    if (req.signal?.aborted) return cancelled();
    const before = getBreaker();
    if (before) return blockedResponse(before);
    const res = await this.sem.run(async (): Promise<CliResponse> => {
      // checked again after the wait: the block may have stopped, or the breaker tripped, while this call sat in the queue
      if (req.signal?.aborted) return cancelled();
      const queued = getBreaker();
      if (queued) return blockedResponse(queued);
      const cwd = await mkdtemp(path.join(os.tmpdir(), 'cl-agent-'));
      // last check right before spawning: the breaker or the block may have stopped during mkdtemp
      const late = getBreaker();
      if (req.signal?.aborted || late) {
        await rm(cwd, { recursive: true, force: true }).catch(() => {});
        return req.signal?.aborted ? cancelled() : blockedResponse(late!);
      }
      const spawnedAt = Date.now();
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
        const out = ((): CliResponse => {
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
            const text = String(parsed?.result || r.stderr || r.stdout || '').slice(0, 500);
            if (QUOTA_PATTERN.test(text)) return { ok: false, structured: null, errorCode: 'QUOTA', errorMessage: text, durationMs, usage: parsed?.usage, costUsd: parsed?.total_cost_usd, until: parseQuotaReset(text) };
            const notLoggedIn = /log ?in|not authenticated|credential|oauth|401/i.test(text);
            return { ok: false, structured: null, errorCode: notLoggedIn ? 'NOT_LOGGED_IN' : 'CLI_ERROR', errorMessage: text || `claude thoát với mã ${r.code}`, durationMs, usage: parsed?.usage, costUsd: parsed?.total_cost_usd };
          }
          const model = parsed.modelUsage ? Object.keys(parsed.modelUsage)[0] : undefined;
          if (parsed.structured_output === undefined || parsed.structured_output === null)
            return { ok: false, structured: null, errorCode: 'NO_STRUCTURED_OUTPUT', errorMessage: 'CLI không trả structured_output', durationMs, usage: parsed.usage, costUsd: parsed.total_cost_usd, model };
          return { ok: true, structured: parsed.structured_output, durationMs: parsed.duration_ms ?? durationMs, usage: parsed.usage, costUsd: parsed.total_cost_usd, model };
        })();
        this.judge(out, spawnedAt);
        return out;
      } finally {
        await rm(cwd, { recursive: true, force: true }).catch(() => {});
      }
    });
    return res;
  }

  /**
   * Trips the breaker from a finished call. Runs INSIDE the semaphore slot, before it is released, so the next queued
   * call already sees the breaker open. Results of calls spawned before the last trip do not count towards a new streak.
   */
  private judge(res: CliResponse, spawnedAt: number) {
    if (res.blocked) return;
    const st = breaker.state;
    if (st && Date.parse(st.tripped_at) > spawnedAt) return;
    if (res.errorCode === 'QUOTA') tripBreaker('QUOTA', res.errorMessage ?? 'Hết hạn mức', res.until);
    else if (res.errorCode === 'NOT_LOGGED_IN') tripBreaker('NOT_LOGGED_IN', res.errorMessage ?? 'Chưa đăng nhập');
    else if (res.errorCode === 'CLI_ERROR') {
      if (++breaker.cliErrorStreak >= AI_ERROR_STREAK) tripBreaker('AI_ERROR', `${AI_ERROR_STREAK} lỗi CLI liên tiếp. Lỗi cuối: ${res.errorMessage ?? ''}`);
    } else if (res.ok) breaker.cliErrorStreak = 0;
  }
}
