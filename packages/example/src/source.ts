/**
 * SessionSource of the Default Example: the deterministic engine runs in the browser and
 * its whole state is kept in localStorage.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AppError, BLOCK_IDS } from '@cl/contract';
import type { BlockDetail, BlockId, BlockTrace, PendingGuide, SessionSource, SessionState } from '@cl/contract';
import { Lab, clone } from './engine';
import type { FaultKind, GuidePending } from './engine';
import { explain } from './explain';
import * as ledger from './ledger';
import { FAULT_OPTIONS, toSessionState, toTrialFrame } from './mappers';
import { buildTrace } from './trace';

export const EXAMPLE_STORAGE_KEY = 'cl.example.v1.state';
export const EXAMPLE_STORAGE_SCHEMA = 1;

export type ExampleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): ExampleStorage | null {
  try {
    const s = (globalThis as any).localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' && typeof s.removeItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

const toPending = (p: GuidePending): PendingGuide => ({ id: p.id as BlockId, cursor: p.cursor || 0, committed: !!p.committed });

export class ExampleSource implements SessionSource {
  readonly mode = 'example' as const;
  private lab: Lab;
  private storage: ExampleStorage | null;
  private listeners = new Set<() => void>();

  constructor(storage?: ExampleStorage | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.lab = this.load();
  }

  private load(): Lab {
    if (!this.storage) return new Lab();
    try {
      const raw = this.storage.getItem(EXAMPLE_STORAGE_KEY);
      if (!raw) return new Lab();
      const parsed = JSON.parse(raw);
      const json = parsed?.schema === EXAMPLE_STORAGE_SCHEMA ? parsed.lab : null;
      if (!json || typeof json !== 'object' || typeof json.round !== 'number' || typeof json.position !== 'number' || !json.data || !json.dictionary) {
        this.storage.removeItem(EXAMPLE_STORAGE_KEY);
        return new Lab();
      }
      const lab = Lab.restore(json);
      const p = lab.guide?.pending;
      if (p) {
        if (p.committed === undefined) p.committed = !!(p.id === 'FAST' ? lab.fast : lab.outputs[p.id]);
        p.cursor = Number(p.cursor) || 0;
      }
      return lab;
    } catch {
      try {
        this.storage.removeItem(EXAMPLE_STORAGE_KEY);
      } catch {
        /* storage unavailable */
      }
      return new Lab();
    }
  }

  private persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(EXAMPLE_STORAGE_KEY, JSON.stringify({ schema: EXAMPLE_STORAGE_SCHEMA, lab: this.lab }));
    } catch {
      /* quota or private mode: keep working in memory */
    }
  }

  private emit() {
    [...this.listeners].forEach((fn) => {
      try {
        fn();
      } catch {
        /* a broken listener must not break the engine */
      }
    });
  }

  private changed() {
    this.persist();
    this.emit();
  }

  private requireIdle(action: string) {
    const p = ledger.pending(this.lab);
    if (p) throw new AppError('GUIDE_PENDING', `${p.id} đang mở diễn tiến tính toán. Xem hết và bấm Đã hiểu trước khi ${action}.`, 409);
  }

  async getState(): Promise<SessionState> {
    return toSessionState(this.lab);
  }

  async getDetail(id: BlockId): Promise<BlockDetail> {
    return explain(this.lab, id);
  }

  /** Always available in Example; never mutates the lab (unrun blocks are computed on a clone). */
  async getTrace(id: BlockId, _preview: boolean): Promise<BlockTrace | null> {
    return buildTrace(this.lab, id);
  }

  async begin(id: BlockId): Promise<PendingGuide> {
    const lab = this.lab;
    const current = ledger.pending(lab);
    if (current) return toPending(current);
    if (!BLOCK_IDS.includes(id)) throw new AppError('UNKNOWN_BLOCK', `Không có block ${id}.`, 400);
    if (lab.halted) throw new AppError('HALTED', 'Lab đang dừng. Sửa sự cố và mở lại trước khi chạy tiếp.', 409);
    if (id === 'FAST') {
      if (!lab.outputs.B3) throw new AppError('FAST_NOT_READY', 'Nhánh giao thử cần đầu ra của B3.', 409);
      if (lab.fast) throw new AppError('FAST_DONE', 'Bản thử của lượt này đã được tạo.', 409);
    } else {
      if (lab.completed) throw new AppError('RUN_COMPLETED', `Lượt ${lab.round} đã hoàn tất.`, 409);
      if (id !== 'B' + lab.position) throw new AppError('OUT_OF_ORDER', `Block kế tiếp là B${lab.position}, không phải ${id}.`, 409);
    }
    if (!ledger.begin(lab, id)) throw new AppError('BEGIN_FAILED', `Không mở được ${id}.`, 409);
    this.changed();
    return toPending(ledger.pending(lab)!);
  }

  async progress(id: BlockId, cursor: number, atEnd: boolean): Promise<void> {
    const lab = this.lab;
    const p = ledger.pending(lab);
    if (!p || p.id !== id) return;
    p.cursor = Math.max(0, Math.floor(Number(cursor)) || 0);
    let failed = false;
    if (atEnd && !p.committed) failed = !ledger.commit(lab, { id: p.id, round: p.round, seq: p.seq });
    this.changed();
    if (failed) throw new AppError('COMMIT_FAILED', `Không ghi được đầu ra của ${id}.`, 409);
  }

  async acknowledge(id: BlockId): Promise<void> {
    const lab = this.lab;
    const p = ledger.pending(lab);
    if (!p || p.id !== id) return;
    if (!p.committed) throw new AppError('NOT_COMMITTED', `Chưa xem hết diễn tiến của ${id}; chưa có đầu ra để xác nhận.`, 409);
    ledger.acknowledge(lab, { id: p.id, round: p.round, seq: p.seq });
    this.changed();
  }

  async reset(): Promise<void> {
    this.lab = new Lab();
    try {
      this.storage?.removeItem(EXAMPLE_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    this.emit();
  }

  async setFault(value: string): Promise<void> {
    const lab = this.lab;
    if (!FAULT_OPTIONS.some((o) => o[0] === value)) throw new AppError('UNKNOWN_FAULT', `Không có kiểu lỗi mô phỏng "${value}".`, 400);
    if (lab.position > 0 || ledger.pending(lab)) throw new AppError('FAULT_LOCKED', 'Chỉ chọn lỗi mô phỏng trước khi chạy B0.', 409);
    lab.fault = value as FaultKind;
    this.changed();
  }

  async recover(reason: string): Promise<void> {
    const lab = this.lab;
    const why = String(reason ?? '').trim();
    if (!why) throw new AppError('REASON_REQUIRED', 'Cần nêu lý do mở lại.', 400);
    this.requireIdle('mở lại');
    if (!lab.halted) throw new AppError('NOT_HALTED', 'Lab không ở trạng thái dừng.', 409);
    lab.recover(why);
    // The blocked attempt stays in the log; drop its output so the block really runs again.
    // (In the reference the stale output made the retry a no-op.)
    delete lab.outputs['B' + lab.position];
    this.changed();
  }

  async approveLessons(reason: string): Promise<void> {
    const lab = this.lab;
    this.requireIdle('xác nhận lesson');
    lab.approve();
    const why = String(reason ?? '').trim();
    const last = lab.logs[lab.logs.length - 1];
    if (why && last?.type === 'HUMAN_SAFE') last.payload = { ...last.payload, reason: why };
    this.changed();
  }

  async startNextRun(): Promise<void> {
    const lab = this.lab;
    this.requireIdle('mở lượt mới');
    if (lab.round !== 1) throw new AppError('NO_NEXT_RUN', 'Ví dụ mẫu chỉ có hai lượt.', 409);
    try {
      lab.nextRound();
    } catch (e) {
      throw new AppError('NEXT_RUN_BLOCKED', e instanceof Error ? e.message : String(e), 409);
    }
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Whole lab as plain JSON (download "state"). */
  exportAll(): any {
    return clone(this.lab);
  }

  /** Seed data of the current run. */
  exportSeed(): any {
    return clone(this.lab.data);
  }

  /** R frame of the given version, else the latest one, else the trial; null when none exists. */
  exportFrame(version?: string): any {
    const lab = this.lab;
    const frames: any[] = lab.dictionary.R;
    const trial = toTrialFrame(lab);
    const picked = version
      ? frames.find((f) => f.version === version) || (trial && trial.version === version ? trial : null)
      : frames[frames.length - 1] || trial;
    return picked ? { ...clone(picked), evidence: 'synthetic_only' } : null;
  }

  /** Read-only access for tests. */
  getLab(): Lab {
    return this.lab;
  }
}
