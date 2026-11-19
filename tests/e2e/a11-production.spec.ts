import { expect, test } from '@playwright/test';
import { noHorizontalOverflow } from './helpers';

test('A11 · Sản xuất: tạo lô một khung gốc và phái sinh; danh mục, chất lượng từ điển, khung đến hạn rà soát', async ({ page, request }) => {
  await page.goto('/production');
  await page.locator('#pb-role').fill('Data Analyst');
  await page.locator('#pb-create').click();
  const table = page.getByTestId('production-table');
  await expect(table.locator('tbody tr')).toHaveCount(3); // root + Junior + Senior
  await expect(table).toContainText('khung gốc');
  await expect(table).toContainText('phái sinh cấp bậc');
  await expect(page.getByTestId('quality')).toBeVisible();
  await expect(page.getByTestId('reviews-due')).toBeVisible();
  const items = await (await request.get('/api/production')).json();
  expect(items.filter((x: any) => x.framework_type !== 'ROOT' && x.audit_sampled)).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 800 });
  await noHorizontalOverflow(page);
});
