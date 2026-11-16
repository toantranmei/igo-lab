import { expect, test } from '@playwright/test';
import { ALL, BA_A, PO_A, PO_B, apiRun, fakeMode, finishGuide, runBlock, seedSession } from './helpers';

test.afterEach(() => fakeMode(''));

test('A05 · Hai phiên Live khác JD chạy qua agent (CLI giả): job/attempt đọc được, trích nguyên đoạn, output khác theo dữ liệu, nhãn chưa kiểm chứng', async ({ page, request }) => {
  const s1 = await seedSession(request, 'A05 PO', 'Product Owner', [{ name: 'A', text: PO_A }, { name: 'B', text: PO_B }]);
  const s2 = await seedSession(request, 'A05 BA', 'Business Analyst', [{ name: 'C', text: BA_A }]);
  await page.goto(`/s/${s1}/line`);
  await expect(page.locator('.mode-pill')).toHaveText('LIVE');
  // opening a card of a block that has not run creates no job
  await page.locator('[data-prod-select="B3"]').click();
  await expect(page.locator('.prod-workbench')).toContainText('chưa chạy');
  expect((await (await request.get(`/api/sessions/${s1}/state`)).json()).cards.every((c: any) => c.state === 'idle')).toBe(true);
  await expect(page.locator('[data-prod-select="B1"] .cl-badge.ai')).toContainText('haiku');
  await expect(page.locator('[data-prod-select="B0"] .cl-badge.code')).toBeVisible();

  await runBlock(page); // B0, code only
  await page.locator('#step').click(); // B1 uses T1
  await expect(page.locator('#step-guide')).toBeVisible();
  await expect(page.locator('#guide-next')).toBeVisible({ timeout: 60_000 });
  await page.locator('#guide-next').click();
  await expect(page.getByTestId('guide-source')).toContainText('T1.jd_scope');
  await expect(page.getByTestId('guide-source')).toContainText('haiku');
  await expect(page.getByTestId('guide-computed-at')).toBeVisible();
  await page.locator('#guide-next').click();
  await expect(page.getByTestId('guide-substitution')).toContainText('1 + 1 = 2');
  await finishGuide(page);
  await apiRun(request, s1, ALL.slice(2));
  await apiRun(request, s2, ALL);

  const st1 = await (await request.get(`/api/sessions/${s1}/state`)).json();
  const st2 = await (await request.get(`/api/sessions/${s2}/state`)).json();
  expect(st1.position).toBe(9);
  expect(st2.position).toBe(9);
  const b3a = await (await request.get(`/api/sessions/${s1}/current/blocks/B3/detail`)).json();
  const b3b = await (await request.get(`/api/sessions/${s2}/current/blocks/B3/detail`)).json();
  expect(b3a.raw.groups.map((g: any) => g.label).sort()).not.toEqual(b3b.raw.groups.map((g: any) => g.label).sort());
  expect(b3a.raw.ai_executed).toBe(true);
  // every cited segment exists verbatim in the locked snapshot
  const texts = st1.inputs.jds.map((j: any) => j.text).join('\n');
  for (const j of st1.inputs.jds) for (const p of j.usedPassages) expect(texts).toContain(p.text);
  expect(st1.inputs.jds.flatMap((j: any) => j.usedPassages).length).toBeGreaterThan(3);
  // attempts and gate results are readable in the audit tab; the evidence level is stated honestly
  await page.goto(`/s/${s1}/audit`);
  await expect(page.locator('#audit-gates')).toContainText('Số JD hợp lệ');
  await expect(page.locator('#audit-gates')).toContainText('Không áp dụng');
  await expect(page.locator('#audit')).toContainText('JOB_RESULT');
  await page.goto(`/s/${s1}/inputs`);
  await expect(page.locator('#inputs')).toContainText('GIẢ THUYẾT');
  await page.goto(`/s/${s1}/line`);
  await expect(page.locator('main')).toContainText('chưa phải bằng chứng nghề đã kiểm chứng');
});

test('A05b · Claude CLI không dùng được → khóa chạy Live kèm hướng dẫn; agent trả sai schema → giữ bản nháp, hiện mã lỗi và Thử lại', async ({ page, request }) => {
  // a JD no earlier test has sent: identical inputs are answered from the agent_result cache and never reach the CLI
  const sid = await seedSession(request, 'A05 lỗi', 'Product Owner', [{ name: 'A', text: PO_A + `\nNV: Lập kế hoạch phát hành ${Date.now()} [k8]` }]);
  await apiRun(request, sid, ['B0']);
  fakeMode('cli_missing');
  await page.goto(`/s/${sid}/line`);
  await expect(page.locator('main .cl-warn')).toContainText('Claude CLI', { timeout: 20_000 });
  await expect(page.locator('#step')).toBeDisabled();
  const refused = await request.post(`/api/sessions/${sid}/current/blocks/B1/attempts`, { data: {}, headers: { 'Idempotency-Key': 'x-missing' } });
  expect(refused.status()).toBe(503);
  expect((await refused.json()).code).toBe('AGENT_CLI_UNAVAILABLE');
  fakeMode('');
  await expect(page.locator('#step')).toBeEnabled({ timeout: 20_000 });

  fakeMode('bad_schema');
  await page.locator('#step').click();
  await expect(page.getByTestId('guide-error')).toContainText('AGENT_SCHEMA_INVALID', { timeout: 60_000 });
  const st = await (await request.get(`/api/sessions/${sid}/state`)).json();
  expect(st.cards.find((c: any) => c.id === 'B1').state).toBe('error');
  expect(st.cards.find((c: any) => c.id === 'B0').state).toBe('pass'); // earlier draft kept
  fakeMode('');
  await page.locator('#guide-retry').click();
  await finishGuide(page);
  await expect(page.locator('[data-prod-select="B1"]')).toContainText('ĐẠT');
});
