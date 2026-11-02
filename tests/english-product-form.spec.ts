import { expect, test } from '@playwright/test';
import { gotoApp, menus } from './helpers';

test('English product wizard translates field labels and commands without creating data', async ({ page }) => {
  const errors: string[] = [];
  const productCreates: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    if (request.method() === 'POST' && /\/products\/?$/.test(new URL(request.url()).pathname)) {
      productCreates.push(request.url());
    }
  });
  await gotoApp(page);
  await page.evaluate(() => localStorage.setItem('language', 'en'));
  await gotoApp(page);
  await expect(page.locator('#app-loading-x')).toBeHidden();
  if (test.info().project.name === 'mobile') {
    await page.locator('.el-menu-item').nth(menus.indexOf('产品管理')).click();
  } else {
    await page.locator('.el-menu-item').getByText('Products', { exact: true }).click();
  }
  await page.locator('button[title="New Product"]').click();
  const wizard = page.locator('.ibiz-control-wizardpanel');
  await expect(wizard.getByPlaceholder('Enter product name', { exact: true })).toBeVisible();
  await expect(wizard.getByPlaceholder('Enter product description', { exact: true })).toBeVisible();
  await expect(wizard.locator('.ibiz-form-item-container__label')
    .filter({ hasText: 'Product Identifier' })).toBeVisible();
  await expect(wizard.locator('.ibiz-control-wizardpanel-footer')
    .getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  const dialog = page.locator('.ibiz-modal:visible').last();
  await dialog.locator('.el-dialog__headerbtn').click();
  await expect(wizard).toHaveCount(0);
  expect(productCreates).toEqual([]);
  expect(errors).toEqual([]);
});
