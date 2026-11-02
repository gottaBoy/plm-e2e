import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test('PLM switches Chinese and English, keeps the route and restores the selected language after reload',
  async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(String(error)));
    await gotoApp(page);
    await page.evaluate(() => localStorage.setItem('language', 'zh-CN'));
    await gotoApp(page, '/#/-/index/-/workspace_tab_exp_view/srfnav=overview/recent_tree_exp_view/-');
    await expect(page.locator('.ibiz-view--workspace_tab_exp_view')).toBeVisible();
    await expect(page.locator('#app-loading-x')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    const originalRoute = new URL(page.url()).hash;
    const switcher = page.getByRole('button', { name: 'Language / 语言', exact: true });
    await expect(switcher).toHaveCount(1);
    await switcher.click();
    await page.getByRole('menuitem', { name: 'English', exact: true }).click();
    const confirmation = page.locator('.el-message-box:visible');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    expect(new URL(page.url()).hash).toBe(originalRoute);
    await switcher.click();
    await page.getByRole('menuitem', { name: 'English', exact: true }).click();
    await expect(confirmation).toBeVisible();
    await Promise.all([
      page.waitForEvent('load'),
      confirmation.getByRole('button', { name: /确定|确认/ }).click(),
    ]);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.ibiz-view--workspace_tab_exp_view')).toBeVisible();
    await expect(page.locator('#app-loading-x')).toBeHidden();
    expect(new URL(page.url()).hash).toBe(originalRoute);
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
    await expect(page.locator('#app-loading-x')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.locator('.ibiz-view--recent_tree_exp_view')
      .getByText('Overview', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('language'))).toBe('en');
    await page.screenshot({ path: test.info().outputPath('english.png'), fullPage: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
    await switcher.click();
    await page.getByRole('menuitem', { name: '中文', exact: true }).click();
    await expect(confirmation).toBeVisible();
    await Promise.all([
      page.waitForEvent('load'),
      confirmation.getByRole('button', { name: /OK|Confirm/ }).click(),
    ]);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('tab', { name: '首页', exact: true })).toBeVisible();
    await expect(page.locator('#app-loading-x')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('language'))).toBe('zh-CN');
    expect(failures).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('chinese.png'), fullPage: true });
  });

test('password login exposes the language menu before authentication', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'en-US', storageState: { cookies: [], origins: [] },
    viewport: test.info().project.use.viewport,
    isMobile: test.info().project.use.isMobile,
    hasTouch: test.info().project.use.hasTouch,
    deviceScaleFactor: test.info().project.use.deviceScaleFactor,
  });
  try {
    const page = await context.newPage();
    const base = test.info().project.use.baseURL!;
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('#app-loading-x')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    const switcher = page.getByRole('button', { name: 'Language / 语言', exact: true });
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole('menuitem', { name: '中文', exact: true }).click();
    const confirmation = page.locator('.el-message-box:visible');
    await expect(confirmation).toBeVisible();
    await Promise.all([
      page.waitForEvent('load'),
      confirmation.getByRole('button', { name: /OK|Confirm/ }).click(),
    ]);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.locator('#app-loading-x')).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('login-language.png'), fullPage: true });
  } finally {
    await context.close();
  }
});
