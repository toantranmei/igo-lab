import { describe, expect, it } from 'vitest';
import { QUOTA_PATTERN, parseQuotaReset } from '@cl/agents';
import { BlockGuard, budgetFrom, estimateRun, inputLimitFor, inputTokensFromChars, t8InputTokens, usageTokens } from '@cl/pipeline';

describe('nhận diện hạn mức và giờ hồi', () => {
  it('nhận đúng câu lỗi hạn mức của CLI', () => {
    expect(QUOTA_PATTERN.test("You've hit your limit · resets 2:30am (Asia/Saigon)")).toBe(true);
    expect(QUOTA_PATTERN.test('Claude AI usage limit reached|1763500000')).toBe(true);
    expect(QUOTA_PATTERN.test('claude thoát với mã 1')).toBe(false);
  });
  it('giờ hồi là lần kế tiếp của giờ đó theo múi giờ ghi trong câu', () => {
    // 18/11/2026 20:00 ở Sài Gòn (UTC+7) = 13:00Z → 2:30 sáng hôm sau = 19/11 19:30Z hôm trước
    const now = new Date('2026-11-18T13:00:00Z');
    expect(parseQuotaReset("You've hit your limit · resets 2:30am (Asia/Saigon)", now)).toBe('2026-11-18T19:30:00.000Z');
    // trước 2:30 cùng ngày → hôm nay
    expect(parseQuotaReset('resets 2:30am (Asia/Saigon)', new Date('2026-11-18T18:00:00Z'))).toBe('2026-11-18T19:30:00.000Z');
    expect(parseQuotaReset('resets 11pm (UTC)', new Date('2026-11-18T10:00:00Z'))).toBe('2026-11-18T23:00:00.000Z');
    expect(parseQuotaReset('resets 12am (UTC)', new Date('2026-11-18T10:00:00Z'))).toBe('2026-11-19T00:00:00.000Z');
    expect(parseQuotaReset('usage limit reached', now)).toBeNull();
  });
});

describe('ước tính và ngân sách', () => {
  it('ước tính tăng theo số JD; ngân sách = 1,5 × ước tính', () => {
    const a = estimateRun({ jds: 15 });
    const b = estimateRun({ jds: 50 });
    expect(b.tokens).toBeGreaterThan(a.tokens);
    expect(a.blocks.map((x) => x.block)).toEqual(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
    // P1: E1 reads JDs in batches, so 15 JDs take a few calls, not 15
    const b1 = a.blocks.find((x) => x.block === 'B1')!;
    expect(b1.calls).toBeGreaterThan(0);
    expect(b1.calls).toBeLessThan(15);
    expect(b1.tasks[0].task).toBe('E1');
    expect(a.calls).toBeLessThan(40); // + E9 re-coding and three E10 seats
    const bud = budgetFrom(a);
    expect(bud.run_tokens).toBe(Math.ceil(a.tokens * 1.5));
    expect(bud.block_tokens.B0).toBeUndefined();
  });
  it('dùng số đếm đã biết khi có; T8 cũ với 566 nhóm ≈ 50 nghìn token đầu vào như số đo', () => {
    const e = estimateRun({ jds: 175, valid: 131, tasks: 856, groups: 566 });
    expect(e.blocks.find((x) => x.block === 'B5')!.tasks[0]).toMatchObject({ task: 'E5' });
    expect(e.blocks.find((x) => x.block === 'B5')!.tasks[0].calls % Math.ceil(856 / 25)).toBe(0); // task batches × list parts
    // inputs are packed to ≈ 6 500 tokens, under the anomaly limit of the task (E23 carries the occupation list)
    for (const b of estimateRun({ jds: 50 }).blocks) for (const x of b.tasks) expect(x.input_per_call, x.task).toBeLessThan(inputLimitFor(x.task));
    expect(t8InputTokens(566)).toBeGreaterThan(50000);
    expect(t8InputTokens(566)).toBeLessThan(65000);
  });
  it('cộng token từ usage; ước token theo số ký tự', () => {
    expect(usageTokens({ input_tokens: 2, cache_creation_input_tokens: 50412, cache_read_input_tokens: 1169, output_tokens: 201 })).toBe(51784);
    expect(usageTokens(null)).toBe(0);
    expect(inputTokensFromChars(92461)).toBeGreaterThan(50000);
    expect(inputTokensFromChars(0)).toBe(1200);
  });
});

describe('BlockGuard', () => {
  const budget = { run_tokens: 100000, block_tokens: { B5: 50000 }, estimate_tokens: 0, factor: 1.5 };
  it('chặn đầu vào bất thường trước khi gọi; chấp nhận vượt bỏ đúng phép kiểm đó', () => {
    const g = new BlockGuard('B5', budget, 10);
    expect(() => g.before('T8', 92461)).toThrow(expect.objectContaining({ code: 'ANOMALY_INPUT' }));
    expect(g.calls).toBe(0);
    const ok = new BlockGuard('B5', { ...budget, block_tokens: { B5: 1e9 }, run_tokens: 1e9 }, 10, { input: true });
    expect(ok.before('T8', 92461)).toBeGreaterThan(50000);
    // lô (T3/T5) có ngưỡng riêng
    expect(new BlockGuard('B2', budget, 10).before('T3', 20000)).toBeGreaterThan(8000);
  });
  it('trần của bước tính cả phần đã giữ chỗ cho lời gọi đang chờ', () => {
    const g = new BlockGuard('B5', budget, 100);
    for (let i = 0; i < 7; i++) g.before("T8", 9000); // ≈ 6 825 token mỗi lời gọi, 7 × 6 825 = 47 775
    expect(() => g.before('T8', 9000)).toThrow(expect.objectContaining({ code: 'BUDGET_BLOCK' }));
  });
  it('số lời gọi vượt 1,5 × ước tính là bất thường', () => {
    const g = new BlockGuard('B1', undefined, 20);
    for (let i = 0; i < 30; i++) g.before('T1', 100);
    expect(() => g.before('T1', 100)).toThrow(expect.objectContaining({ code: 'ANOMALY_CALLS' }));
  });
});
