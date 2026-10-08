import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoApp, openMenu } from './helpers';

type User = { id: string; name: string; display_name: string };

test('native member picker preserves multi-selection across filtering and discards canceled selections', async ({ page }) => {
  test.setTimeout(180_000);
  const evidence = {
    baseUrl: test.info().project.use.baseURL,
    distRoot: process.env.PLM_E2E_DIST_ROOT,
    fixtureAcceptance: false,
    nativeAcceptance: false,
    scope: 'native user picker multi-selection, filtering and cancellation; not full plugin acceptance',
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    requests: [] as Array<{ url: string; method: string; status: number; data: string | null }>,
    checkpoints: [] as string[],
    business: {} as Record<string, unknown>,
    cleanup: {} as Record<string, unknown>,
  };
  page.on('pageerror', error => evidence.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (/\/(?:api|plugins)\//.test(response.url())) {
      evidence.requests.push({
        url: response.url(), method: response.request().method(),
        status: response.status(), data: response.request().postData(),
      });
    }
  });
  const capture = async (name: string) => {
    evidence.checkpoints.push(name);
    const file = test.info().outputPath(`${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await test.info().attach(name, { path: file, contentType: 'image/png' });
  };
  const check = (picker: Locator, id: string) =>
    picker.locator('.ibiz-checkbox-grid .el-checkbox').filter({
      has: page.locator(`input[value="${id}"]`),
    });
  const all = (picker: Locator) =>
    picker.locator('.ibiz-checkbox-grid .el-checkbox').filter({ hasText: /^全选$/ });
  const usersResponse = (page: Page, name?: string) =>
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/users/fetch_default') &&
        response.request().method() === 'GET' &&
        (name === undefined || (url.searchParams.get('n_name_like') || '') === name);
    }, { timeout: 15_000 });
  const openPicker = async (wizard: Locator) => {
    const response = usersResponse(page);
    await wizard.locator('button[title="添加成员"]').click();
    const picker = page.locator('.ibiz-modal:visible').last();
    await expect(picker.locator('.ibiz-checkbox-grid')).toBeVisible();
    const loaded = await response;
    expect(loaded.status()).toBe(200);
    const users: User[] = await loaded.json();
    expect(users.length, 'multi-selection requires multiple actual users').toBeGreaterThanOrEqual(2);
    return { picker, users };
  };
  try {
    await gotoApp(page);
    await openMenu(page, '产品管理');
    await page.locator('button[title="新建产品"]').click();
    const wizard = page.locator('.ibiz-control-wizardpanel');
    await wizard.getByPlaceholder('输入产品名称').fill(`N04-selection-${randomUUID()}`);
    await wizard.getByPlaceholder('大写字母和数字，15个字符范围内')
      .fill(`N04${Date.now().toString().slice(-10)}`);
    const footer = wizard.locator('.ibiz-control-wizardpanel-footer');
    await footer.getByRole('button', { name: /下一步|Next/ }).click();
    await expect(wizard.locator('.el-table__row')).toHaveCount(1);
    const { picker, users } = await openPicker(wizard);
    evidence.business.users = users;
    await all(picker).click();
    await expect(picker.locator('.ibiz-sample-list-item')).toHaveCount(users.length);
    await expect(picker.locator('.ibiz-sample-list-item__caption'))
      .toHaveText(users.map(user => user.display_name));
    for (const user of users) await expect(check(picker, user.id)).toHaveClass(/is-checked/);
    await capture('native-select-all');

    const removed = users[0];
    const kept = users.find(user => user.id !== removed.id && !user.name.includes(removed.name));
    expect(kept, 'real login names must allow actual user filtering').toBeTruthy();
    // All-selection retains directory order; display names need not be unique.
    // The following ID checkbox assertion verifies which user was removed.
    const selected = picker.locator('.ibiz-sample-list-item').first();
    await selected.locator('.ibiz-sample-list-item__icon').click();
    await expect(check(picker, removed.id)).not.toHaveClass(/is-checked/);
    await expect(all(picker)).not.toHaveClass(/is-checked/);
    await expect(check(picker, kept!.id)).toHaveClass(/is-checked/);
    await expect(picker.locator('.ibiz-sample-list-item')).toHaveCount(users.length - 1);
    await capture('native-multi-remove');

    const search = picker.getByPlaceholder('请输入查询登录名', { exact: true });
    await expect(search).toBeVisible();
    await expect.poll(() => search.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(100);
    const filteredResponse = usersResponse(page, removed.name);
    await search.fill(removed.name);
    await search.press('Tab');
    const filtered = await filteredResponse;
    expect(filtered.status()).toBe(200);
    const filteredUsers: User[] = await filtered.json();
    expect(filteredUsers.some(user => user.id === removed.id)).toBe(true);
    expect(filteredUsers.some(user => user.id === kept!.id),
      'filter must actually hide another selected user').toBe(false);
    evidence.business.filteredUsers = filteredUsers;
    await expect(check(picker, kept!.id)).toHaveCount(0);
    await expect(picker.locator('.ibiz-sample-list-item').filter({
      has: page.getByText(kept!.display_name, { exact: true }),
    }))
      .toHaveCount(1);
    await expect(check(picker, removed.id)).not.toHaveClass(/is-checked/);
    await check(picker, removed.id).click();
    await expect(picker.locator('.ibiz-sample-list-item')).toHaveCount(users.length);
    await capture('native-selection-survives-filter');

    const resetResponse = usersResponse(page, '');
    await search.fill('');
    await search.press('Tab');
    const reset = await resetResponse;
    expect(reset.status()).toBe(200);
    expect((await reset.json()).length).toBe(users.length);
    for (const user of users) await expect(check(picker, user.id)).toHaveClass(/is-checked/);
    await expect(all(picker)).toHaveClass(/is-checked/);
    await capture('native-selection-restored-after-filter');

    await picker.locator('button[title="取消"]').click();
    await expect(page.locator('.ibiz-view--user_choose_mpick_up_view')).toHaveCount(0);
    await expect(wizard.locator('.el-table__row')).toHaveCount(1);
    const reopened = await openPicker(wizard);
    await expect(reopened.picker.locator('.ibiz-sample-list-item')).toHaveCount(0);
    for (const user of reopened.users) {
      await expect(check(reopened.picker, user.id)).not.toHaveClass(/is-checked/);
    }
    await capture('native-canceled-selection-discarded');
    await all(reopened.picker).click();
    await expect(reopened.picker.locator('.ibiz-sample-list-item')).toHaveCount(users.length);
    await reopened.picker.locator('button[title="确定"]').click();
    await expect(wizard.locator('.el-table__row'),
      'choosing the existing default member must not duplicate its native draft row')
      .toHaveCount(users.length);
    for (const name of new Set(users.map(user => user.display_name))) {
      await expect(wizard.locator('.el-table__row').filter({
        has: page.getByText(name, { exact: true }),
      }))
        .toHaveCount(users.filter(user => user.display_name === name).length);
    }
    evidence.business.defaultMemberDeduplicated = true;
    await capture('native-confirmed-multi-members');
    const repeated = await openPicker(wizard);
    await all(repeated.picker).click();
    await repeated.picker.locator('button[title="确定"]').click();
    await expect(wizard.locator('.el-table__row'),
      'repeated pickup must preserve existing members instead of creating duplicate draft rows')
      .toHaveCount(users.length);
    evidence.business.repeatedSelectionDeduplicated = true;
    await capture('native-repeated-selection-deduplicated');
    await footer.getByRole('button', { name: /后退|Retreat/ }).click();
    await footer.getByRole('button', { name: /下一步|Next/ }).click();
    await expect(wizard.locator('.el-table__row')).toHaveCount(users.length);
    await page.locator('.ibiz-modal:visible').last().locator('.el-dialog__headerbtn').click();
    await expect(wizard).toHaveCount(0);
    evidence.cleanup.wizardClosed = true;
    expect(evidence.requests.filter(request =>
      request.method === 'POST' && /\/products\/?$/.test(new URL(request.url).pathname)),
    'canceled wizard must not create any persistent product').toEqual([]);
    evidence.cleanup.persistentProductRequests = 0;
    for (const ref of [
      '@ibiz-template-plm/group-tree@0.0.3-alpha.252',
      '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311',
      '@ibiz-template-plugin/sample-list@0.1.3-alpha.39',
    ]) {
      expect(evidence.requests.some(request =>
        request.url.includes(`/plugins/${ref}/`) && request.status === 200),
      'must load the actual registered plugin').toBe(true);
    }
    expect(evidence.pageErrors).toEqual([]);
    expect(evidence.consoleErrors).toEqual([]);
    expect(evidence.requests.filter(request => request.status >= 400)).toEqual([]);
  } finally {
    const file = test.info().outputPath('member-selection-evidence.json');
    await writeFile(file, JSON.stringify(evidence, null, 2));
    await test.info().attach('member-selection-evidence', { path: file, contentType: 'application/json' });
  }
});
