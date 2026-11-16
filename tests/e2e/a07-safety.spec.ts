import { expect, test } from '@playwright/test';
import { ALL, PO_A, PO_B, apiRun, finishGuide, jd, publish, seedSession } from './helpers';
import { resetDatabase } from './global-setup';

test('A07 · Nhánh nhanh, lỗi gate, STOP: chỉ commit đủ điều kiện xuất hiện; retry commit không nhân đôi; hai lượt cùng base phát hiện conflict', async ({ page, request }) => {
  await resetDatabase();
  // fast branch: a trial only, nothing enters the dictionary
  const a = await seedSession(request, 'A07 A', 'Product Owner', [{ name: 'A', text: PO_A }]);
  await apiRun(request, a, ALL.slice(0, 4));
  await page.goto(`/s/${a}/line`);
  await page.locator('#fast').click();
  await finishGuide(page);
  await page.goto(`/s/${a}/framework`);
  await expect(page.locator('#framework')).toContainText('Bản thử');
  expect(await (await request.get('/api/releases')).json()).toEqual([]);

  // gate failure: a JD for another role → blocked, still blocked after "Đã hiểu", no later block can start
  const g = await seedSession(request, 'A07 gate', 'Product Owner', [{ name: 'X', text: 'Mô tả công việc: Kế toán trưởng\nNV: Lập báo cáo [k9]' }]);
  await apiRun(request, g, ['B0', 'B1']);
  await page.goto(`/s/${g}/line`);
  await expect(page.locator('.prod-node[data-prod-select="B1"]')).toContainText('CHẶN');
  await expect(page.locator('#halt-banner')).toContainText('Số JD hợp lệ');
  await expect(page.locator('#step')).toBeDisabled();
  expect((await request.post(`/api/sessions/${g}/current/blocks/B2/attempts`, { data: {}, headers: { 'Idempotency-Key': 'g-b2' } })).status()).toBe(409);

  // two runs on the same base: the first commit wins, the second gets BASE_CHANGED in the UI
  const b = await seedSession(request, 'A07 B', 'Product Owner', [{ name: 'B', text: PO_B }]);
  await apiRun(request, a, ALL.slice(4));
  await apiRun(request, b, ALL);
  const first = await publish(request, a);
  expect(first.status).toBe(200);
  const again = await request.post(`/api/candidates/${first.candidate.id}/commit`, { data: { expected_base_release_id: null } });
  expect((await again.json()).release_id).toBe(first.body.release_id);
  expect((await again.json()).replayed).toBe(true);
  expect(await (await request.get('/api/releases')).json()).toHaveLength(1);
  await page.goto(`/s/${b}/audit`);
  await page.locator('#release-reason').fill('Thử ghi trên nền cũ');
  await page.locator('#release-commit').click();
  await expect(page.getByTestId('release-error')).toContainText('BASE_CHANGED');
  await expect(page.getByTestId('live-release')).toContainText('DỰ KIẾN');
  expect(await (await request.get('/api/releases')).json()).toHaveLength(1);

  // STOP: a critical audit finding blocks new jobs and commits until lessons are decided and the workspace is reopened
  const s = await seedSession(request, 'A07 stop', 'Product Owner', [{ name: 'S', text: jd('Product Owner', 'Công ty S', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NL: Lập lộ trình sản phẩm — Khả năng critical_test lập lộ trình [k1]']) }]);
  await apiRun(request, s, ALL);
  await page.goto(`/s/${s}/audit`);
  await expect(page.locator('#halt-banner')).toContainText('STOP');
  await expect(page.locator('#audit')).toContainText('CRITICAL');
  await expect(page.locator('#release-commit')).toBeDisabled();
  const c = await (await request.get(`/api/sessions/${s}/candidate`)).json();
  await request.post(`/api/candidates/${c.id}/decision`, { data: { decision: 'ACCEPT', reason: 'thử' } });
  const blocked = await request.post(`/api/candidates/${c.id}/commit`, { data: { expected_base_release_id: c.base_release_id } });
  expect(blocked.status()).toBe(423);
  expect((await request.post(`/api/sessions/${a}/runs`, { data: { acknowledge_send: true } })).status()).toBe(423);
  expect((await request.post('/api/workspace/reopen', { data: { reason: 'đã sửa' } })).status()).toBe(409); // lesson still pending
  await page.locator('#safe-reason').fill('Đã bổ sung kiểm căn cứ');
  await page.locator('#safe').click();
  await expect(page.locator('#lessons')).toContainText('An toàn');
  await page.locator('#halt-banner input').fill('Đã xử lý finding và lesson');
  await page.locator('#recover').click();
  await expect(page.locator('#halt-banner')).not.toContainText('STOP toàn workspace');
  expect(await (await request.get('/api/workspace')).json()).toMatchObject({ stop: null });
  expect(await (await request.get('/api/releases')).json()).toHaveLength(1); // only the eligible commit exists
  expect((await (await request.get('/api/workspace')).json()).event_chain.ok).toBe(true);
});
