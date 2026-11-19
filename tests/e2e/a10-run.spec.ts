import { expect, test } from '@playwright/test';
import { PO_A, fakeMode, jd, noHorizontalOverflow, seedSession } from './helpers';

test.afterEach(() => fakeMode(''));

/** JDs no earlier test sent, so the CLI is really called (identical inputs come from the stored results). */
const fresh = (tag: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `${tag}${i}`, text: jd('Product Owner', `Công ty ${tag}${i}`, ['NV: Sắp xếp backlog theo giá trị [k1]', `NV: Sắp xếp backlog đợt ${tag} ${i} ${Date.now()} [k1]`, 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]']) }));

test('A10 · Lượt chạy: thấy bước con và tiến độ khi đang chạy; thời gian từng bước; mở chi tiết, lời gọi, các lần chạy; lịch sử lượt', async ({ page, request }) => {
  test.setTimeout(300_000); // may wait for a breaker left by A10b of an earlier run
  const sid = await seedSession(request, 'A10 chạy', 'Product Owner', fresh('R', 8));
  // A breaker tripped by A10b of an earlier e2e run may still be open (≤ 1 min) in the new worker's memory; its heartbeat
  // (every 1.5 s) writes it back after global-setup cleared it, so look only after two heartbeats.
  await new Promise((r) => setTimeout(r, 3500));
  const runId = (await (await request.get(`/api/sessions/${sid}/runs`)).json())[0].id;
  await expect.poll(async () => (await (await request.get(`/api/runs/${runId}/overview`)).json()).breaker, { timeout: 150_000, intervals: [2000] }).toBeNull();
  fakeMode('slow:6000');
  await page.goto(`/s/${sid}/run`);
  await expect(page.getByTestId('kpis')).toContainText('bước đã xong');
  await expect(page.locator('.lv-nav a.on')).toHaveText('Lượt chạy');
  await page.locator('#run-start').click();
  // B1 reads the eight JDs in one E1 call that takes 6 s here: the screen must show the step and its sub-step while it runs
  const b1 = page.locator('[data-step="B1"]');
  await expect(b1).toHaveAttribute('data-status', 'running', { timeout: 20_000 });
  await expect(page.getByTestId('substeps-B1')).toContainText('Đọc JD theo lô');
  await expect(page.getByTestId('worker-chip')).toContainText('Đang chạy');
  fakeMode('');
  await expect(page.getByTestId('stop-banner')).toHaveAttribute('data-stop', 'DONE', { timeout: 90_000 });
  await expect(page.getByTestId('kpis')).toContainText('9 / 9');
  // every step shows a duration; B1 took at least the 1.5 s of one call
  const ov = await (await request.get(`/api/runs/${runId}/overview`)).json();
  expect(ov.steps.every((s: any) => s.duration_ms !== null)).toBe(true);
  expect(ov.steps[1].duration_ms).toBeGreaterThanOrEqual(6000);
  await expect(b1.locator('.r').first()).not.toHaveText('—');

  await b1.click();
  await expect(page.locator('#step-detail')).toHaveAttribute('data-block', 'B1');
  await expect(page.getByTestId('beats')).toContainText('Đọc JD');
  await page.locator('#step-detail [data-tab="calls"]').click();
  await expect(page.getByTestId('calls-table')).toContainText('E1.jd_read');
  await page.locator('#step-detail [data-tab="att"]').click();
  await expect(page.getByTestId('attempts-table')).toContainText('chạy tự động');
  await page.locator('#step-detail [data-tab="viz"]').click();
  await expect(page.locator('#step-detail')).toContainText('Số JD hợp lệ');
  // P2: the cross-check column, the replay of calc records, and the B5 selected-set table
  await expect(page.getByTestId('xcheck-B5')).toContainText('r_wg');
  await page.locator('[data-step="B5"]').click();
  await page.locator('#step-detail [data-tab="flow"]').click();
  await expect(page.getByTestId('flow-card')).toBeVisible();
  await page.getByRole('button', { name: 'Phát' }).click();
  await expect(page.getByTestId('flow-card')).toContainText('=');
  await page.locator('#step-detail [data-tab="viz"]').click();
  await expect(page.getByTestId('b5-set')).toContainText('lõi');
  await noHorizontalOverflow(page);

  // a second run: the first one opens read-only from the history
  const again = await request.post(`/api/sessions/${sid}/runs`, { data: { acknowledge_send: true } });
  expect(again.ok()).toBe(true);
  await page.goto(`/s/${sid}/run`);
  await page.getByRole('button', { name: 'Lịch sử lượt' }).click();
  await expect(page.getByTestId('run-history')).toContainText('DỰ KIẾN');
  await page.locator('[data-testid="run-history"] tr[data-run="1"]').click();
  await expect(page.locator('#run-screen')).toHaveAttribute('data-run', '1');
  await expect(page.locator('#run-screen')).toContainText('chỉ đọc');
  await page.locator('[data-step="B5"]').click();
  await expect(page.locator('#step-detail')).toHaveAttribute('data-block', 'B5');

  await page.setViewportSize({ width: 390, height: 800 });
  await noHorizontalOverflow(page);
});

// Runs last: the breaker it trips stays open for FAKE_CLAUDE_QUOTA_RESET_MIN (1 min, see playwright.config.ts).
test('A10b · Hết hạn mức: banner QUOTA có giờ hồi, chạy tự động tắt, không xếp bước mới', async ({ page, request }) => {
  const sid = await seedSession(request, 'A10 hạn mức', 'Product Owner', [{ name: 'Q', text: PO_A + `\nNV: Việc hạn mức ${Date.now()} [k9]` }]);
  fakeMode('quota');
  await page.goto(`/s/${sid}/run`);
  await page.locator('#run-start').click();
  const banner = page.getByTestId('stop-banner');
  await expect(banner).toHaveAttribute('data-stop', 'QUOTA', { timeout: 60_000 });
  await expect(banner).toContainText('Hạn mức hồi lúc');
  await expect(banner.locator('[data-action="SCHEDULE"]')).toContainText('Hẹn chạy lúc');
  const st = await (await request.get(`/api/sessions/${sid}/state`)).json();
  expect(st.auto.on).toBe(false);
  const refused = await request.post(`/api/sessions/${sid}/current/blocks/B1/attempts`, { data: {}, headers: { 'Idempotency-Key': `q-${Date.now()}` } });
  expect(refused.status()).toBe(429);
  expect((await refused.json()).code).toBe('AGENT_QUOTA');
  await page.getByTestId('stop-banner').locator('[data-action="SCHEDULE"]').click();
  await expect(banner).toContainText('Đã hẹn chạy tiếp');
});
