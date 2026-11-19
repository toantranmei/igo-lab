'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { gateBlocks, type BlockId, type TraceKind } from '@cl/contract';
import { GuideContext, type GuideApi } from '@/lib/guide-api';
import { useSession } from '@/lib/session';
import GuideView from './GuideView';
import { paneForKind, type MobilePane, type ViewerActions, type ViewerState } from './types';
import './guide.css';

const BEAT_MS = 1900;
const LEAVE_MS = 180;
const POLL_MS = 1500;

/** Pending guides already auto-reopened in this page load (survives tab navigation, not a reload). */
const autoOpened = new Set<string>();

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `resume`: reopen a pending block's guide on page load (the old production line). The new Live screens never wait on it. */
export default function GuideProvider({ children, resume = true }: { children: React.ReactNode; resume?: boolean }) {
  const { sessionId, source, state, refresh, toast } = useSession();
  const [viewer, setViewerState] = useState<ViewerState | null>(null);
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [leaving, setLeaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewerRef = useRef<ViewerState | null>(null);
  const stateRef = useRef(state);
  const tokenRef = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const primedRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setViewer = useCallback((v: ViewerState | null) => {
    viewerRef.current = v;
    setViewerState(v);
  }, []);
  /** Patch the viewer only if it is still the load identified by `token`. */
  const patch = useCallback(
    (token: number, p: Partial<ViewerState>) => {
      const v = viewerRef.current;
      if (!v || v.token !== token) return false;
      setViewer({ ...v, ...p });
      return true;
    },
    [setViewer],
  );

  /** Serialises writes to the source so cursors are persisted in the order they happened. */
  const enqueue = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(job).catch((e) => toast(errText(e)));
    return queue.current;
  }, [toast]);

  const persist = useCallback(
    (token: number, id: BlockId, cursor: number, atEnd: boolean) =>
      enqueue(async () => {
        await source.progress(id, cursor, atEnd);
        if (!atEnd) return;
        const v = viewerRef.current;
        const first = !v || v.token !== token || !v.committed;
        patch(token, { committed: true });
        // The source commits at the last beat: bring the page behind up to date.
        if (first) await refresh();
      }),
    [enqueue, source, patch, refresh],
  );

  const load = useCallback(
    (token: number, id: BlockId, preview: boolean, startCursor: number) => {
      const tick = async () => {
        if (tokenRef.current !== token) return;
        try {
          const [detail, trace] = await Promise.all([source.getDetail(id).catch(() => null), source.getTrace(id, preview)]);
          if (tokenRef.current !== token) return;
          const v = viewerRef.current;
          if (!v || v.token !== token) return;
          if (trace && trace.events.length) {
            const lastIndex = trace.events.length - 1;
            const cursor = Math.max(0, Math.min(startCursor, lastIndex));
            const first = trace.events[cursor];
            setViewer({
              ...v,
              detail,
              trace,
              cursor,
              furthest: cursor,
              waiting: null,
              loadError: null,
              pane: paneForKind(first.kind),
              recordKey: first.record_refs[0] ?? trace.records[0]?.key ?? null,
            });
            if (!preview) {
              if (v.waited) void refresh();
              if (cursor === lastIndex && !v.committed) void persist(token, id, cursor, true);
            }
            return;
          }
          if (detail?.error) {
            setViewer({ ...v, detail, waiting: null, loadError: null });
            if (!preview) void refresh();
            return;
          }
          const computing = !preview || detail?.state === 'running';
          setViewer({ ...v, detail, waiting: computing ? 'computing' : 'empty', waited: computing, loadError: null });
          if (computing) pollTimer.current = setTimeout(() => void tick(), POLL_MS);
        } catch (e) {
          if (tokenRef.current === token) patch(token, { waiting: null, loadError: errText(e) });
        }
      };
      void tick();
    },
    [source, setViewer, patch, refresh, persist],
  );

  const open = useCallback(
    (id: BlockId, preview: boolean, startCursor: number, committed: boolean) => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      setLeaving(false);
      const dlg = dialogRef.current;
      const active = document.activeElement;
      if (active instanceof HTMLElement && !(dlg && dlg.contains(active))) openerRef.current = active;
      const token = ++tokenRef.current;
      setAuto(false); // every opening starts in manual mode
      setSpeed(1);
      setViewer({ token, id, preview, trace: null, detail: null, cursor: 0, furthest: 0, committed, recordKey: null, showAll: false, pane: 'seed', waiting: 'loading', loadError: null, waited: false });
      load(token, id, preview, preview ? 0 : startCursor);
    },
    [load, setViewer],
  );

  const dismiss = useCallback(
    (skipRefresh = false) => {
      const dlg = dialogRef.current;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      tokenRef.current++;
      setAuto(false);
      if (!viewerRef.current || closeTimer.current) return;
      document.documentElement.classList.remove('guide-is-open');
      const finish = () => {
        closeTimer.current = null;
        if (dlg?.open) dlg.close();
        setLeaving(false);
        setViewer(null);
        const opener = openerRef.current;
        openerRef.current = null;
        if (opener && opener.isConnected) opener.focus({ preventScroll: true });
        if (!skipRefresh) void refresh();
      };
      if (reducedMotion()) finish();
      else {
        setLeaving(true);
        closeTimer.current = setTimeout(finish, LEAVE_MS);
      }
    },
    [refresh, setViewer],
  );

  const move = useCallback(
    (to: number) => {
      const v = viewerRef.current;
      if (!v || !v.trace) return;
      const lastIndex = v.trace.events.length - 1;
      const cursor = Math.max(0, Math.min(to, lastIndex));
      if (cursor === v.cursor) return;
      const beat = v.trace.events[cursor];
      setViewer({ ...v, cursor, furthest: Math.max(v.furthest, cursor), pane: paneForKind(beat.kind), recordKey: beat.record_refs[0] ?? v.recordKey, showAll: false });
      if (cursor === lastIndex) setAuto(false); // auto stops at the last beat and never acknowledges
      if (!v.preview) void persist(v.token, v.id, cursor, cursor === lastIndex);
    },
    [persist, setViewer],
  );

  const reopenPending = useCallback(() => {
    const p = stateRef.current?.pending;
    if (!p) return;
    const v = viewerRef.current;
    if (v && !v.preview && v.id === p.id && !closeTimer.current) return; // already showing it
    open(p.id, false, p.cursor, p.committed);
  }, [open]);

  const begin = useCallback(
    async (fast: boolean) => {
      const s = stateRef.current;
      if (!s || busy.current) return;
      if (s.pending) {
        reopenPending();
        return;
      }
      if (s.halted) return;
      if (fast ? !s.fast.available : s.completed || s.position > 8) return;
      const id = (fast ? 'FAST' : `B${s.position}`) as BlockId;
      busy.current = true;
      const active = document.activeElement;
      if (active instanceof HTMLElement) openerRef.current = active;
      try {
        const pending = await source.begin(id);
        await refresh();
        open(pending.id, false, pending.cursor ?? 0, pending.committed);
      } catch (e) {
        toast(errText(e));
        await refresh();
      } finally {
        busy.current = false;
      }
    },
    [source, refresh, toast, open, reopenPending],
  );

  const startNext = useCallback(() => begin(false), [begin]);
  const startFast = useCallback(() => begin(true), [begin]);
  const openPreview = useCallback((id: BlockId) => open(id, true, 0, false), [open]);

  const actions = useMemo<ViewerActions>(() => {
    const manual = () => setAuto(false);
    const update = (p: Partial<ViewerState>) => {
      const v = viewerRef.current;
      if (v) setViewer({ ...v, ...p });
    };
    return {
      close: () => dismiss(),
      reset: () => {
        manual();
        if (!window.confirm('Đưa phiên mẫu về trạng thái ban đầu? Các phiên Live không bị ảnh hưởng.')) return;
        void (async () => {
          try {
            await queue.current;
            await source.reset();
            dismiss(true);
            await refresh();
            toast('Đã trở lại seed ban đầu. Bấm Tiến 1 bước để bắt đầu.');
          } catch (e) {
            toast(errText(e));
          }
        })();
      },
      toggleAuto: () => setAuto((a) => !a),
      toggleSpeed: () => setSpeed((s) => (s === 1 ? 2 : 1)),
      next: () => {
        const v = viewerRef.current;
        if (v) move(v.cursor + 1);
      },
      back: () => {
        manual();
        const v = viewerRef.current;
        if (v) move(v.cursor - 1);
      },
      replay: () => {
        manual();
        move(0);
      },
      stage: (kind: TraceKind) => {
        manual();
        const v = viewerRef.current;
        const first = v?.trace?.events.findIndex((x) => x.kind === kind) ?? -1;
        if (v && first >= 0 && first <= v.furthest) move(first);
      },
      jump: (cursor: number) => {
        manual();
        move(cursor);
      },
      setPane: (pane: MobilePane) => {
        manual();
        update({ pane });
      },
      pickRecord: (key: string) => {
        manual();
        update({ recordKey: key, pane: 'seed' });
      },
      toggleRecords: () => {
        const v = viewerRef.current;
        if (v) update({ showAll: !v.showAll });
      },
      understood: () => {
        const v = viewerRef.current;
        if (!v || !v.trace) return;
        if (v.preview) {
          dismiss();
          return;
        }
        if (busy.current) return;
        busy.current = true;
        // A failed required gate keeps blocking after the acknowledgement: report it, never mask it.
        const gateBlocked = v.trace.gates.some(gateBlocks);
        void (async () => {
          try {
            await queue.current;
            await source.acknowledge(v.id);
            await refresh();
            toast(gateBlocked || stateRef.current?.halted ? 'Đã ghi nhận lỗi. Sửa sự cố trước khi tiếp tục.' : `Đã hiểu ${v.id}. Có thể tiến block kế tiếp.`);
            dismiss(true);
          } catch (e) {
            toast(errText(e));
          } finally {
            busy.current = false;
          }
        })();
      },
      retry: () => {
        const v = viewerRef.current;
        if (!v || busy.current) return;
        busy.current = true;
        setRetrying(true);
        void (async () => {
          try {
            let cursor = 0;
            let committed = false;
            if (!v.preview) {
              const pending = await source.begin(v.id);
              cursor = pending.cursor ?? 0;
              committed = pending.committed;
              await refresh();
            }
            open(v.id, v.preview, cursor, committed);
          } catch (e) {
            toast(errText(e));
          } finally {
            busy.current = false;
            setRetrying(false);
          }
        })();
      },
    };
  }, [dismiss, move, open, refresh, setViewer, source, toast]);

  const isOpen = viewer !== null;
  const token = viewer?.token ?? 0;
  const ready = !!viewer?.trace;
  const cursor = viewer?.cursor ?? 0;
  const lastIndex = (viewer?.trace?.events.length ?? 1) - 1;

  // Show the drawer as a modal dialog; the page behind keeps its scroll position.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg || !isOpen) return;
    if (!dlg.open) dlg.showModal();
    document.documentElement.classList.add('guide-is-open');
  }, [isOpen, token]);

  // Focus: the primary control on open, and again whenever a move unmounts the focused button.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg || !isOpen) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || active === dlg || !dlg.contains(active);
    const prime = ready && primedRef.current !== token;
    if (!lost && !prime) return;
    if (ready) primedRef.current = token;
    const target = dlg.querySelector<HTMLElement>('#guide-next') ?? dlg.querySelector<HTMLElement>('#guide-understood') ?? dlg.querySelector<HTMLElement>('#guide-close');
    target?.focus({ preventScroll: true });
  }, [isOpen, token, ready, cursor]);

  // Auto mode: one beat every 1900 ms / speed, stopping at the last beat.
  useEffect(() => {
    if (!auto || !ready || cursor >= lastIndex) return;
    const t = setTimeout(() => move(cursor + 1), BEAT_MS / speed);
    return () => clearTimeout(t);
  }, [auto, speed, ready, cursor, lastIndex, move, token]);

  // Reload resumes mid-block: reopen the pending guide at its saved cursor, once per page load.
  useEffect(() => {
    const p = state?.pending;
    if (!resume || !p || viewerRef.current) return;
    const key = `${sessionId}:${state.runNo}:${p.id}`;
    if (autoOpened.has(key)) return;
    autoOpened.add(key);
    open(p.id, false, p.cursor, p.committed);
  }, [state, sessionId, open, resume]);

  // A guide that is started by the user counts as opened for this page load.
  useEffect(() => {
    if (viewer && !viewer.preview && state) autoOpened.add(`${sessionId}:${state.runNo}:${viewer.id}`);
  }, [viewer, state, sessionId]);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      document.documentElement.classList.remove('guide-is-open');
    },
    [],
  );

  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault(); // Esc = close and keep progress
    dismiss();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const t = e.target as HTMLElement;
    if (t.closest('input,textarea,select,[contenteditable="true"],[role="tab"]')) return;
    if (!viewerRef.current?.trace) return;
    e.preventDefault();
    if (e.key === 'ArrowRight') actions.next();
    else actions.back();
  };

  const api = useMemo<GuideApi>(() => ({ openPreview, startNext, startFast, reopenPending, isOpen }), [openPreview, startNext, startFast, reopenPending, isOpen]);
  const card = viewer ? state?.cards.find((c) => c.id === viewer.id) : undefined;

  return (
    <GuideContext.Provider value={api}>
      {children}
      <dialog
        ref={dialogRef}
        id="step-guide"
        className={'step-guide trace-guide' + (leaving ? ' leaving' : '')}
        aria-labelledby="guide-title"
        data-mode={auto ? 'auto' : 'manual'}
        data-block={viewer?.id}
        data-preview={viewer ? viewer.preview : undefined}
        onCancel={onCancel}
        onKeyDown={onKeyDown}
      >
        {viewer ? (
          <GuideView
            viewer={viewer}
            actions={actions}
            auto={auto}
            speed={speed}
            live={source.mode === 'live'}
            runLabel={state?.runLabel ?? ''}
            fallbackName={card?.name ?? (viewer.id === 'FAST' ? 'Giao bản thử nhanh' : '')}
            retrying={retrying}
          />
        ) : null}
      </dialog>
    </GuideContext.Provider>
  );
}
