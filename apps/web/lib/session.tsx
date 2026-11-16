'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSource, SessionState } from '@cl/contract';
import { ExampleSource } from '@cl/example';
import { LiveSource } from './live-source';

export const EXAMPLE_SESSION_ID = 'example';

interface SessionCtx {
  sessionId: string;
  source: SessionSource;
  state: SessionState | null;
  error: string | null;
  refresh(): Promise<void>;
  toast(message: string): void;
  toastText: string;
}
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const source = useMemo<SessionSource>(() => (sessionId === EXAMPLE_SESSION_ID ? new ExampleSource() : new LiveSource(sessionId)), [sessionId]);
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastText, setToast] = useState('');
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await source.getState();
      if (alive.current) {
        setState(s);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [source]);

  useEffect(() => {
    alive.current = true;
    setState(null);
    void refresh();
    const off = source.subscribe(() => void refresh());
    return () => {
      alive.current = false;
      off();
    };
  }, [source, refresh]);

  // Live: the worker / Claude CLI can come and go; re-check so the lock and its guidance stay current.
  const live = state?.mode === 'live';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [live, refresh]);

  const toast = useCallback((m: string) => setToast(m), []);
  const value = useMemo(() => ({ sessionId, source, state, error, refresh, toast, toastText }), [sessionId, source, state, error, refresh, toast, toastText]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
