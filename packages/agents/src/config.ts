import type { Effort, TaskName } from './tasks';

/** Full model IDs — never aliases — so an alias changing meaning cannot change results. */
export const MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
} as const;

/**
 * API list prices in USD per million tokens [input, output] (Anthropic, 11/2026), used to show an API-equivalent
 * cost before a run. Runs go through the Claude CLI subscription, so this measures quota, not a bill.
 */
export const MODEL_PRICE_USD: Record<'haiku' | 'sonnet' | 'opus', [number, number]> = { haiku: [0.1, 0.5], sonnet: [2, 10], opus: [4, 20] };
export const priceOf = (model: string): [number, number] => MODEL_PRICE_USD[model.includes('haiku') ? 'haiku' : model.includes('opus') ? 'opus' : 'sonnet'];

export interface TaskModel {
  model: string;
  effort: Effort;
}
export interface Seat {
  seat: string;
  model: string;
  effort: Effort;
  /** Spec §6.1a S3: each seat has its own role and its own wording of the 1–5 scale. */
  role: string;
  scale: string;
}
export interface AgentConfig {
  version: string;
  tasks: Record<TaskName, TaskModel>;
  /** Three independent seats for E10 (priority and level) and E7 (retranslation). */
  seats: Seat[];
}

const H = { model: MODELS.haiku, effort: 'low' } as const;
const S = { model: MODELS.sonnet, effort: 'low' } as const;
/**
 * Model policy of 18/11/2026 (spec §12.5), amended 19/11/2026: Haiku is the default, lowest effort everywhere; Sonnet
 * only where the checker must differ from the maker (E9 vs E1) or for the hardest work (E6 indicators). E8 (audit) runs
 * on Opus at low effort: (31) needs an auditor model that extracted, wrote and scored nothing, and only Opus is left.
 * T1–T13 are the pre-P1 tasks, kept so stored answers and old snapshots stay readable; the B0–B8 line no longer calls them
 * except T7 (real events). T14/T15 scan external datasets and are unchanged.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  version: 'agents-4',
  tasks: {
    T1: H, T2: H, T3: H, T4: H, T5: H, T6: H, T7: H, T8: H, T9: H, T10: S, T11: H, T12: S, T13: H,
    T14: { model: MODELS.sonnet, effort: 'low' },
    T15: { model: MODELS.haiku, effort: 'medium' },
    E1: H, E23: H, E4: H, E4M: S, E4S: S, E5: H, E6L: S, E6: S, E7: H, E8: { model: MODELS.opus, effort: 'low' }, E9: S, E10: H,
  },
  seats: [
    { seat: 'seat-1', ...H, role: 'Quản lý trực tiếp của vị trí', scale: '1–5 theo hậu quả nếu người giữ vị trí thiếu năng lực này: 1 không đáng kể … 5 công việc thất bại.' },
    { seat: 'seat-2', ...H, role: 'Chuyên gia nghề, đọc từ các nghề chuẩn ngoài', scale: '1–5 theo tần suất cần dùng trong công việc: 1 hiếm khi … 5 hằng ngày.' },
    { seat: 'seat-3', ...H, role: 'Người đánh giá năng lực, tập trung vào hành vi quan sát được', scale: '1–5 theo mức khác biệt giữa người giỏi và người trung bình: 1 không khác … 5 khác biệt rõ rệt.' },
  ],
};

/**
 * Configuration for a session's rigor. Levels A and B keep the default (E8 on Opus so the "Sản phẩm thị trường" tier
 * can be reached on data).
 * Level C (decision of 20/11/2026, option A1): the checkers are the strong models, the writer the cheap one. On real
 * postings the three Haiku seats misread indicator levels at random (a different competency dropped at B6 on every
 * run, final coverage 59–84%) and the Haiku auditor flagged a different variable on every run. So the seats (E7, and
 * E10 at B5, which shares them) and the auditor E8 run on Sonnet; E6 writes on Haiku, since (2) requires the writer
 * and the seats to differ. Weak indicators are caught by the Sonnet seats and go to the rewrite round.
 */
export function agentConfigFor(rigor: 'A' | 'B' | 'C' | undefined): AgentConfig {
  if (rigor === 'A' || rigor === 'B') return DEFAULT_AGENT_CONFIG;
  return {
    ...DEFAULT_AGENT_CONFIG,
    version: `${DEFAULT_AGENT_CONFIG.version}-c2`,
    tasks: { ...DEFAULT_AGENT_CONFIG.tasks, E6: { model: MODELS.haiku, effort: 'low' }, E8: { model: MODELS.sonnet, effort: 'low' } },
    seats: DEFAULT_AGENT_CONFIG.seats.map((x) => ({ ...x, model: MODELS.sonnet, effort: 'low' })),
  };
}

export const shortModel = (m: string) => (m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : m.includes('opus') ? 'opus' : m.includes('fable') ? 'fable' : m);

/** Which tasks each block may call (for card badges and the pre-run confirmation screen). */
export const BLOCK_TASKS: Record<string, TaskName[]> = {
  B0: [],
  B1: ['E1'],
  B2: ['E23'],
  B3: ['E4S', 'E4', 'E4M', 'E9'],
  B4: ['T7'],
  B5: ['E5', 'E10'],
  B6: ['E6', 'E6L', 'E7'],
  B7: ['E8'],
  B8: [],
  FAST: [],
};
