import type { Effort, TaskName } from './tasks';

/** Full model IDs — never aliases — so an alias changing meaning cannot change results. */
export const MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
} as const;

export interface TaskModel {
  model: string;
  effort: Effort;
}
export interface AgentConfig {
  version: string;
  tasks: Record<TaskName, TaskModel>;
  /** Three independent seats for T9 (level votes) and T11 (retranslation): three different models. */
  seats: { seat: string; model: string; effort: Effort }[];
}

/** Default assignment (spec §9.4). Locked into every run snapshot. */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  version: 'agents-1',
  tasks: {
    T1: { model: MODELS.haiku, effort: 'low' },
    T2: { model: MODELS.sonnet, effort: 'medium' },
    T3: { model: MODELS.sonnet, effort: 'medium' },
    T4: { model: MODELS.sonnet, effort: 'medium' },
    T5: { model: MODELS.sonnet, effort: 'medium' },
    T6: { model: MODELS.opus, effort: 'high' },
    T7: { model: MODELS.sonnet, effort: 'medium' },
    T8: { model: MODELS.sonnet, effort: 'medium' },
    T9: { model: MODELS.sonnet, effort: 'medium' },
    T10: { model: MODELS.opus, effort: 'medium' },
    T11: { model: MODELS.sonnet, effort: 'medium' },
    T12: { model: MODELS.opus, effort: 'high' },
    T13: { model: MODELS.sonnet, effort: 'medium' },
  },
  seats: [
    { seat: 'seat-1', model: MODELS.haiku, effort: 'medium' },
    { seat: 'seat-2', model: MODELS.sonnet, effort: 'medium' },
    { seat: 'seat-3', model: MODELS.opus, effort: 'medium' },
  ],
};

export const shortModel = (m: string) => (m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : m.includes('opus') ? 'opus' : m.includes('fable') ? 'fable' : m);

/** Which tasks each block may call (for card badges and the pre-run confirmation screen). */
export const BLOCK_TASKS: Record<string, TaskName[]> = {
  B0: [],
  B1: ['T1'],
  B2: ['T2', 'T3'],
  B3: ['T4', 'T5', 'T6'],
  B4: ['T7', 'T13'],
  B5: ['T8', 'T9'],
  B6: ['T10', 'T11'],
  B7: [],
  B8: ['T12'],
  FAST: [],
};
