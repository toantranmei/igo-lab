import { expect, test } from '@playwright/test';
import { PO_A, PO_B } from './helpers';

test('A04 · Thêm JD bằng dán và file, kiểm lỗi parse/trùng/nguồn, sửa tạo revision mới; lượt đã khóa giữ nội dung cũ', async ({ page, request }) => {
  await page.goto('/sessions');
  await page.locator('#session-new').click();
  await page.locator('#s-name').fill('A04 nhập JD');
  await page.locator('#s-purpose').fill('Khung nháp nội bộ');
  await page.locator('#s-create').click();
  await expect(page).toHaveURL(/\/s\/ses_[a-z0-9]+\/inputs/);
  const sid = page.url().match(/\/s\/([^/]+)\//)![1];
  await expect(page.getByTestId('upload-limits')).toContainText('20');
  await expect(page.getByTestId('upload-limits')).toContainText('10 MB');
  await expect(page.locator('#run-create')).toBeDisabled();

  // paste
  await page.locator('#jd-paste').fill(PO_A + '\nLiên hệ: hr@example.com');
  await page.locator('#jd-name').fill('JD công ty A');
  await page.locator('#jd-source').fill('trang tuyển dụng A');
  await page.locator('#jd-org').fill('Công ty A');
  await page.locator('#jd-preview').click();
  const drafts = page.getByTestId('jd-draft');
  await expect(drafts).toHaveCount(1);
  await expect(drafts.first()).toContainText('hr@example.com');
  // files: a good text file, an exact duplicate, an unsupported one and an empty one
  await page.locator('#jd-files').setInputFiles([
    { name: 'jd-b.txt', mimeType: 'text/plain', buffer: Buffer.from(PO_B) },
    { name: 'jd-b-copy.txt', mimeType: 'text/plain', buffer: Buffer.from(PO_B) },
    { name: 'bang-luong.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) },
    { name: 'rong.txt', mimeType: 'text/plain', buffer: Buffer.from('   ') },
  ]);
  await page.locator('#jd-preview').click();
  await expect(drafts).toHaveCount(5);
  await expect(drafts.nth(2)).toContainText('Trùng byte');
  await expect(drafts.nth(3)).toContainText('chưa được hỗ trợ');
  await expect(drafts.nth(3)).toHaveAttribute('data-ok', 'false');
  await expect(drafts.nth(4)).toContainText('rỗng');
  await expect(drafts.nth(1)).toContainText('Chưa nhập');
  await drafts.nth(2).getByRole('button', { name: 'Bỏ tài liệu' }).click();
  // remove the e-mail before confirming
  const ta = drafts.first().locator('textarea');
  await ta.fill((await ta.inputValue()).replace('\nLiên hệ: hr@example.com', ''));
  await page.locator('#jd-confirm').click();
  await expect(page.locator('#live-inputs')).toContainText('revision 1');
  await expect(page.locator('#live-inputs table').first()).toContainText('JD công ty A');
  await expect(page.locator('#live-inputs table').first()).toContainText('jd-b.txt');

  // pre-run confirmation: nothing is sent before the checkbox
  await expect(page.getByTestId('send-disclosure')).toContainText('Anthropic');
  await page.locator('#live-inputs details summary').click();
  await expect(page.getByTestId('plan-table')).toContainText('claude-opus-5-5');
  await expect(page.getByTestId('plan-table')).toContainText('claude-haiku-5-5');
  await expect(page.locator('#run-create')).toBeDisabled();
  await page.locator('#run-ack').check();
  await page.locator('#run-create').click();
  await expect(page).toHaveURL(new RegExp(`/s/${sid}/line`));
  const locked = await (await request.get(`/api/sessions/${sid}/state`)).json();
  expect(locked.inputs.label).toContain('revision 1');
  expect(locked.inputs.jds).toHaveLength(2);
  expect(locked.inputs.jds[0].text).not.toContain('hr@example.com');

  // edit the set afterwards → revision 2; the locked run still reads revision 1
  await page.goto(`/s/${sid}/inputs`);
  await page.getByLabel('Giữ jd-b.txt').uncheck();
  await page.locator('#jd-paste').fill(PO_B + '\nNV: Điều phối các bên liên quan [k4]');
  await page.locator('#jd-name').fill('JD công ty B (bản sửa)');
  await page.locator('#jd-source').fill('trang tuyển dụng B');
  await page.locator('#jd-preview').click();
  await page.locator('#jd-confirm').click();
  await expect(page.locator('#live-inputs')).toContainText('revision 2');
  const still = await (await request.get(`/api/sessions/${sid}/state`)).json();
  expect(still.inputs.label).toContain('revision 1');
  expect(still.inputs.jds.map((j: any) => j.title)).toEqual(['JD công ty A', 'jd-b.txt']);
  expect(JSON.stringify(still.inputs.jds)).not.toContain('Điều phối các bên liên quan');
  // opening a record shows its source status and deep-links by ?doc=
  await page.goto(`/s/${sid}/inputs?doc=${encodeURIComponent(still.inputs.jds[0].id)}`);
  await expect(page.locator('#input-detail')).toContainText('Nguồn truy được');
  await expect(page.locator('#input-detail')).toContainText('Sắp xếp backlog theo giá trị');
});
