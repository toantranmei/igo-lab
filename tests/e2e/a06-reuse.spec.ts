import { expect, test } from '@playwright/test';
import { ALL, BA_A, PO_A, PO_B, apiRun, publish, seedSession } from './helpers';
import { resetDatabase } from './global-setup';

test('A06 · Lượt sau dùng từ điển đã công bố: reuse đúng một C chung, R riêng; gần nghĩa vào chờ xem xét; duyệt thấy diff và phiên bản cũ', async ({ page, request }) => {
  await resetDatabase();
  const po = await seedSession(request, 'A06 PO', 'Product Owner', [{ name: 'A', text: PO_A }, { name: 'B', text: PO_B }]);
  await apiRun(request, po, ALL);
  expect((await publish(request, po)).body.version_label).toBe('1.0');

  const ba = await seedSession(request, 'A06 BA', 'Business Analyst', [{ name: 'C', text: BA_A }]);
  await apiRun(request, ba, ALL);
  await page.goto(`/s/${ba}/audit`);
  const panel = page.getByTestId('live-release');
  await expect(panel).toContainText('DỰ KIẾN');
  await expect(panel).toContainText('nền v1.0');
  const rows = page.getByTestId('candidate-items').locator('tbody tr');
  const comp = page.getByTestId('candidate-items').locator('tbody tr:has(td:nth-child(2):text-is("Năng lực"))');
  await expect(comp.filter({ has: page.locator('td:nth-child(4) :text-is("REUSE")') })).toHaveCount(1);
  await expect(comp.filter({ has: page.locator('td:nth-child(4) :text-is("REUSE")') })).toContainText('Ưu tiên backlog');
  await expect(comp.filter({ has: page.locator('td:nth-child(4) :text-is("ADD")') })).toContainText('Phân tích quy trình');
  await expect(rows.filter({ hasText: 'CẦN XEM LẠI' })).toContainText('Viết tiêu chí nghiệm thu');
  await expect(rows.filter({ hasText: 'Khung Business Analyst' })).toContainText('ADD');
  // a decision needs a reason
  await expect(page.locator('#release-commit')).toBeDisabled();
  await page.locator('#release-reason').fill('Đã đọc hồ sơ và kiểm toán');
  await page.locator('#release-commit').click();
  await expect(panel).toContainText('ĐÃ GHI');
  await expect(page.getByTestId('receipt')).toContainText('rel_');

  const releases = await (await request.get('/api/releases')).json();
  expect(releases.map((r: any) => r.version_label)).toEqual(['1.0', '1.1']);
  const frames = await (await request.get(`/api/releases/${releases[1].release_id}/frameworks`)).json();
  expect(frames.map((f: any) => f.id).sort()).toEqual(['R-business-analyst', 'R-product-owner']);
  const comps = await (await request.get(`/api/releases/${releases[1].release_id}/competencies`)).json();
  expect(comps.filter((c: any) => c.label === 'Ưu tiên backlog')).toHaveLength(1);
  expect(comps.filter((c: any) => c.label === 'Viết tiêu chí nghiệm thu')).toHaveLength(1); // only the PO one; the BA near-match stayed out
  // diff + old version are visible
  await page.goto(`/s/${ba}/dictionary`);
  await page.locator('[data-dict-tab="versions"]').click();
  await expect(page.locator('#dictionary')).toContainText('1.0');
  await expect(page.locator('#dictionary')).toContainText('1.1');
  await expect(page.locator('#dictionary')).toContainText('tái sử dụng');
  // live catalog: both roles share the competency, same counts in 2D and 3D
  await page.locator('[data-dict-tab="network2d"]').click();
  const n = await page.locator('[data-node-count]').first().getAttribute('data-node-count');
  await page.locator('[data-dict-tab="network3d"]').click();
  await expect(page.locator('[data-node-count]').first()).toHaveAttribute('data-node-count', n!);
  expect(Number(n)).toBeGreaterThan(3);
  await page.goto(`/s/${ba}/framework`);
  await expect(page.locator('#framework')).toContainText('Business Analyst');
  await expect(page.locator('#framework')).toContainText(/chưa xác định/i);
});
