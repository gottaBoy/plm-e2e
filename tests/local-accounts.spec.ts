import { expect, test } from '@playwright/test';
import { login } from './helpers';

type LocalAccount = {
  username: string;
  displayName: string;
  roles: string[];
  status: string;
  enabled: string;
};

const defaultAccounts: LocalAccount[] = [
  { username: 'aibizhi', displayName: '接口管理员', roles: ['超级管理员', '系统管理员'], status: '1', enabled: '1' },
  { username: 'demo_admin', displayName: '管理员', roles: ['超级管理员'], status: '1', enabled: '1' },
  { username: 'preview_admin', displayName: '管理员', roles: ['超级管理员'], status: '1', enabled: '1' },
];

const password = process.env.PLM_E2E_ACCOUNT_PASSWORD || '123456';
const accounts = JSON.parse(
  process.env.PLM_E2E_ACCOUNTS_JSON ||
    process.env.PLM_E2E_ACCOUNTS ||
    JSON.stringify(defaultAccounts),
) as LocalAccount[];

expect(accounts.length, 'at least one local account must be tested').toBeGreaterThan(0);
expect(
  new Set(accounts.map(account => account.username)).size,
  'account regression must not duplicate accounts',
).toBe(accounts.length);

test.beforeAll(() => {
  test.info().annotations.push({
    type: 'local-accounts',
    description: JSON.stringify(accounts),
  });
});

test('local accounts can log in and load the PLM workspace', async ({ page }) => {
  test.setTimeout(150_000);
  const screenshots = test.info().outputPath('account-screenshots');

  for (const account of accounts) {
    await page.context().clearCookies();
    await page.goto('about:blank');
    process.env.PLM_E2E_USERNAME = account.username;
    process.env.PLM_E2E_PASSWORD = password;
    await login(page);

    await expect(page).toHaveTitle(/PLM/);
    await expect(page.getByText('工作台', { exact: true }).first()).toBeVisible();
    // The mobile header intentionally clips long display names.
    const token = await page.evaluate(() => document.cookie);
    expect(token).toContain('ibzuaa-token');
    await page.screenshot({
      path: `${screenshots}/${account.username}.png`,
      fullPage: true,
    });
  }
});

test('authenticated PLM accounts can read core collections', async ({ page, request }) => {
  test.setTimeout(90_000);

  for (const account of accounts) {
    const response = await request.post(
      '/api/ibizplm__plmweb/v7/login',
      {
        data: {
          loginname: account.username,
          password,
        },
      },
    );
    expect(response.status(), `${account.username} login`).toBe(200);
    const payload = await response.json();
    const token =
      payload.token ||
      payload.access_token ||
      payload.data?.token ||
      payload.data?.access_token;
    expect(token, `${account.username} token`).toBeTruthy();
  }
});
