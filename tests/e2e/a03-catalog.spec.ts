import { expect, test } from '@playwright/test';
import { noHorizontalOverflow } from './helpers';

test('A03 · 2D/3D cùng node/cạnh; chọn cạnh xem refs; ma trận, filter, so sánh; điện thoại không tràn ngang', async ({ page }) => {
  await page.goto('/s/example/dictionary');
  await page.locator('[data-dict-tab="network2d"]').click();
  const root2d = page.locator('[data-node-count]').first();
  await expect(root2d).toHaveAttribute('data-node-count', '36');
  await expect(root2d).toHaveAttribute('data-edge-count', '134');
  // select an edge by keyboard and read its sources + substituted formula
  const edge = page.locator('#dictionary .catalog-edge.require [data-cat-edge]').first();
  await edge.focus();
  await page.keyboard.press('Enter');
  const insp = page.locator('.catalog-inspector');
  await expect(insp).toContainText(/CAT-[A-Z]+-[A-Z]+-JD-\d+/);
  await expect(insp).toContainText('importance');

  await page.locator('[data-dict-tab="network3d"]').click();
  const root3d = page.locator('[data-node-count]').first();
  await expect(root3d).toHaveAttribute('data-node-count', '36');
  await expect(root3d).toHaveAttribute('data-edge-count', '134');
  await expect(page.locator('#dictionary canvas')).toBeVisible();

  // filter: digital product family + finance → 3 roles, same counts in both views
  await page.locator('#cat-family').selectOption('PRODUCT');
  await page.locator('#cat-industry').selectOption('FIN');
  const n3 = await page.locator('[data-node-count]').first().getAttribute('data-node-count');
  const e3 = await page.locator('[data-node-count]').first().getAttribute('data-edge-count');
  await page.locator('[data-dict-tab="network2d"]').click();
  await expect(page.locator('[data-node-count]').first()).toHaveAttribute('data-node-count', n3!);
  await expect(page.locator('[data-node-count]').first()).toHaveAttribute('data-edge-count', e3!);
  await expect(page.locator('#dictionary')).toContainText('Senior Product Owner');
  await expect(page.locator('#dictionary')).not.toContainText('Data Analyst');
  await page.locator('#cat-clear').click();

  await page.locator('[data-dict-tab="matrix"]').click();
  await expect(page.locator('#dictionary table')).toBeVisible();
  await page.locator('#dictionary table button').first().click();
  await page.locator('[data-dict-tab="compare"]').click();
  await expect(page.locator('#cat-a')).toBeVisible();
  await expect(page.locator('#dictionary')).toContainText('Jaccard');
  await expect(page.locator('#dictionary')).toContainText('33');

  await page.setViewportSize({ width: 390, height: 780 });
  for (const tab of ['network2d', 'network3d', 'matrix', 'compare', 'trace', 'versions', 'raw']) {
    await page.locator(`[data-dict-tab="${tab}"]`).click();
    await noHorizontalOverflow(page);
  }
  for (const t of ['line', 'inputs', 'framework', 'audit']) {
    await page.goto(`/s/example/${t}`);
    await expect(page.locator(`#${t}`)).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await page.goto('/s/example/line');
  await page.locator('#step').click();
  await expect(page.locator('#step-guide')).toBeVisible();
  await expect(page.locator('#guide-next')).toBeInViewport();
  await expect(page.locator('#step-guide [role="tab"][aria-selected="true"]')).toHaveCount(1);
});
