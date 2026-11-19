import { describe, expect, it } from 'vitest';
import { classify, nextDictionaryLabel, parseSemver, releaseNotes, semverOf } from '../../packages/registry/src/versioning';

const C = (definition: string, extra: Record<string, unknown> = {}) => ({ competency_id: 'C-1', label: 'Ưu tiên backlog', definition, aliases: [], status: 'ACTIVE', ...extra });

describe('P3 · phiên bản ba số (38)–(39)', () => {
  it('sửa lỗi chính tả là E (PATCH); đổi định nghĩa là D (MAJOR); thêm nhãn đồng nghĩa là P (MINOR)', () => {
    const base = C('Khả năng sắp xếp hạng mục theo giá trị kỳ vọng.');
    expect(classify('C', base, C('Khả năng sắp xếp hạng mục theo giá trị kỳ vong.'))).toMatchObject({ types: ['E'], bump: 'PATCH' });
    expect(classify('C', base, C('Khả năng sắp xếp hạng mục theo giá trị, chi phí trì hoãn và rủi ro.'))).toMatchObject({ types: ['D'], bump: 'MAJOR' });
    expect(classify('C', base, C(base.definition, { aliases: ['Quản lý backlog'] }))).toMatchObject({ types: ['P'], bump: 'MINOR' });
    expect(classify('C', base, C(base.definition, { status: 'DEPRECATED' })).bump).toBe('MINOR');
  });
  it('từ điển 1.2.0 có một MAJOR và một năng lực mới → 1.3.0; chỉ PATCH → 1.2.1; bản đầu 1.0.0', () => {
    expect(nextDictionaryLabel('1.2.0', [{ kind: 'C', action: 'UPDATE', bump: 'MAJOR' }, { kind: 'C', action: 'ADD', bump: 'NONE' }])).toBe('1.3.0');
    expect(nextDictionaryLabel('1.2.0', [{ kind: 'C', action: 'UPDATE', bump: 'PATCH' }])).toBe('1.2.1');
    expect(nextDictionaryLabel(null, [{ kind: 'C', action: 'ADD', bump: 'NONE' }])).toBe('1.0.0');
  });
  it('bản cũ n đọc là n.0.0; nhãn hai phần 1.1 đọc là 1.1.0; ghi chú phát hành nêu khung đang ghim', () => {
    expect(semverOf({ version: 3, data: {} })).toBe('3.0.0');
    expect(parseSemver('1.1')).toEqual([1, 1, 0]);
    const n = releaseNotes('1.3.0', [{ kind: 'C', name: 'Ưu tiên backlog', action: 'UPDATE', types: ['D'], from: '1.0.0', to: '2.0.0', affected: ['Product Owner 1.0.0'] }, { kind: 'C', name: 'Điều phối', action: 'ADD' }]);
    expect(n).toContain('1 năng lực mới: Điều phối');
    expect(n).toContain('định nghĩa (1.0.0 → 2.0.0); khung đang ghim bản cũ: Product Owner 1.0.0');
  });
});
