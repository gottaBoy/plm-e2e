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
    await expect(page.locator('.ibiz-view--recent_data_view')).toBeVisible();
    await expect(page).toHaveURL(/\/recent_data_view(?:\/|$)/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    const originalRoute = new URL(page.url()).hash;
    const switcher = page.getByRole('button', { name: 'Language / 语言', exact: true });
    await expect(switcher).toHaveCount(1);
    await expect(switcher).toHaveCSS('border-top-width', '0px');
    const triggerBounds = (await switcher.boundingBox())!;
    expect(triggerBounds.width).toBeLessThanOrEqual(112);
    expect(triggerBounds.height).toBe(32);
    await switcher.click();
    const menu = page.locator('.plm-language-menu:visible');
    await expect(menu).toBeVisible();
    const currentLanguage = menu.getByRole('menuitem', { name: '中文', exact: true });
    await expect(currentLanguage).toHaveAttribute('aria-current', 'true');
    await expect(currentLanguage).toBeEnabled();
    await expect(currentLanguage.locator('ion-icon')).toHaveCSS('visibility', 'visible');
    await expect(menu.getByRole('menuitem', { name: 'English', exact: true })
      .locator('ion-icon')).toHaveCSS('visibility', 'hidden');
    await expect(menu.locator('.el-dropdown-menu')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await currentLanguage.evaluate(element => getComputedStyle(element).color))
      .not.toBe(await menu.getByRole('menuitem', { name: 'English', exact: true })
        .evaluate(element => getComputedStyle(element).color));
    await menu.evaluate(async element => {
      await Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    const menuBounds = (await menu.boundingBox())!;
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: test.info().outputPath('language-menu.png'), fullPage: true, animations: 'disabled' });
    await currentLanguage.click();
    await expect(menu).toBeHidden();
    await expect(page.locator('.el-message-box:visible')).toHaveCount(0);
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
    const login = page.locator('.ibiz-view--apploginview');
    const panel = login.locator('.ibiz-panel-container--container1');
    const panelBounds = (await panel.boundingBox())!;
    expect(panelBounds.x).toBeGreaterThanOrEqual(0);
    expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    for (const input of await login.locator('.el-input__wrapper:visible').all()) {
      const bounds = (await input.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(panelBounds.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width);
    }
    const switcher = page.getByRole('button', { name: 'Language / 语言', exact: true });
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveCSS('border-top-width', '0px');
    expect((await switcher.boundingBox())!.width).toBeLessThanOrEqual(112);
    await switcher.click();
    await expect(page.getByRole('menuitem', { name: 'English', exact: true }))
      .toHaveAttribute('aria-current', 'true');
    await page.locator('.plm-language-menu:visible').evaluate(async element => {
      await Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    const triggerBounds = (await switcher.boundingBox())!;
    const menuBounds = (await page.locator('.plm-language-menu:visible').boundingBox())!;
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(triggerBounds.x + triggerBounds.width + 1);
    await page.screenshot({ path: test.info().outputPath('login-language-menu.png'), fullPage: true, animations: 'disabled' });
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

test('language menu supports keyboard navigation and Escape without changing language',
  async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => localStorage.setItem('language', 'zh-CN'));
    await gotoApp(page, '/#/-/index/-/workspace_tab_exp_view/srfnav=overview/recent_tree_exp_view/-');
    await expect(page.locator('#app-loading-x')).toBeHidden();
    const switcher = page.getByRole('button', { name: 'Language / 语言', exact: true });
    const menu = page.locator('.plm-language-menu:visible');
    await switcher.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menu')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: '中文', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'English', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('.el-message-box:visible')).toHaveCount(0);
    await expect(switcher).toBeFocused();
  });
