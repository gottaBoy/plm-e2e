import { expect, type Locator, Page, test } from '@playwright/test';

export const menus = [
  '工作台',
  '产品管理',
  '项目管理',
  '测试管理',
  '知识管理',
  '效能度量',
  '协作空间',
  '资源管理',
  '自动化',
  '智能协同',
  '应用市场',
  '二次开发',
] as const;

export type MenuName = (typeof menus)[number];

export function appPath(path = '/') {
  const configured = process.env.PLM_E2E_APP_PATH;
  const base =
    configured ||
    (() => {
      const baseUrl = process.env.PLM_E2E_BASE_URL || 'http://127.0.0.1:4173/';
      return new URL(baseUrl).pathname;
    })();
  const normalizedBase = `/${base.replace(/^\/|\/$/g, '')}`;
  const normalizedPath = path === '/' ? '' : `/${path.replace(/^\/+/, '')}`;
  return `${normalizedBase}${normalizedPath}/`.replace(/\/+/g, '/');
}

export async function gotoApp(page: Page, path = '/') {
  await page.goto(appPath(path), { waitUntil: 'domcontentloaded' });
}

export async function login(page: Page) {
  await gotoApp(page);
  await page.waitForTimeout(3_000);
  await page.locator('input').first().fill(process.env.PLM_E2E_USERNAME || 'demo_admin');
  await page
    .locator('input[type="password"]')
    .first()
    .fill(process.env.PLM_E2E_PASSWORD || '123456');
  await page.getByRole('button', { name: /登录|登陆/ }).first().click();
  await page.waitForTimeout(6_000);
}

export async function openMenu(page: Page, menu: MenuName) {
  const index = menus.indexOf(menu);
  const item = page.getByText(menu, { exact: true }).first();
  if (test.info().project.name === 'mobile') {
    const menuItem = page.locator('.el-menu-item').nth(index);
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await page.waitForTimeout(3_500);
    return;
  }

  await expect(item).toBeVisible();
  await item.click();
  await page.waitForTimeout(3_500);
}

export async function expectMainContent(page: Page) {
  await expect(page).toHaveTitle(/PLM/);
  const body = page.locator('body');
  await expect(body).toBeVisible();

  const text = (await body.innerText())
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
  expect(text.length, 'Page should render visible content').toBeGreaterThan(2);
}

export async function clickTab(tab: Locator) {
  const header = tab.locator('xpath=ancestor::div[contains(@class,"el-tabs__header")][1]');
  await header.scrollIntoViewIfNeeded({ timeout: 10_000 });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await header.locator('.el-tabs__nav').evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    }, undefined, { timeout: 10_000 });
    const target = await tab.boundingBox();
    const viewport = await header.locator('.el-tabs__nav-scroll').boundingBox();
    if (!target || !viewport || viewport.width <= 0) {
      throw new Error('Tab navigation has no usable visible viewport');
    }
    const center = target.x + target.width / 2;
    if (center >= viewport.x && center <= viewport.x + viewport.width) {
      // A visible tab can still be clipped by a pane or covered by an arrow.
      await expect.poll(() => tab.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit !== null && (hit === element || element.contains(hit));
      }), { timeout: 10_000, message: 'tab center must receive native pointer events' }).toBe(true);
      await tab.click({ timeout: 10_000 });
      return;
    }
    const direction = center < viewport.x ? 'prev' : 'next';
    const previousX = target.x;
    const arrow = header.locator(`.el-tabs__nav-${direction}`);
    await expect(arrow, 'native tab navigation arrow must be usable').toBeVisible({ timeout: 10_000 });
    await arrow.click({ timeout: 10_000 });
    await expect.poll(async () => (await tab.boundingBox())?.x).not.toBe(previousX);
  }
  throw new Error('Tab navigation arrows did not reveal the requested tab');
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'Page should not scroll horizontally').toBeLessThanOrEqual(0);
}

export function issueCollector(page: Page) {
  const issues = {
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
  };

  page.on('pageerror', error => {
    issues.pageErrors.push(String(error));
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      issues.consoleErrors.push(message.text());
    }
  });

  return issues;
}

export async function authHeaders(page: Page) {
  const cookie = await page.context().cookies();
  const token = cookie.find(item => item.name === 'ibzuaa-token')?.value || '';
  expect(token, 'PLM auth token should exist after login').toBeTruthy();
  return {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    srforgid: '000000',
    srfsystemid: 'ibizplm',
  };
}
