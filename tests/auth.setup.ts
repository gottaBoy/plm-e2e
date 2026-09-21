import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('authenticate local PLM', async ({ page }) => {
  await login(page);
  await expect(page).toHaveTitle(/PLM/);
  await expect(page.getByText('工作台', { exact: true }).first()).toBeVisible();
  await page.context().storageState({ path: 'playwright/.auth/user.json' });
});
