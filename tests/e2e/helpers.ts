import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const CONTROL = path.resolve(__dirname, '../../.e2e-data/fake-mode');
/** Switch the fake Claude CLI's behaviour for subsequent calls ('' = normal). */
export const fakeMode = (mode: '' | 'bad_schema' | 'exit1' | 'cli_missing') => writeFileSync(CONTROL, mode);

/** Walk the open beat viewer to its last beat and acknowledge. Waits while a Live block is computing. */
export async function finishGuide(page: Page) {
  const dialog = page.locator('#step-guide');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#guide-next, #guide-understood').first()).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 120; i++) {
    if (await page.locator('#guide-understood').isVisible()) break;
    await page.locator('#guide-next').click();
  }
  await page.locator('#guide-understood').click();
  await expect(dialog).toBeHidden();
}
export async function runBlock(page: Page) {
  await expect(page.locator('#step')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#step').click();
  await finishGuide(page);
}

export const jd = (role: string, org: string, lines: string[]) => [`Mô tả công việc: ${role} — ${org}`, ...lines].join('\n');
export const PO_A = jd('Product Owner', 'Công ty A', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NV: Viết tiêu chí nghiệm thu cho hạng mục [k2]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]', 'NL: Viết tiêu chí nghiệm thu — Khả năng mô tả điều kiện hoàn thành kiểm được [k2]']);
export const PO_B = jd('Product Owner', 'Công ty B', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NV: Đo lường kết quả sau phát hành [k3]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]', 'NL: Đo lường giá trị — Khả năng chọn chỉ số và đọc kết quả sau phát hành [k3]']);
export const BA_A = jd('Business Analyst', 'Công ty C', ['NV: Sắp xếp backlog theo giá trị [k1]', 'NV: Mô hình hóa quy trình nghiệp vụ [k5]', 'NL: Ưu tiên backlog — Khả năng sắp xếp hạng mục theo giá trị kỳ vọng [k1]', 'NL: Phân tích quy trình — Khả năng mô hình hóa và cải tiến quy trình [k5]', 'NL: Viết tiêu chí nghiệm thu — Khả năng mô tả điều kiện review_test [k6]']);

/** Create a Live session with pasted JDs and a run, through the API (the UI path is covered by A04). */
export async function seedSession(request: APIRequestContext, name: string, role: string, docs: { name: string; text: string }[], events: Record<string, string>[] = []) {
  const s = await (await request.post('/api/sessions', { data: { name, role_title: role, purpose: 'Khung nháp nội bộ', context: 'Thử nghiệm' } })).json();
  const set = await request.post(`/api/sessions/${s.id}/jd-sets`, { data: { documents: docs.map((d) => ({ ...d, source_ref: `paste://${d.name}`, origin_group: `Tổ chức ${d.name}` })) } });
  expect(set.ok(), await set.text()).toBe(true);
  for (const e of events) await request.post(`/api/sessions/${s.id}/events`, { data: e });
  const run = await request.post(`/api/sessions/${s.id}/runs`, { data: { acknowledge_send: true } });
  expect(run.ok(), await run.text()).toBe(true);
  return s.id as string;
}
/** Run blocks through the API (start → wait for the worker → acknowledge). */
export async function apiRun(request: APIRequestContext, sessionId: string, blocks: string[]) {
  for (const b of blocks) {
    const start = await request.post(`/api/sessions/${sessionId}/current/blocks/${b}/attempts`, { data: {}, headers: { 'Idempotency-Key': `${sessionId}-${b}-${Date.now()}` } });
    expect(start.ok(), await start.text()).toBe(true);
    await expect.poll(async () => (await (await request.get(`/api/sessions/${sessionId}/state`)).json()).cards.find((c: any) => c.id === b).state, { timeout: 60_000 }).not.toBe('running');
    await request.post(`/api/sessions/${sessionId}/current/blocks/${b}/ack`, { data: {} });
  }
}
export const ALL = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'];
export async function publish(request: APIRequestContext, sessionId: string) {
  const c = await (await request.get(`/api/sessions/${sessionId}/candidate`)).json();
  await request.post(`/api/candidates/${c.id}/decision`, { data: { decision: 'ACCEPT', reason: 'Đã xem hồ sơ' } });
  const r = await request.post(`/api/candidates/${c.id}/commit`, { data: { expected_base_release_id: c.base_release_id } });
  return { status: r.status(), body: await r.json(), candidate: c };
}
export async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const iw = window.innerWidth;
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    };
    const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > iw + 1 && !inScroller(el)).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}#${el.id}.${String((el as HTMLElement).className?.baseVal ?? el.className).slice(0, 40)} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { sw: document.documentElement.scrollWidth, iw, wide };
  });
  expect(r.sw, `trang tràn ngang tại ${page.url()}: scrollWidth ${r.sw} > innerWidth ${r.iw}\n${r.wide.join('\n')}`).toBeLessThanOrEqual(r.iw + 1);
}
