import { expect, test } from '@playwright/test';
import { runBlock } from './helpers';

test('A01 · Default Example chạy đủ hai lượt, đúng số liệu, export khung 1.0 vẫn giữ C04 bậc 3', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveURL(/\/s\/example\/line/);
  await expect(page.locator('.mode-pill')).toHaveText('EXAMPLE');
  // the example never talks to the server-side pipeline
  const apiCalls: string[] = [];
  page.on('request', (r) => { if (/\/api\/(sessions\/example|runs|candidates)/.test(r.url())) apiCalls.push(r.url()); });

  for (let b = 0; b < 9; b++) await runBlock(page);
  await expect(page.locator('[data-prod-select="B8"]')).toContainText('ĐẠT');
  await page.goto('/s/example/inputs');
  await expect(page.locator('#inputs')).toContainText('8');
  await page.goto('/s/example/dictionary');
  await page.locator('[data-dict-tab="versions"]').click();
  await expect(page.locator('#dictionary')).toContainText('1.0');
  await expect(page.locator('#dictionary')).toContainText('4');

  // run 2: confirm the lesson, start round 2, run all blocks
  await page.goto('/s/example/audit');
  await expect(page.locator('#audit')).toContainText('LL-001');
  const reason = page.locator('#audit input[type="text"], #audit textarea').first();
  if (await reason.count()) await reason.fill('Đã xem kiểm soát');
  await page.locator('#safe').click();
  await page.locator('#round2').click();
  await page.goto('/s/example/line');
  for (let b = 0; b < 9; b++) await runBlock(page);

  await page.goto('/s/example/framework');
  await expect(page.locator('#frame-version')).toBeVisible();
  const options = await page.locator('#frame-version option').allTextContents();
  expect(options.join(' ')).toContain('1.0');
  expect(options.join(' ')).toContain('1.1');
  await page.locator('#frame-version').selectOption({ label: options.find((o) => o.includes('1.0'))! });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-frame').click()]);
  const json = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'));
  const text = JSON.stringify(json);
  const c04 = (json.competencies ?? json.frame?.competencies ?? []).find((c: any) => c.id === 'C04');
  expect(c04?.level, text.slice(0, 300)).toBe(3);
  await page.locator('#frame-version').selectOption({ label: options.find((o) => o.includes('1.1'))! });
  const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('#export-frame').click()]);
  const j2 = JSON.parse(await (await import('node:fs/promises')).readFile((await d2.path())!, 'utf8'));
  expect((j2.competencies ?? []).find((c: any) => c.id === 'C04')?.level).toBe(4);
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});
