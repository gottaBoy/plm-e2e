import { expect, Page, test } from '@playwright/test';

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
  const base = process.env.PLM_E2E_APP_PATH || '/';
  return `${base.replace(/\/$/, '')}${path}`;
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
