/**
 * P3 · versions MAJOR.MINOR.PATCH (white paper ch. 6, formulas 38–42).
 * Records keep their integer `version` as storage key; the semantic label is in `data.semver`. Records written before
 * P3 have none: version n reads as n.0.0 (P3.1 migration rule, the old number stays the key, i.e. the alias).
 */

export type ChangeType = 'S' | 'D' | 'P' | 'V' | 'B' | 'E' | 'L';
export type Bump = 'MAJOR' | 'MINOR' | 'PATCH' | 'NONE';
export const CHANGE_TEXT: Record<ChangeType, string> = { S: 'cấu trúc', D: 'định nghĩa', P: 'hồ sơ', V: 'lớp biến động', B: 'bằng chứng', E: 'sửa lỗi', L: 'pháp lý' };
/** (38) bump by change type. */
export const BUMP_OF: Record<ChangeType, Exclude<Bump, 'NONE'>> = { S: 'MAJOR', D: 'MAJOR', P: 'MINOR', V: 'MINOR', L: 'MINOR', B: 'PATCH', E: 'PATCH' };

export type Semver = [number, number, number];
export function parseSemver(label: string | null | undefined, fallbackMajor = 1): Semver {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec((label ?? '').trim());
  if (!m) return [fallbackMajor, 0, 0];
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}
export const fmt = (v: Semver) => v.join('.');
export function bump(v: Semver, b: Bump): Semver {
  if (b === 'MAJOR') return [v[0] + 1, 0, 0];
  if (b === 'MINOR') return [v[0], v[1] + 1, 0];
  if (b === 'PATCH') return [v[0], v[1], v[2] + 1];
  return v;
}
/** Semantic version of a stored record (legacy integer n → n.0.0). */
export const semverOf = (rec: { version: number; data: any } | null | undefined): string => {
  if (!rec) return '0.0.0';
  if (rec.data?.semver) return rec.data.semver as string;
  // a framework written before P3 already carried a two-part label "1.N": that is its alias (P3.1)
  if (typeof rec.data?.version_label === 'string' && /^\d+\.\d+(\.\d+)?$/.test(rec.data.version_label)) return fmt(parseSemver(rec.data.version_label));
  return `${rec.version}.0.0`;
};
export const maxBump = (bs: Bump[]): Bump => (bs.includes('MAJOR') ? 'MAJOR' : bs.includes('MINOR') ? 'MINOR' : bs.includes('PATCH') ? 'PATCH' : 'NONE');

const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Levenshtein distance, for telling a typo fix from a real rewording. */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}
/** A wording change of at most 3 characters (and ≤ 5% of the text) is a correction (E), not a new meaning (D). */
export const isTypoFix = (a: string, b: string) => {
  const d = editDistance(norm(a), norm(b));
  return d > 0 && d <= 3 && d <= Math.max(1, Math.ceil(norm(a).length * 0.05));
};

