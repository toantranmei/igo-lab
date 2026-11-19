import { describe, expect, it } from 'vitest';
import { ShortIds, isGeneric, jaccard, linesOf, maskPII, nearDuplicates, offJobSegments, pack, precluster, shingles } from '../../packages/pipeline/src/prep';

const seg = (n: number, text: string) => ({ id: `d@1#${n}`, n, start: 0, end: 0, text });

describe('K1 · JD trùng gần đúng', () => {
  it('Jaccard trên 3-gram từ; bản sửa vài chữ là trùng, JD khác không trùng', () => {
    const a = 'Mô tả công việc Product Owner. Sắp xếp backlog theo giá trị kinh doanh. Viết tiêu chí nghiệm thu cho từng hạng mục. Làm việc với đội phát triển hằng ngày.';
    const b = a.replace('hằng ngày', 'mỗi ngày');
    const c = 'Kế toán trưởng: lập báo cáo tài chính quý, kiểm soát chứng từ và làm việc với kiểm toán.';
    expect(jaccard(shingles(a), shingles(a))).toBe(1);
    const d = nearDuplicates([{ ref: 'a', text: a, content_sha256: '1' }, { ref: 'b', text: b, content_sha256: '2' }, { ref: 'c', text: c, content_sha256: '3' }], 0.8);
    expect(d.get('b')?.of).toBe('a');
    expect(d.get('b')!.j).toBeGreaterThanOrEqual(0.8);
    expect(d.has('c')).toBe(false);
    // the same bytes count as J = 1 whatever the threshold
    expect(nearDuplicates([{ ref: 'x', text: 'một', content_sha256: 'h' }, { ref: 'y', text: 'hai', content_sha256: 'h' }]).get('y')).toEqual({ of: 'x', j: 1 });
  });
});

describe('K2 · che dữ liệu cá nhân', () => {
  it('email, số điện thoại, liên kết và tên người liên hệ', () => {
    const r = maskPII('Liên hệ: Nguyễn Văn An, email hr@acme.vn, ĐT 0901 234 567 hoặc +84 912345678. Xem www.acme.vn/jobs. Contact: Jane Doe.');
    expect(r.text).not.toMatch(/hr@acme|0901|912345678|Nguyễn Văn An|Jane Doe|acme\.vn\/jobs/);
    expect(r.text).toContain('[người liên hệ]');
    expect(r.hits).toBeGreaterThanOrEqual(5);
    expect(maskPII('Sắp xếp backlog theo giá trị [k1]').text).toBe('Sắp xếp backlog theo giá trị [k1]');
  });
});

describe('K7, K8 · câu chung chung và mục không mô tả công việc', () => {
  it('cắt phúc lợi, giới thiệu công ty, cách ứng tuyển tới tiêu đề công việc kế tiếp; câu nhiệm vụ có chữ "liên hệ" không bị coi là tiêu đề', () => {
    const segs = [seg(1, 'Về chúng tôi:'), seg(2, 'ACME là công ty phần mềm hàng đầu.'), seg(3, 'Mô tả công việc:'), seg(4, 'Liên hệ đối tác để thống nhất phạm vi dự án'), seg(5, 'Quyền lợi'), seg(6, 'Lương tháng 13, bảo hiểm đầy đủ.'), seg(7, 'Yêu cầu:'), seg(8, 'Có 3 năm kinh nghiệm.'), seg(9, 'Cách ứng tuyển'), seg(10, 'Gửi CV qua email.')];
    expect([...offJobSegments(segs)].sort()).toEqual(['d@1#1', 'd@1#10', 'd@1#2', 'd@1#5', 'd@1#6', 'd@1#9'].sort());
    expect(isGeneric('Thực hiện các công việc khác theo yêu cầu của cấp trên')).toBe(true);
    expect(isGeneric('Other duties as assigned')).toBe(true);
    expect(isGeneric('Sắp xếp backlog theo giá trị')).toBe(false);
  });
});

describe('K3, K5 · mã ngắn, gom sơ bộ, chia lô', () => {
  it('mã ngắn ổn định và đổi ngược được; dòng đánh số', () => {
    const ids = new ShortIds();
    expect(ids.short('s', 'doc_abc@1#7')).toBe('s1');
    expect(ids.short('s', 'doc_abc@1#9')).toBe('s2');
    expect(ids.short('s', 'doc_abc@1#7')).toBe('s1');
    expect(ids.longs(['s2', 'sX', 's1'])).toEqual(['doc_abc@1#9', 'doc_abc@1#7']);
    expect(linesOf([{ id: 'a', text: 'Dòng  một\n tiếp' }, { id: 'b', text: 'Hai' }], new ShortIds())).toBe('s1 Dòng một tiếp\ns2 Hai');
  });
  it('gom câu giống nhau; câu khác việc tách cụm', () => {
    const items = [
      { id: '1', t: 'Sắp xếp backlog theo giá trị' },
      { id: '2', t: 'Sắp xếp backlog theo giá trị.' },
      { id: '3', t: 'Sắp xếp backlog theo giá trị kỳ vọng' },
      { id: '4', t: 'Đo lường kết quả sau phát hành' },
    ];
    const cl = precluster(items, (x) => x.t).map((c) => c.map((x) => x.id));
    // only near-identical wording joins in code; "…kỳ vọng" is left for E3 to judge
    expect(cl).toContainEqual(['1', '2']);
    expect(cl).toContainEqual(['4']);
    expect(cl.flat().sort()).toEqual(['1', '2', '3', '4']);
  });
  it('chia lô theo cỡ ký tự và số mục tối đa', () => {
    expect(pack([5, 5, 5, 5, 20, 1], (x) => x, 10).map((b) => b.length)).toEqual([2, 2, 1, 1]);
    expect(pack([1, 1, 1, 1, 1], (x) => x, 100, 2).map((b) => b.length)).toEqual([2, 2, 1]);
  });
});

import { matchItems, prf, scoreE1 } from '../../packages/pipeline/src/anchor';
describe('Bộ neo · công thức (16)', () => {
  it('P, R, F1 và ghép một-một theo độ giống', () => {
    expect(prf(8, 2, 4)).toMatchObject({ precision: 0.8, recall: 0.6667, f1: 0.7273 });
    expect(prf(0, 0, 0)).toMatchObject({ precision: null, recall: null, f1: null });
    const m = matchItems(['Sắp xếp backlog theo giá trị', 'Viết tiêu chí nghiệm thu'], ['Sắp xếp backlog theo giá trị kinh doanh', 'Đo lường kết quả']);
    expect(m).toMatchObject({ tp: 1, fp: 1, fn: 1 });
    const s = scoreE1({ id: 'x', role_title: 'PO', labelled_by: 'a', jds: [{ name: 'A', text: '', gold: { verdict: 'IN_SCOPE', tasks: ['Sắp xếp backlog'], competencies: [{ label: 'Ưu tiên backlog' }] } }] }, [{ name: 'A', verdict: 'IN_SCOPE', tasks: ['Sắp xếp backlog'], competencies: ['Ưu tiên backlog — Khả năng sắp xếp'] }]);
    expect(s.scope_accuracy).toBe(1);
    expect(s.tasks.f1).toBe(1);
  });
});
