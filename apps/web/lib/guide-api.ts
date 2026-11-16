'use client';
import { createContext, useContext } from 'react';
import type { BlockId } from '@cl/contract';

/** Implemented by components/guide/GuideProvider. The shell and screens call it; they never touch the dialog. */
export interface GuideApi {
  /** Open the beat viewer on a simulated copy; never writes, never calls a model. */
  openPreview(id: BlockId): void;
  /** "Tiến 1 bước": begin the next block (or reopen the pending one) and open the viewer. */
  startNext(): Promise<void>;
  /** "Giao bản thử nhanh". */
  startFast(): Promise<void>;
  reopenPending(): void;
  isOpen: boolean;
}
export const GuideContext = createContext<GuideApi | null>(null);
export function useGuide(): GuideApi {
  const g = useContext(GuideContext);
  if (!g) throw new Error('GuideProvider missing');
  return g;
}
