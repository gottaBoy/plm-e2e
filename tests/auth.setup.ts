import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { login } from './helpers';

test('authenticate local PLM', async ({ page }, testInfo) => {
  const storageState = testInfo.config.metadata.storageState;
  if (typeof storageState !== 'string' || !path.isAbsolute(storageState)) {
    throw new Error('Missing invocation-specific storageState in Playwright config metadata');
  }
  await login(page);
  await expect(page).toHaveTitle(/PLM/);
  await expect(page.getByText('工作台', { exact: true }).first()).toBeVisible();
  await mkdir(path.dirname(storageState), { recursive: true });
  await page.context().storageState({ path: storageState });
});
