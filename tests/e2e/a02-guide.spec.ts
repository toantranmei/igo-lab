import { expect, test } from '@playwright/test';
import { runBlock } from './helpers';

test('A02 · Tiến 1 bước mở đúng ngăn, mặc định thủ công; bộ đếm đổi qua 2 JD; tải lại giữa block giữ cursor; tự động dừng chờ xác nhận', async ({ page }) => {
  await page.goto('/s/example/line');
  await runBlock(page); // B0
  await page.locator('#step').click();
  const dialog = page.locator('#step-guide');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#guide-title')).toContainText('B1');
  await expect(dialog).toHaveAttribute('data-mode', 'manual');
  const beat = page.getByTestId('guide-beat');
  await expect(beat).toContainText('1/');
  await page.locator('#guide-next').click(); // JD 1
  await expect(page.getByTestId('guide-substitution')).toContainText('0 + 1 = 1');
  await page.locator('#guide-next').click(); // JD 2
  await expect(page.getByTestId('guide-substitution')).toContainText('1 + 1 = 2');
  await expect(beat).toContainText('3/');
  await expect(page.getByTestId('guide-metrics')).toContainText('2');

  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(page.locator('#guide-title')).toContainText('B1');
  await expect(beat).toContainText('3/');
  await expect(dialog).toHaveAttribute('data-mode', 'manual');

  // closing keeps the block pending; the step button resumes the same block
  await page.locator('#guide-close').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-prod-select="B1"]')).toContainText('CHỜ ĐÃ HIỂU');
  await page.locator('#step').click();
  await expect(page.locator('#guide-title')).toContainText('B1');
  await expect(beat).toContainText('3/');

  // auto mode walks to the last beat and stops there; it never presses "Đã hiểu"
  await page.locator('#guide-auto').click();
  await expect(dialog).toHaveAttribute('data-mode', 'auto');
  await page.locator('#guide-speed').click();
  await expect(page.locator('#guide-understood')).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(2500);
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-prod-select="B1"]')).toContainText('CHỜ ĐÃ HIỂU');
  await page.locator('#guide-understood').click();
  await expect(page.locator('[data-prod-select="B1"]')).toContainText('ĐẠT');
});