export interface Classified {
  types: ChangeType[];
  bump: Bump;
  reasons: string[];
}
/** (38) Classify the change of one record and derive its bump. */
export function classify(kind: string, before: any | null, after: any | null): Classified {
  if (!before && after) return { types: ['S'], bump: 'NONE', reasons: ['bản ghi mới (1.0.0)'] };
  if (!after) return { types: [], bump: 'NONE', reasons: [] };
  const types = new Set<ChangeType>();
  const reasons: string[] = [];
  const text = (field: string, label: string) => {
    const a = String(before?.[field] ?? ''), b = String(after?.[field] ?? '');
    if (a === b) return;
    if (isTypoFix(a, b)) (types.add('E'), reasons.push(`${label}: sửa lỗi chính tả`));
    else (types.add('D'), reasons.push(`${label}: đổi nội dung`));
  };
  if (kind === 'C') {
    text('definition', 'định nghĩa');
    text('label', 'tên');
    const aa = [...(before.aliases ?? [])].sort().join('|'), ba = [...(after.aliases ?? [])].sort().join('|');
    if (aa !== ba) (types.add('P'), reasons.push('nhãn đồng nghĩa'));
    if ((before.group ?? '') !== (after.group ?? '') || (before.class ?? '') !== (after.class ?? '')) (types.add('V'), reasons.push('lớp / nhóm'));
    if ((before.status ?? 'ACTIVE') !== (after.status ?? 'ACTIVE')) (types.add('P'), reasons.push(`trạng thái ${before.status ?? 'ACTIVE'} → ${after.status}`));
    if ((before.legal_note ?? '') !== (after.legal_note ?? '')) (types.add('L'), reasons.push('ghi chú pháp lý'));
  } else if (kind === 'I') {
    text('statement', 'câu chỉ báo');
    if ((before.level ?? '') !== (after.level ?? '')) (types.add('D'), reasons.push('bậc'));
    if ([...(before.segment_ids ?? [])].sort().join() !== [...(after.segment_ids ?? [])].sort().join()) (types.add('B'), reasons.push('đoạn căn cứ'));
  } else if (kind === 'R') {
    const ids = (x: any) => (x?.requirements ?? []).map((q: any) => q.competency_id).sort().join('|');
    if (ids(before) !== ids(after)) (types.add('S'), reasons.push('tập năng lực'));
    const lv = (x: any) => (x?.requirements ?? []).map((q: any) => `${q.competency_id}:${q.required_level}`).sort().join('|');
    if (lv(before) !== lv(after)) (types.add('D'), reasons.push('bậc yêu cầu'));
    const pins = (x: any) => (x?.requirements ?? []).map((q: any) => `${q.competency_id}@${q.competency_version}`).sort().join('|');
    if (pins(before) !== pins(after)) (types.add('P'), reasons.push('phiên bản ghim'));
    const ev = (x: any) => (x?.requirements ?? []).flatMap((q: any) => q.evidence_ids ?? []).sort().join('|');
    if (ev(before) !== ev(after)) (types.add('B'), reasons.push('bằng chứng'));
    if (!types.size) (types.add('P'), reasons.push('hồ sơ khung'));
  } else {
    types.add('P');
    reasons.push('hồ sơ');
  }
  const ts = [...types];
  return { types: ts, bump: maxBump(ts.map((x) => BUMP_OF[x])), reasons };
}

/**
 * (39) Dictionary bump: a MAJOR of any record, a new competency or a competency leaving use raises MINOR;
 * otherwise any change raises PATCH. The first release is 1.0.0.
 */
export function dictionaryBump(changes: { kind: string; action: string; bump: Bump }[]): Bump {
  if (changes.some((c) => c.bump === 'MAJOR' || (c.kind === 'C' && (c.action === 'ADD' || c.action === 'DEPRECATE')))) return 'MINOR';
  if (changes.some((c) => c.action === 'ADD' || c.bump !== 'NONE')) return 'PATCH';
  return 'NONE';
}
export function nextDictionaryLabel(parentLabel: string | null, changes: { kind: string; action: string; bump: Bump }[]): string {
  if (!parentLabel) return '1.0.0';
  const b = dictionaryBump(changes);
  return fmt(bump(parseSemver(parentLabel), b === 'NONE' ? 'PATCH' : b));
}

/** P3.9 release notes from the classified changes. */
export function releaseNotes(label: string, changes: { kind: string; name: string; action: string; types?: ChangeType[]; from?: string; to?: string; affected?: string[] }[]): string {
  const c = changes.filter((x) => x.kind === 'C');
  const add = c.filter((x) => x.action === 'ADD'), upd = c.filter((x) => x.action === 'UPDATE'), dep = c.filter((x) => x.action === 'DEPRECATE');
  const lines = [`Bản ${label}.`];
  if (add.length) lines.push(`${add.length} năng lực mới: ${add.map((x) => x.name).join(', ')}.`);
  for (const x of upd) lines.push(`${x.name}: ${(x.types ?? []).map((t) => CHANGE_TEXT[t]).join(', ') || 'thay đổi'} (${x.from} → ${x.to})${x.affected?.length ? `; khung đang ghim bản cũ: ${x.affected.join(', ')}` : ''}.`);
  if (dep.length) lines.push(`Ngừng dùng (không còn khung nào dùng): ${dep.map((x) => x.name).join(', ')}.`);
  const r = changes.filter((x) => x.kind === 'R');
  if (r.length) lines.push(`Khung: ${r.map((x) => `${x.name} ${x.to ?? ''}`.trim()).join(', ')}.`);
  if (lines.length === 1) lines.push('Không đổi nội dung năng lực.');
  return lines.join(' ');
}
