import { describe, expect, it } from 'vitest';
import { cpSlice, crossCheck, findPii, normalizeText, parseFile, parsePasted, parseSegmentId, segmentId, segmentText, shingleJaccard } from './index';

describe('norm-v1 + seg-v1', () => {
  it('chuẩn hóa NFC, xuống dòng, khoảng trắng cuối dòng, dòng trống', () => {
    const decomposed = 'Quản trị'.normalize('NFD');
    expect(normalizeText(decomposed + '  \r\n\r\n\r\n\r\nB\t')).toBe('Quản trị\n\nB');
  });
  it('offset là code point, nửa mở, đúng với tiếng Việt và ký tự ngoài BMP', () => {
    const t = normalizeText('- Ưu tiên backlog 🚀 theo giá trị\n- Đo lường kết quả');
    const segs = segmentText(t);
    expect(segs).toHaveLength(2);
    for (const s of segs) expect(cpSlice(t, s.start, s.end)).toBe(s.text);
    expect(segs[1].text).toBe('- Đo lường kết quả');
  });
  it('dòng dài được tách theo câu, vẫn khớp offset', () => {
    const line = Array.from({ length: 12 }, (_, i) => `Câu số ${i} mô tả một trách nhiệm khá dài của vị trí này.`).join(' ');
    const segs = segmentText(line);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(cpSlice(line, s.start, s.end)).toBe(s.text);
  });
  it('segment id khứ hồi', () => {
    expect(parseSegmentId(segmentId('doc_a@b', 3, 7))).toEqual({ documentId: 'doc_a@b', version: 3, n: 7 });
  });
});

describe('ingest', () => {
  it('dán văn bản: hash, đoạn, ngôn ngữ, PII', () => {
    const d = parsePasted('JD 1', 'Liên hệ hr@example.com hoặc 0912 345 678.\nQuản lý backlog sản phẩm.');
    expect(d.segments).toHaveLength(2);
    expect(d.language).toBe('vi');
    expect(d.pii.map((p) => p.kind)).toEqual(['email', 'phone']);
    expect(d.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.warnings.some((w) => w.code === 'PII')).toBe(true);
  });
  it('rỗng, sai định dạng, quá dài, lỗi mã hóa', async () => {
    expect(parsePasted('x', '   ').warnings[0].code).toBe('EMPTY');
    expect((await parseFile('a.xlsx', new Uint8Array([1, 2]))).warnings[0].code).toBe('UNSUPPORTED');
    expect(parsePasted('x', 'a'.repeat(50), { maxFiles: 1, maxFileMb: 1, maxCharsPerDoc: 10 }).warnings.some((w) => w.code === 'TOO_LONG')).toBe(true);
    expect((await parseFile('a.txt', new Uint8Array([0x41, 0xff, 0x42]))).warnings.some((w) => w.code === 'ENCODING')).toBe(true);
    expect((await parseFile('a.pdf', new Uint8Array([1, 2, 3]))).warnings.some((w) => w.severity === 'error')).toBe(true);
  });
  it('trùng byte, trùng nội dung, gần trùng', async () => {
    const base = 'Chuyển mục tiêu kinh doanh thành mục tiêu sản phẩm cho nhóm khách hàng cụ thể và sắp xếp backlog theo giá trị kỳ vọng, chi phí trì hoãn và rủi ro, ghi rõ đánh đổi cho từng lựa chọn trong quý.';
    const a = await parseFile('a.txt', new TextEncoder().encode(base));
    const b = await parseFile('b.txt', new TextEncoder().encode(base));
    const c = parsePasted('c', base + '  ');
    const d = parsePasted('d', base + ' Báo cáo hằng tuần.');
    const w = crossCheck([a, b, c, d]);
    expect(w[0]).toHaveLength(0);
    expect(w[1][0].code).toBe('DUPLICATE_BYTES');
    expect(w[2].some((x) => x.code === 'DUPLICATE_TEXT')).toBe(true);
    expect(w[3].some((x) => x.code === 'NEAR_DUPLICATE')).toBe(true);
    expect(shingleJaccard('một hai ba bốn năm sáu', 'hoàn toàn khác nội dung ở đây nhé')).toBe(0);
    expect(findPii('không có gì')).toHaveLength(0);
  });
});
