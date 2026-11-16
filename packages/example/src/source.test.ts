import { describe, expect, it } from 'vitest';
import { MAIN_BLOCK_IDS } from '@cl/contract';
import type { BlockId } from '@cl/contract';
import { sampleTwoRunState } from './mappers';
import { EXAMPLE_STORAGE_KEY, ExampleSource } from './source';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** Walks one block the way the drawer does: begin → every beat → acknowledge. */
async function walk(src: ExampleSource, id: BlockId) {
  await src.begin(id);
  const trace = (await src.getTrace(id, false))!;
  const last = trace.events.length - 1;
  for (let c = 1; c <= last; c++) await src.progress(id, c, c === last);
  await src.acknowledge(id);
}
async function walkRun(src: ExampleSource) {
  for (const id of MAIN_BLOCK_IDS) await walk(src, id);
}
const count = (changes: { action: string }[], a: string) => changes.filter((c) => c.action === a).length;

describe('ExampleSource', () => {
  it('chạy hết lượt 1 qua begin / progress / acknowledge; mỗi block ghi đúng một lần', async () => {
    const storage = new MemoryStorage();
    const src = new ExampleSource(storage);
    let emitted = 0;
    const off = src.subscribe(() => emitted++);
    let s = await src.getState();
    expect([s.mode, s.runLabel, s.inputSummary, s.position, s.statusText]).toEqual(['example', 'Lượt 01', '8 JD · 6 nhiệm vụ · 6 sự kiện', 0, 'Sẵn sàng']);
    expect(s.cards.map((c) => c.id)).toEqual([...MAIN_BLOCK_IDS, 'FAST']);
    expect(s.cards.every((c) => c.state === 'idle' && c.badge.kind === 'CODE')).toBe(true);
    expect(s.fault?.locked).toBe(false);

    for (const [i, id] of MAIN_BLOCK_IDS.entries()) {
      await src.begin(id);
      s = await src.getState();
      expect(s.pending).toEqual({ id, cursor: 0, committed: false });
      expect(s.cards[i].state).toBe('awaiting_view');
      expect(s.statusText).toBe('Đang xem · ' + id);
      expect(s.position).toBe(i);
      const preview = (await src.getTrace(id, true))!;
      const last = preview.events.length - 1;
      await src.progress(id, last - 1, false);
      expect(src.getLab().position).toBe(i);
      await expect(src.acknowledge(id)).rejects.toThrow();
      await src.progress(id, last, true);
      await src.progress(id, last, true);
      expect(src.getLab().position).toBe(i + 1);
      expect(src.getLab().logs.filter((l) => l.step === id && l.type === 'PASS')).toHaveLength(1);
      // trace từ đầu ra thật trùng với bản xem trước, chỉ khác thời điểm tính
      const actual = (await src.getTrace(id, false))!;
      expect(actual.events.map((e) => [e.kind, e.title, e.substitution])).toEqual(preview.events.map((e) => [e.kind, e.title, e.substitution]));
      await src.acknowledge(id);
      s = await src.getState();
      expect(s.pending).toBeNull();
      expect(s.cards[i].state).toBe('pass');
    }
    expect(emitted).toBeGreaterThan(9 * 3);
    off();

    expect(s.completed).toBe(true);
    expect(s.position).toBe(9);
    expect(s.statusText).toBe('Hoàn tất lượt 1');
    expect(s.dictionary.version).toBe('1.0');
    expect(s.dictionaryVersionLabel).toBe('Lõi v1.0');
    expect(s.startDictionaryVersion).toBe('0.9');
    expect(s.audit?.findings.map((f) => f.id)).toEqual(['F-001']);
    expect(s.lessons.map((l) => [l.id, l.status])).toEqual([['LL-001', 'PENDING']]);
    expect(s.canStartNextRun).toBe(false);
    expect(s.nextRunHint).toContain('LL-001');
    expect(s.fault?.locked).toBe(true);
    expect(s.logs.every((l) => l.summary.length > 0)).toBe(true);
    await expect(src.begin('B8')).rejects.toThrow();
    await expect(src.startNextRun()).rejects.toThrow();
    expect(JSON.parse(storage.getItem(EXAMPLE_STORAGE_KEY)!).schema).toBe(1);
  });

  it('bấm begin hai lần trả về cùng một lượt xem; sai thứ tự bị từ chối', async () => {
    const src = new ExampleSource(new MemoryStorage());
    await expect(src.begin('B1')).rejects.toThrow();
    await expect(src.begin('FAST')).rejects.toThrow();
    const [a, b] = await Promise.all([src.begin('B0'), src.begin('B0')]);
    expect(b).toEqual(a);
    await src.progress('B0', 2, false);
    expect(await src.begin('B0')).toEqual({ id: 'B0', cursor: 2, committed: false });
    // đang có block chờ xem: yêu cầu khác trả về chính block đó, không tạo cái thứ hai
    expect((await src.begin('B1')).id).toBe('B0');
    const lab = src.getLab();
    expect(lab.guide!.acknowledged).toHaveLength(0);
    expect(lab.position).toBe(0);
    await expect(src.setFault('missing_source')).rejects.toThrow();
  });

  it('đóng giữa chừng rồi mở lại trên cùng storage: giữ đúng vị trí và con trỏ', async () => {
    const storage = new MemoryStorage();
    const first = new ExampleSource(storage);
    await walk(first, 'B0');
    await walk(first, 'B1');
    await first.begin('B2');
    await first.progress('B2', 3, false);

    const second = new ExampleSource(storage);
    const s = await second.getState();
    expect(s.position).toBe(2);
    expect(s.pending).toEqual({ id: 'B2', cursor: 3, committed: false });
    expect(s.cards[2].state).toBe('awaiting_view');
    expect(second.getLab()).not.toBe(first.getLab());

    // tiếp tục từ chỗ dở: ghi đúng một lần
    const last = (await second.getTrace('B2', false))!.events.length - 1;
    await second.progress('B2', last, true);
    const third = new ExampleSource(storage);
    expect((await third.getState()).pending).toEqual({ id: 'B2', cursor: last, committed: true });
    await third.acknowledge('B2');
    expect(third.getLab().position).toBe(3);
    expect(third.getLab().logs.filter((l) => l.step === 'B2' && l.type === 'PASS')).toHaveLength(1);
  });

  it('bỏ qua dữ liệu khác schema và không đọc khóa cũ', async () => {
    const storage = new MemoryStorage();
    const done = new ExampleSource(new MemoryStorage());
    await walk(done, 'B0');
    storage.setItem('competence-lab-v1', JSON.stringify(done.exportAll()));
    storage.setItem(EXAMPLE_STORAGE_KEY, JSON.stringify({ schema: 2, lab: done.exportAll() }));
    expect(new ExampleSource(storage).getLab().position).toBe(0);
    expect(storage.getItem(EXAMPLE_STORAGE_KEY)).toBeNull();
    storage.setItem(EXAMPLE_STORAGE_KEY, '{not json');
    expect(new ExampleSource(storage).getLab().position).toBe(0);
    expect(() => new ExampleSource(null)).not.toThrow();
    expect(() => new ExampleSource()).not.toThrow();
  });

  it('cổng FAIL: vẫn dừng sau khi Đã hiểu; mở lại cần lý do và chạy lại được block', async () => {
    const src = new ExampleSource(new MemoryStorage());
    await src.setFault('missing_source');
    await walk(src, 'B0');
    await walk(src, 'B1');
    let s = await src.getState();
    expect(s.halted).toBe(true);
    expect(s.pending).toBeNull();
    expect(s.position).toBe(1);
    expect(s.haltReasons).toEqual(['Nguồn truy được']);
    expect(s.statusText).toBe('Đang dừng');
    expect(s.cards[1].state).toBe('blocked');
    expect(s.cards[1].receipt).toBe('⊘ Không bàn giao');
    expect(s.fast.available).toBe(false);
    expect(s.inputs.jds[0].sourceOk).toBe(false);
    expect(s.inputs.jds.slice(1).every((j) => j.sourceOk)).toBe(true);
    expect((await src.getDetail('B1')).state).toBe('actual_blocked');
    expect((await src.getDetail('B2')).blockedAt).toBe('B1');
    await expect(src.begin('B1')).rejects.toThrow();
    await expect(src.begin('B2')).rejects.toThrow();
    await expect(src.recover('   ')).rejects.toThrow();
    expect((await src.getState()).halted).toBe(true);

    await src.recover('Đã bổ sung địa chỉ nguồn cho JD-1-1');
    s = await src.getState();
    expect(s.halted).toBe(false);
    expect(s.fault?.value).toBe('none');
    expect(s.logs.at(-1)!.summary).toContain('Đã bổ sung địa chỉ nguồn');
    await walk(src, 'B1');
    s = await src.getState();
    expect(s.position).toBe(2);
    expect(s.cards[1].state).toBe('pass');
    expect(s.inputs.jds.every((j) => j.sourceOk)).toBe(true);
  });

  it('FAST: giao thử sau B3, tạo khung trial, không ghi lõi', async () => {
    const src = new ExampleSource(new MemoryStorage());
    for (const id of ['B0', 'B1', 'B2', 'B3'] as const) await walk(src, id);
    expect((await src.getState()).fast).toMatchObject({ available: true, done: false });
    await walk(src, 'FAST');
    const s = await src.getState();
    expect(s.fast).toEqual({ available: false, done: true, summary: 'trial-1.1 · 9/12 bài seed đạt' });
    expect(s.trial).toMatchObject({ id: 'R-PO-trial', version: 'trial-1.1', trial: true, evidence: 'synthetic_only' });
    expect(s.trial!.competencies).toHaveLength(6);
    expect(s.trial!.competencies.every((c) => c.level === null && c.indicator === null)).toBe(true);
    expect(s.position).toBe(4);
    expect(s.dictionary.version).toBe('0.9');
    expect(s.cards.find((c) => c.id === 'FAST')!.state).toBe('pass');
    expect(src.exportFrame().trial).toBe(true);
    await expect(src.begin('FAST')).rejects.toThrow();
  });

  it('sau lượt 2: giữ cả khung 1.0 và 1.1; lịch sử có 2 bản phát hành', async () => {
    const storage = new MemoryStorage();
    const src = new ExampleSource(storage);
    await walkRun(src);
    await src.approveLessons('Đã chạy phép thử hồi quy');
    let s = await src.getState();
    expect(s.lessons[0].status).toBe('SAFE');
    expect(s.canStartNextRun).toBe(true);
    await src.startNextRun();
    s = await src.getState();
    expect([s.runNo, s.runLabel, s.position, s.inputSummary]).toEqual([2, 'Lượt 02', 0, '11 JD · 7 nhiệm vụ · 7 sự kiện']);
    expect(s.startDictionaryVersion).toBe('1.0');
    expect(s.fault?.locked).toBe(false);
    await walkRun(src);

    const level = (v: string) => src.exportFrame(v).competencies.find((c: any) => c.id === 'C04').level;
    expect(level('1.0')).toBe(3);
    expect(level('1.1')).toBe(4);
    expect(src.exportFrame().version).toBe('1.1');
    expect(src.exportFrame('1.0').evidence).toBe('synthetic_only');
    expect(src.exportFrame('9.9')).toBeNull();
    expect(src.exportSeed().jds).toHaveLength(11);
    expect(src.exportAll().round).toBe(2);

    s = await src.getState();
    expect(s.history).toHaveLength(2);
    expect(s.history.map((h) => [h.fromVersion, h.toVersion])).toEqual([['0.9', '1.0'], ['1.0', '1.1']]);
    expect(s.history.map((h) => ['ADD', 'UPDATE', 'REUSE'].map((a) => count(h.changes, a)))).toEqual([[4, 2, 0], [1, 1, 5]]);
    expect(s.history[0].after.C).toHaveLength(6);
    expect(s.history[1].after.C).toHaveLength(7);
    expect(s.history[0].after.R).toHaveLength(1);
    expect(s.dictionary.R.map((r) => r.version)).toEqual(['1.0', '1.1']);
    expect(s.dictionary.R[0].competencies.find((c) => c.id === 'C04')!.level).toBe(3);
    expect(s.dictionary.G.map((g) => g.changes.length)).toEqual([6, 7]);
    expect(s.dictionary.W[0].tasks.find((t) => t.id === 'T7')!.competencies).toEqual(['C07']);
    expect(s.audit?.findings).toEqual([]);
    expect(s.canStartNextRun).toBe(false);

    // khôi phục từ storage vẫn ra cùng kết quả
    const again = await new ExampleSource(storage).getState();
    expect(again.history.map((h) => h.toVersion)).toEqual(['1.0', '1.1']);
    expect(again.completed).toBe(true);

    await src.reset();
    expect(storage.getItem(EXAMPLE_STORAGE_KEY)).toBeNull();
    expect((await src.getState()).position).toBe(0);
  });

  it('sampleTwoRunState: trạng thái sau hai lượt, có cache', () => {
    const s = sampleTwoRunState();
    expect(sampleTwoRunState()).toBe(s);
    expect([s.runNo, s.completed, s.dictionary.version, s.history.length]).toEqual([2, true, '1.1', 2]);
  });
});
