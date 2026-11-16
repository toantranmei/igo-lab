import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '@cl/contract';

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const hashJson = (value: unknown) => sha256(canonicalJson(value));
/** Deterministic short id from content (used for task/competency candidate ids so reruns agree). */
export const contentId = (prefix: string, value: unknown) => `${prefix}_${hashJson(value).slice(0, 12)}`;
