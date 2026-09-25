import { expect, test } from '@playwright/test';
import { appPath, authHeaders, issueCollector, openMenu } from './helpers';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', 'Known issues are currently desktop regressions');
});

test('dynamic dashboard API should return data @known-issue', async ({ page }) => {
  const request = page.request;
  const headers = await authHeaders(page);
  const response = await request.get(
    '/api/ibizplm__plmweb/dyna_dashboards/ibizplm__plmweb_dashboard_plmweb.recent_dashboard_demo_admin',
    { headers },
  );
  expect(response.status()).toBe(200);
});

test('secondary development HTML views should have an engine @known-issue', async ({ page }) => {
  const issues = issueCollector(page);
  await page.goto(appPath(), { waitUntil: 'domcontentloaded' });
  await openMenu(page, '二次开发');
  await expect(page.locator('body')).toContainText('接口说明');
  await expect(page.locator('iframe').first()).toBeVisible();
  await expect(page.locator('iframe').first().contentFrame().locator('body')).not.toBeEmpty();
  expect(
    issues.consoleErrors.some(error => error.includes('没有VIEW_HtmlView对应的引擎')),
  ).toBe(false);
});

test('first-level route transitions should not emit a Vue nextSibling error @known-issue', async ({ page }) => {
  const issues = issueCollector(page);
  await page.goto(appPath(), { waitUntil: 'domcontentloaded' });
  await openMenu(page, '产品管理');
  await openMenu(page, '项目管理');

  expect(
    [...issues.pageErrors, ...issues.consoleErrors].some(error =>
      error.includes("Cannot read properties of null (reading 'nextSibling')"),
    ),
  ).toBe(false);
});
