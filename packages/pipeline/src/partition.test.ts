import { describe, expect, it } from 'vitest';
import { partitionBatched } from './blocks-a';

/** Stand-in for T3/T5: groups items whose text is identical, canonical = smallest id. */
const fake = (sizes: number[]) => async (part: { id: string; text: string }[]) => {
  sizes.push(part.length);
  const m = new Map<string, string[]>();
  for (const x of part) m.set(x.text, [...(m.get(x.text) ?? []), x.id]);
  return { output: { groups: [...m.values()].map((ids) => ({ member_ids: ids, canonical_member_id: [...ids].sort()[0] })) }, source: 'AI' as any };
};
const items = (n: number, distinct: number) => Array.from({ length: n }, (_, i) => ({ id: `x${String(i).padStart(4, '0')}`, text: `việc ${(i * 7) % distinct}` }));

describe('partitionBatched', () => {
  it('một lời gọi khi không quá 100 mục', async () => {
    const sizes: number[] = [];
    const r = await partitionBatched(items(100, 10), (x) => x.text, fake(sizes));
    expect(sizes).toEqual([100]);
    expect(r.groups).toHaveLength(10);
  });
  it('chia lô rồi gộp lại: mỗi ID thuộc đúng một nhóm, nhóm bị tách qua lô được nối lại', async () => {
    const sizes: number[] = [];
    const all = items(730, 180);
    const r = await partitionBatched(all, (x) => x.text, fake(sizes));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(250);
    expect(r.calls).toBe(sizes.length);
    expect(r.groups).toHaveLength(180);
    const seen = r.groups.flatMap((g) => g.member_ids);
    expect(seen).toHaveLength(730);
    expect(new Set(seen).size).toBe(730);
    for (const g of r.groups) {
      expect(g.member_ids).toContain(g.canonical_member_id);
      expect(new Set(g.member_ids.map((id) => all.find((x) => x.id === id)!.text)).size).toBe(1);
    }
  });
});
