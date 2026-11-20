import { describe, expect, it } from 'vitest';
import { TASKS } from '@cl/agents';
import { checkEvent, deidentify, findIdentifiers } from '../../packages/pipeline/src/human';
import { maskPII } from '../../packages/pipeline/src/prep';
import { reliabilityE } from '../../packages/pipeline/src/formulas';

describe('review · khử nhận dạng (P4.2)', () => {
  it('bắt tên tiếng Việt có dấu, danh xưng viết hoa, tên đầu câu, họ ngoài danh sách cũ, tổ chức và địa danh không có từ khóa, số định danh', () => {
    for (const x of ['cho ông Tuấn', 'Ông Tuấn yêu cầu', 'Tôi làm với Đặng Văn Hùng', 'Chị Lan xử lý', 'Nguyễn Văn An phụ trách', 'Trương Văn Hải duyệt', 'làm ở Viettel', 'tại Đà Nẵng', 'gọi (+84)912 345 678', 'CCCD 001 203 004 567'])
      expect(findIdentifiers(x).length, x).toBeGreaterThan(0);
    expect(deidentify('Trần Thị Hà phụ trách')).toBe('[người] phụ trách');
    expect(deidentify('CCCD 001 203 004 567')).toBe('CCCD [số định danh]');
    expect(findIdentifiers('Thực hiện Ưu tiên backlog theo chi phí trì hoãn')).toEqual([]);
  });
  it('kiểm cả nguồn và tham chiếu đồng ý; hạn lưu phải là ngày ISO trong tương lai', () => {
    expect(() => checkEvent({ label: 'x', action: 'Làm việc', source_ref: 'phỏng vấn chị Nguyễn Thị Lan, Vietcombank' })).toThrow(expect.objectContaining({ code: 'DEIDENTIFY_REQUIRED' }));
    expect(() => checkEvent({ label: 'x', action: 'Làm việc', retain_until: '01/06/2027' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => checkEvent({ label: 'x', action: 'Làm việc', retain_until: '2020-01-01' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});

describe('review · che dữ liệu trước khi gửi AI (K2)', () => {
  it('số có ngoặc, tên trước dấu hai chấm, danh xưng + tên; không che nhầm chữ thường', () => {
    expect(maskPII('Hotline: (028) 3823 4567').text).toBe('Hotline: [số điện thoại]');
    expect(maskPII('Liên hệ chị Lan: 0912345678').text).not.toContain('Lan');
    expect(maskPII('Anh Nguyễn Văn An (HR)').text).not.toContain('Nguyễn');
    expect(maskPII('liên hệ: phòng nhân sự để được hướng dẫn thêm').text).toBe('liên hệ: phòng nhân sự để được hướng dẫn thêm');
  });
});

describe('review · kiểm của agent và công thức', () => {
  it('E23 từ chối hai lần tách chồng nhau trong một cụm', () => {
    const input = { role_title: 'PO', catalog: '', clusters: [{ id: 'k1', tasks: [{ id: 't1', statement: 'a' }, { id: 't2', statement: 'b' }, { id: 't3', statement: 'c' }] }] };
    const out = { occupation: { vn_code: '', title: '', reason: '' }, merges: [], splits: [{ cluster_id: 'k1', task_ids: ['t2'] }, { cluster_id: 'k1', task_ids: ['t2', 't3'] }] };
    expect(TASKS.E23.check(input as any, out as any).join(' ')).toContain('hơn một lần tách');
  });
  it('E chỉ bằng 2 khi nguồn thật sự là dataset, không vì tên tệp có chữ dataset', () => {
    expect(reliabilityE('file', 'dataset_notes.docx', null)).toBe(1);
    expect(reliabilityE('paste', 'hf:owner/name#12', null)).toBe(2);
  });
});

describe('E9 p2: multi-label recoding (20/11/2026)', () => {
  const input = { codes: [{ id: 'c1', label: 'A', definition: 'a' }, { id: 'c2', label: 'B', definition: 'b' }], sentences: [{ id: 's1', text: 'x' }, { id: 's2', text: 'y' }] };
  it('accepts one or two codes per sentence, or NONE alone', () => {
    expect(TASKS.E9.check!(input as any, { codes: [{ sentence_id: 's1', code_ids: ['c1', 'c2'] }, { sentence_id: 's2', code_ids: ['NONE'] }] })).toEqual([]);
  });
  it('refuses three codes, NONE with a code, an empty list and unknown codes', () => {
    const e = TASKS.E9.check!(input as any, { codes: [{ sentence_id: 's1', code_ids: ['c1', 'c2', 'c1'] }, { sentence_id: 's2', code_ids: ['NONE', 'c1'] }] });
    expect(e.length).toBeGreaterThanOrEqual(2);
    expect(TASKS.E9.check!(input as any, { codes: [{ sentence_id: 's1', code_ids: [] }, { sentence_id: 's2', code_ids: ['c9'] }] }).length).toBeGreaterThanOrEqual(2);
  });
});

describe('E4M: a one-cluster merge is dropped, not an error (20/11/2026)', () => {
  const input = { role_title: 'QA', clusters: [{ id: 'k1', label: 'A', definition: 'a', jds: 3 }, { id: 'k2', label: 'B', definition: 'b', jds: 1 }, { id: 'k3', label: 'C', definition: 'c', jds: 1 }] };
  it('accepts and drops it; still refuses a cluster in two merges', () => {
    const out = { merges: [{ cluster_ids: ['k1'], canonical_id: 'k1' }, { cluster_ids: ['k2', 'k3'], canonical_id: 'k2' }] };
    expect(TASKS.E4M.check!(input as any, out)).toEqual([]);
    expect(TASKS.E4M.normalize(input as any, out).merges).toHaveLength(1);
    expect(TASKS.E4M.check!(input as any, { merges: [{ cluster_ids: ['k1', 'k2'], canonical_id: 'k1' }, { cluster_ids: ['k2', 'k3'], canonical_id: 'k2' }] }).length).toBeGreaterThan(0);
  });
});

describe('E4M: ids with stray spaces are trimmed (20/11/2026)', () => {
  it('accepts " k2" as k2', () => {
    const input = { role_title: 'AI', clusters: [{ id: 'k1', label: 'A', definition: 'a', jds: 3 }, { id: 'k2', label: 'B', definition: 'b', jds: 1 }] };
    const out = { merges: [{ cluster_ids: ['k1', ' k2'], canonical_id: ' k1' }] };
    expect(TASKS.E4M.check!(input as any, out)).toEqual([]);
    expect(TASKS.E4M.normalize(input as any, out).merges[0]).toEqual({ cluster_ids: ['k1', 'k2'], canonical_id: 'k1' });
  });
});
