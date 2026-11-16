import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ALL, PO_A, apiRun, publish, runBlock, seedSession } from './helpers';
import { DATA_DIR, resetDatabase } from './global-setup';

test('A09 · Phiên mẫu không đi vào từ điển Live; export không chứa bí mật', async ({ page, request }) => {
  await resetDatabase();
  const serverCalls: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/api/')) serverCalls.push(`${r.method()} ${r.url()}`); });
  await page.goto('/s/example/line');
  for (let i = 0; i < 9; i++) await runBlock(page);
  expect(serverCalls).toEqual([]); // the example never writes to the server
  expect(await (await request.get('/api/releases')).json()).toEqual([]);
  expect(await (await request.get('/api/sessions')).json()).toEqual([]);
  // example state lives under its own namespaced key
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((k) => !k.startsWith('cl.example.v1.'))).toEqual([]);
  // a Live session's dictionary does not contain seed records
  const sid = await seedSession(request, 'A09 live', 'Product Owner', [{ name: 'A', text: PO_A }]);
  await apiRun(request, sid, ALL);
  await publish(request, sid);
  const st = await (await request.get(`/api/sessions/${sid}/state`)).json();
  expect(JSON.stringify(st.dictionary)).not.toContain('seed://');
  expect(JSON.stringify(st.dictionary)).not.toContain('"synthetic":true');

  await page.goto('/transfer');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#bk-export').click()]);
  const p = path.join(DATA_DIR, 'a09.zip');
  await download.saveAs(p);
  const { unzipSync, strFromU8 } = await import('fflate');
  const text = Object.values(unzipSync(new Uint8Array(readFileSync(p)))).map((b) => strFromU8(b)).join('\n');
  for (const secret of ['cl_app_dev', 'cl_owner_dev', 'DATABASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', process.env.HOME ?? '/Users/', path.resolve(__dirname, '../..')]) expect(text).not.toContain(secret);
});

test('A09b · Người chỉ có quyền xem không tạo phiên, không duyệt, không mở lại, không tải gói đầy đủ', async ({ request, playwright }) => {
  await resetDatabase();
  const sid = await seedSession(request, 'A09 quyền', 'Product Owner', [{ name: 'A', text: PO_A }]);
  await apiRun(request, sid, ALL);
  const cand = await (await request.get(`/api/sessions/${sid}/candidate`)).json();
  const exp = await (await request.post('/api/exports', { data: { kind: 'backup' } })).json();
  const port = Number(new URL(test.info().project.use.baseURL!).port) + 1;
  const viewer = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${port}` });
  // reading is allowed
  expect((await viewer.get(`/api/sessions/${sid}/state`)).status()).toBe(200);
  expect((await (await viewer.get('/api/workspace')).json()).permissions).toEqual(['VIEW']);
  const denied: [string, string, unknown][] = [
    ['POST', '/api/sessions', { name: 'x', role_title: 'y', purpose: 'z' }],
    ['POST', `/api/sessions/${sid}/runs`, { acknowledge_send: true }],
    ['POST', `/api/sessions/${sid}/current/blocks/B0/attempts`, {}],
    ['POST', `/api/candidates/${cand.id}/decision`, { decision: 'ACCEPT', reason: 'x' }],
    ['POST', `/api/candidates/${cand.id}/commit`, { expected_base_release_id: null }],
    ['POST', '/api/workspace/stop', { reason: 'x' }],
    ['POST', '/api/workspace/reopen', { reason: 'x' }],
    ['POST', '/api/lessons/decision', { decision: 'SAFE', reason: 'x' }],
    ['POST', '/api/exports', { kind: 'backup' }],
    ['GET', `/api/exports/${exp.id}/download`, null],
  ];
  for (const [method, url, data] of denied) {
    const r = method === 'GET' ? await viewer.get(url) : await viewer.post(url, { data });
    expect(r.status(), `${method} ${url}`).toBe(403);
    expect((await r.json()).code).toBe('FORBIDDEN');
  }
  expect(await (await request.get('/api/releases')).json()).toEqual([]); // nothing was written
  await viewer.dispose();
});
