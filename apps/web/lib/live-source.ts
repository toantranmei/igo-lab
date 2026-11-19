'use client';
import type { BlockDetail, BlockId, BlockTrace, PendingGuide, SessionSource, SessionState } from '@cl/contract';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown, public actions: string[] = [], public attemptId?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  let body = init?.body;
  if (init?.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch('/api' + path, { ...init, headers, body, cache: 'no-store' });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.code ?? 'HTTP_' + res.status, data?.message ?? res.statusText, data?.details, data?.actions ?? [], data?.attempt_id);
  return data as T;
}

/** Live sessions: state lives on the server; this class only calls the API and polls while a block is running. */
export class LiveSource implements SessionSource {
  readonly mode = 'live' as const;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRunning = false;

  constructor(public sessionId: string) {}

  private emit() {
    this.listeners.forEach((l) => l());
  }
  private key(id: BlockId) {
    return `/sessions/${this.sessionId}/current/blocks/${id}`;
  }

  async getState(): Promise<SessionState> {
    const s = await api<SessionState>(`/sessions/${this.sessionId}/state`);
    this.lastRunning = s.cards.some((c) => c.state === 'running');
    return s;
  }
  getDetail(id: BlockId) {
    return api<BlockDetail>(this.key(id) + '/detail');
  }
  getTrace(id: BlockId, preview: boolean) {
    return api<BlockTrace | null>(this.key(id) + '/trace' + (preview ? '?preview=1' : ''));
  }
  async begin(id: BlockId): Promise<PendingGuide> {
    const key = `${this.sessionId}:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const p = await api<PendingGuide>(this.key(id) + '/attempts', { method: 'POST', headers: { 'Idempotency-Key': key }, json: {} });
    this.emit();
    return p;
  }
  async progress(id: BlockId, cursor: number, atEnd: boolean) {
    await api(this.key(id) + '/cursor', { method: 'PUT', json: { cursor, atEnd } });
    if (atEnd) this.emit();
  }
  async acknowledge(id: BlockId) {
    await api(this.key(id) + '/ack', { method: 'POST', json: {} });
    this.emit();
  }
  async reset() {
    /* Live never deletes: "Bắt đầu lại" opens the new-run dialog instead (handled by the shell). */
  }
  async recover(reason: string) {
    await api(`/workspace/reopen`, { method: 'POST', json: { reason, session_id: this.sessionId } });
    this.emit();
  }
  async rejectLessons(reason: string) {
    await api(`/lessons/decision`, { method: 'POST', json: { decision: 'REJECTED', reason, session_id: this.sessionId } });
    this.emit();
  }
  async approveLessons(reason: string) {
    await api(`/lessons/decision`, { method: 'POST', json: { decision: 'SAFE', reason, session_id: this.sessionId } });
    this.emit();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (!this.timer)
      this.timer = setInterval(() => {
        if (this.lastRunning) this.emit();
      }, 1500);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }
}
