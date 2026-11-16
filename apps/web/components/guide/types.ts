import type { BlockDetail, BlockId, BlockTrace, TraceKind } from '@cl/contract';

export type MobilePane = 'seed' | 'calc' | 'output';
export const PHASES: TraceKind[] = ['RECEIVE', 'READ', 'GATE', 'HANDOFF'];

export interface ViewerState {
  /** Changes on every (re)load so late async results can be discarded. */
  token: number;
  id: BlockId;
  preview: boolean;
  trace: BlockTrace | null;
  detail: BlockDetail | null;
  cursor: number;
  furthest: number;
  /** The source has committed this block's output (non-preview only). */
  committed: boolean;
  recordKey: string | null;
  showAll: boolean;
  pane: MobilePane;
  /** Why there is no trace on screen yet. */
  waiting: 'loading' | 'computing' | 'empty' | null;
  loadError: string | null;
  /** True when the trace had to be waited for (Live job). */
  waited: boolean;
}

export interface ViewerActions {
  close(): void;
  reset(): void;
  toggleAuto(): void;
  toggleSpeed(): void;
  next(): void;
  back(): void;
  replay(): void;
  stage(kind: TraceKind): void;
  jump(cursor: number): void;
  setPane(pane: MobilePane): void;
  pickRecord(key: string): void;
  toggleRecords(): void;
  understood(): void;
  retry(): void;
}

export function paneForKind(kind: TraceKind): MobilePane {
  return kind === 'RECEIVE' ? 'seed' : kind === 'HANDOFF' ? 'output' : 'calc';
}
