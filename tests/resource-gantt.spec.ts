import { expect, test } from '@playwright/test';
import { gotoApp, openMenu } from './helpers';

test('resource allocation loads the gantt plugin without runtime errors', async ({ page }) => {
  const failures: string[] = [];
  const pluginResponses: number[] = [];
  page.on('pageerror', error => failures.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(message.text());
  });
  page.on('response', response => {
    if (response.url().includes('resource-gantt@0.0.3-alpha.304/')) {
      pluginResponses.push(response.status());
    }
  });

  await gotoApp(page);
  await openMenu(page, '资源管理');
  await page
    .locator('.el-tree-node__content')
    .filter({ hasText: /^资源分配$/ })
    .click();

  const gantt = page.locator('.ibiz-control-resource-gantt .xg-root');
  await expect(gantt).toBeVisible();
  await expect
    .poll(() => gantt.evaluate(element => element.getBoundingClientRect().width))
    .toBeGreaterThan(100);
  await page.waitForTimeout(2_500);
  expect(pluginResponses, 'resource-gantt assets must be requested').not.toHaveLength(0);
  expect(pluginResponses.every(status => status === 200), 'resource-gantt assets must load').toBe(true);
  expect(failures, 'resource allocation must not emit browser errors').toEqual([]);
});
