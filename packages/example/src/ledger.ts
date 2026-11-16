/**
 * Guide ledger: at most one block is "being viewed" at a time; the real engine step
 * runs exactly once when the viewer reaches the last beat.
 * Ported from docs/reference/site-v8/step-guide.js (`GuideLedger`).
 */
import type { GuidePending, Lab } from './engine';

export type GuideKey = Pick<GuidePending, 'id' | 'round' | 'seq'>;

export function pending(lab: Lab): GuidePending | null {
  return lab.guide?.pending || null;
}

export function matches(lab: Lab, key: GuideKey | null | undefined): boolean {
  const p = pending(lab);
  return !!p && !!key && p.id === key.id && p.round === key.round && p.seq === key.seq;
}

export function begin(lab: Lab, id: string): boolean {
  if (pending(lab)) return false;
  lab.guide ||= { pending: null, acknowledged: [] };
  lab.guide.pending = {
    id,
    round: lab.round,
    seq: lab.logs.length,
    committed: !!(id === 'FAST' ? lab.fast : lab.outputs[id]),
    cursor: 0,
  };
  return true;
}

export function commit(lab: Lab, key: GuideKey | null | undefined): boolean {
  if (!matches(lab, key)) return false;
  const p = pending(lab)!;
  if (p.committed) return true;
  if (p.id === 'FAST') {
    if (!lab.quick()) return false;
  } else {
    if (p.id !== 'B' + lab.position || lab.halted || lab.completed) return false;
    const r = lab.step();
    if (!r || r.id !== p.id) return false;
  }
  p.committed = true;
  return true;
}

export function acknowledge(lab: Lab, key: GuideKey | null | undefined): boolean {
  if (!matches(lab, key)) return false;
  const p = pending(lab)!;
  if (!p.committed) return false;
  lab.guide!.acknowledged.push({ ...p });
  lab.guide!.pending = null;
  return true;
}

export const GuideLedger = { pending, matches, begin, commit, acknowledge };
