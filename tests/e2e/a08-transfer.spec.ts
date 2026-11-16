import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ALL, PO_A, PO_B, apiRun, publish, seedSession } from './helpers';
import { DATA_DIR, resetDatabase } from './global-setup';

test('A08 · Export backup → nhập thử → phục hồi vào môi trường rỗng; so ID/version/hash/đồ thị; lượt mới kế thừa C; sửa một byte bị chặn', async ({ page, request }) => {
  await resetDatabase();
  const src = await seedSession(request, 'A08 nguồn', 'Product Owner', [{ name: 'A', text: PO_A }, { name: 'B', text: PO_B }]);
  await apiRun(request, src, ALL);
  const pub = await publish(request, src);
  const before = await (await request.get(`/api/sessions/${src}/state`)).json();
  const releasesBefore = await (await request.get('/api/releases')).json();

  await page.goto('/transfer');
  await expect(page.locator('#transfer')).toContainText('Mức hoàn chỉnh');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#bk-export').click()]);
  const zipPath = path.join(DATA_DIR, 'backup.zip');
  await download.saveAs(zipPath);
  await expect(page.getByTestId('transfer-note')).toContainText('.zip');

  await resetDatabase(); // environment B: empty
  expect(await (await request.get('/api/releases')).json()).toEqual([]);
  await page.goto('/transfer');
  // a one-byte change is rejected at preview
  const bytes = readFileSync(zipPath);
  const bad = Buffer.from(bytes);
  bad[Math.floor(bad.length / 2)] ^= 0xff;
  const badPath = path.join(DATA_DIR, 'backup-tampered.zip');
  writeFileSync(badPath, bad);
  await page.locator('#imp-file').setInputFiles(badPath);
  await page.locator('#imp-preview').click();
  await expect(page.getByTestId('transfer-error')).toContainText(/CHECKSUM_MISMATCH|BUNDLE_INVALID/);
  expect(await (await request.get('/api/releases')).json()).toEqual([]);

  await page.locator('#imp-file').setInputFiles(zipPath);
  await page.locator('#imp-preview').click();
  const report = page.getByTestId('import-report');
  await expect(report).toHaveAttribute('data-ok', 'true');
  await expect(report).toContainText('Có thể áp dụng');
  await expect(report).toContainText('v1.0');
  expect(await (await request.get('/api/releases')).json()).toEqual([]); // preview wrote nothing
  await page.locator('#imp-commit').click();
  await expect(page.getByTestId('transfer-note')).toContainText('v1.0');

  const releasesAfter = await (await request.get('/api/releases')).json();
  expect(releasesAfter).toEqual(releasesBefore);
  expect(releasesAfter[0].receipt_hash).toBe(pub.body.hash);
  const after = await (await request.get(`/api/sessions/${src}/state`)).json();
  expect(after.dictionary).toEqual(before.dictionary);
  expect(after.history).toEqual(before.history);
  expect((await (await request.get('/api/workspace')).json()).event_chain.ok).toBe(true);
  // the restored session opens with its graph and historical evidence
  await page.goto(`/s/${src}/dictionary`);
  await page.locator('[data-dict-tab="trace"]').click();
  await expect(page.locator('#dictionary')).toContainText('Ưu tiên backlog');
  await page.goto(`/s/${src}/line`);
  await expect(page.locator('[data-prod-select="B8"]')).toContainText('ĐẠT');

  // same bundle again: idempotent
  await page.goto('/transfer');
  await page.locator('#imp-file').setInputFiles(zipPath);
  await page.locator('#imp-mode').selectOption('REAPPLY');
  await page.locator('#imp-preview').click();
  await expect(page.getByTestId('import-report')).toContainText('0 bản ghi sẽ thêm');
  await page.locator('#imp-commit').click();
  await expect(page.getByTestId('transfer-note')).toContainText('0 bản ghi mới');

  // a new Live run in environment B inherits the restored competencies
  const next = await seedSession(request, 'A08 sau khôi phục', 'Product Owner', [{ name: 'A', text: PO_A }]);
  await apiRun(request, next, ALL.slice(0, 4));
  const b3 = await (await request.get(`/api/sessions/${next}/current/blocks/B3/detail`)).json();
  expect(b3.raw.counts).toMatchObject({ REUSE: 2, ADD: 0 });
  // framework export of the restored version
  const fw = await (await request.get(`/api/exports/framework?session=${src}&version=1.0`)).json();
  expect(fw.framework.version_label).toBe('1.0');
  expect(fw.competencies).toHaveLength(3);
});
