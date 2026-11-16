import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@cl/db';
import { getCandidate, getState, processNextJob, setAuto, writeWorkerStatus } from '@cl/pipeline';
import { listReleases } from '@cl/registry';
import { JD_A, JD_B, JD_OTHER, doc, newSession, runner } from './fixtures';
import { WS, closeTestDb, resetDb } from './helpers';

let db: Db;
beforeAll(async () => {
  db = await resetDb();
  await writeWorkerStatus(db, { ok: true, version: '2.1.325', message: 'ok' });
});
afterAll(closeTestDb);
const drain = async () => {
  for (let i = 0; i < 40 && (await processNextJob(db, runner())); i++);
};

describe('chạy tự động', () => {
  it('một lần bật: chạy B0→B8 không cần bấm, dừng ở hồ sơ dự kiến, không tự ghi từ điển', async () => {
    const { sessionId } = await newSession(db, [doc('A', JD_A), doc('B', JD_B)]);
    expect((await setAuto(db, WS, sessionId, true, 'local')).on).toBe(true);
    expect((await getState(db, WS, sessionId)).pending).toBeNull();
    await drain();
    const st = await getState(db, WS, sessionId);
    expect(st.position).toBe(9);
    expect(st.cards.filter((c) => c.id !== 'FAST').every((c) => c.state === 'pass')).toBe(true);
    expect(st.auto).toMatchObject({ on: false, running: null });
    expect(st.auto!.note).toContain('DỰ KIẾN');
    expect(st.completed).toBe(false);
    expect((await getCandidate(db, WS, sessionId))?.status).toBe('READY');
    expect(await listReleases(db, WS)).toHaveLength(0);
    expect(st.logs.filter((l) => l.type === 'ACKNOWLEDGED')).toHaveLength(9);
  });
  it('cổng chặn làm dừng tự động và nêu block', async () => {
    const { sessionId } = await newSession(db, [doc('X', JD_OTHER)], 'Sai role');
    await setAuto(db, WS, sessionId, true, 'local');
    await drain();
    const st = await getState(db, WS, sessionId);
    expect(st.auto!.on).toBe(false);
    expect(st.auto!.note).toContain('B1');
    expect(st.cards.find((c) => c.id === 'B2')!.state).toBe('idle');
  });
  it('tắt giữa chừng: block đang chạy hoàn tất rồi chờ người dùng', async () => {
    const { sessionId } = await newSession(db, [doc('A', JD_A)], 'Dừng');
    await setAuto(db, WS, sessionId, true, 'local');
    await processNextJob(db, runner()); // B0, then B1 queued
    await setAuto(db, WS, sessionId, false, 'local');
    await drain();
    const st = await getState(db, WS, sessionId);
    expect(st.position).toBe(2);
    expect(st.pending?.id).toBe('B1');
  });
});
