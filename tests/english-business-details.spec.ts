import { expect, test } from '@playwright/test';
import { appPath, authHeaders, clickTab, gotoApp, menus } from './helpers';

test('English product relationship panels expose translated business commands without changing records',
  async ({ page }) => {
    const headers = await authHeaders(page);
    const response = await page.request.post('/api/ibizplm__plmweb/products/fetch_main', {
      headers, data: { page: 0, size: 100 },
    });
    expect(response.status()).toBe(200);
    const products = await response.json();
    expect(products.length).toBeGreaterThan(0);
    await gotoApp(page);
    await page.evaluate(() => localStorage.setItem('language', 'en'));
    const root = `/#/-/index/product=${encodeURIComponent(products[0].id)}/product_index_view`;
    await page.goto(appPath(`${root}/srfnav=usrdrgroup1228809432/idea_tree_exp_view/-`),
      { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app-loading-x')).toBeHidden();
    const bar = page.locator('.ibiz-view--product_index_view .ibiz-control-drbar-ex').first();
    for (const caption of ['Ideas', 'Roadmap', 'Tickets', 'Customers', 'Baselines', 'Reviews', 'Project', 'Documents']) {
      await expect(bar.getByRole('tab', { name: caption, exact: true })).toBeVisible();
    }
    for (const panel of [
      { caption: 'Tickets', view: 'ticket_all_grid_view', command: 'New Ticket' },
      { caption: 'Customers', view: 'customer_tree_exp_view', command: 'New Customer' },
      { caption: 'Baselines', view: 'baseline_product_tree_exp_view', command: 'New Baseline' },
      { caption: 'Reviews', view: 'review_idea_tree_exp_view', command: 'New Review' },
    ]) {
      await clickTab(bar.getByRole('tab', { name: panel.caption, exact: true }));
      const view = page.locator(`.ibiz-view--${panel.view}:visible`);
      await expect(view).toBeVisible();
      await expect(view.locator(`button[title="${panel.command}"]`)).toBeVisible();
      await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
    }
  });

test('worklog plugin weekdays and marketplace search follow the selected language', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => localStorage.setItem('language', 'en'));
  await gotoApp(page);
  await expect(page.locator('#app-loading-x')).toBeHidden();
  await page.locator('.el-menu-item').nth(menus.indexOf('资源管理')).click();
  const header = page.locator('.ibiz-control-grid .el-table__header-wrapper');
  await expect.poll(async () => (await header.allInnerTexts()).join(' ')).toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
  expect((await header.allInnerTexts()).join(' ')).not.toMatch(/周[一二三四五六日天]|星期/);
  await page.locator('.el-menu-item').nth(menus.indexOf('应用市场')).click();
  await expect(page.getByPlaceholder('Application Name', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('language', 'zh-CN'));
  await gotoApp(page);
  await page.locator('.el-menu-item').nth(menus.indexOf('资源管理')).click();
  await expect.poll(async () => (await header.allInnerTexts()).join(' ')).toMatch(/周[一二三四五六日天]/);
});
