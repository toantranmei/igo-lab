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
