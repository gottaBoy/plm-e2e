import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { appPath, authHeaders, gotoApp, openMenu } from './helpers';

function collect(page: Page) {
  const evidence = {
    baseUrl: test.info().project.use.baseURL,
    distRoot: process.env.PLM_E2E_DIST_ROOT,
    fixtureAcceptance: false,
    nativeAcceptance: false,
    scope: 'real product wizard/CRUD workflows, not all-PLM acceptance',
    expectedValidationPhase: false,
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    expectedValidationErrors: [] as string[],
    requests: [] as Array<{ url: string; method: string; status: number; data: string | null }>,
    checkpoints: [] as string[],
    business: {} as Record<string, unknown>,
    cleanup: {} as Record<string, unknown>,
    evidenceCaptureErrors: [] as string[],
  };
  page.on('pageerror', error => evidence.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (evidence.expectedValidationPhase && /Runtime Error: 请检查表单填写！/.test(message.text())) {
      evidence.expectedValidationErrors.push(message.text());
    } else {
      evidence.consoleErrors.push(message.text());
    }
  });
  page.on('response', response => {
    if (/\/(?:api|plugins)\//.test(response.url())) {
      evidence.requests.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        data: response.request().postData(),
      });
    }
  });
  return evidence;
}

async function checkpoint(page: Page, evidence: ReturnType<typeof collect>, name: string) {
  evidence.checkpoints.push(name);
  const screenshot = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await test.info().attach(name, { path: screenshot, contentType: 'image/png' });
}

async function finish(page: Page, evidence: ReturnType<typeof collect>) {
  evidence.business.lastUrl = page.url();
  try {
    evidence.business.lastVisibleModals = await page.locator('.ibiz-modal:visible').allInnerTexts();
    await checkpoint(page, evidence, 'final-state');
  } catch (error) {
    // Persist earlier business/network evidence even after a test timeout closes the page.
    evidence.evidenceCaptureErrors.push(String(error));
  }
  const file = test.info().outputPath('product-workflow-evidence.json');
  await writeFile(file, JSON.stringify(evidence, null, 2));
  await test.info().attach('product-workflow-evidence', { path: file, contentType: 'application/json' });
}

function assertNoErrors(evidence: ReturnType<typeof collect>) {
  expect(evidence.pageErrors, 'uncaught errors are failures').toEqual([]);
  expect(evidence.consoleErrors, 'unexpected console errors are failures').toEqual([]);
  expect(evidence.requests.filter(response => response.status >= 400), 'browser API/plugin errors are failures').toEqual([]);
}

async function openWizard(page: Page) {
  await gotoApp(page);
  await openMenu(page, '产品管理');
  await page.locator('button[title="新建产品"]').click();
  const wizard = page.locator('.ibiz-control-wizardpanel');
  await expect(wizard.getByPlaceholder('输入产品名称')).toBeVisible();
  return wizard;
}

const footerButton = (wizard: Locator, name: RegExp) =>
  wizard.locator('.ibiz-control-wizardpanel-footer button').filter({ hasText: name });

async function fillInfo(wizard: Locator, name: string, identifier: string) {
  await wizard.getByPlaceholder('输入产品名称').fill(name);
  await wizard.getByPlaceholder('大写字母和数字，15个字符范围内').fill(identifier);
  await wizard.getByPlaceholder('输入产品描述').fill(`Real isolated regression: ${name}`);
}

async function assertNativeMemberGridUsable(wizard: Locator, expectedCount: number) {
  const rows = wizard.locator('.el-table__row');
  await expect(rows).toHaveCount(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    const row = rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const action = row.locator('button').last();
    await expect(action, `member row ${index + 1} must expose its native action`).toBeVisible();
    await expect.poll(
      () => action.evaluate(element => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === element || element.contains(hit);
      }),
      {
        message: `member row ${index + 1} action must receive native pointer events after scrolling`,
      },
    ).toBe(true);
  }
}

async function cancelWizard(page: Page) {
  await page.locator('.ibiz-modal:visible').last().locator('.el-dialog__headerbtn').click();
  await expect(page.locator('.ibiz-control-wizardpanel')).toHaveCount(0);
}

async function openMemberPicker(page: Page, wizard: Locator) {
  await footerButton(wizard, /下一步|Next/).click();
  await expect(wizard.locator('.el-table__row')).toHaveCount(1);
  await wizard.locator('button[title="添加成员"]').click();
  const picker = page.locator('.ibiz-modal:visible').last();
  await expect(picker.locator('.ibiz-checkbox-grid')).toBeVisible();
  return picker;
}

test('product wizard validates required fields and identifier, preserves input and cancels without creation', async ({ page }) => {
  const evidence = collect(page);
  try {
    const wizard = await openWizard(page);
    evidence.expectedValidationPhase = true;
    await footerButton(wizard, /下一步|Next/).click();
    await expect(wizard).toContainText('请填写产品名称');
    await expect(wizard).toContainText('请填写产品标识');
    await expect.poll(() => evidence.expectedValidationErrors.length).toBeGreaterThan(0);
    await expect(wizard.locator('.el-loading-mask:visible')).toHaveCount(0);
    await expect(page.locator('.ibiz-view--product_create_wizard_view .el-loading-mask:visible')).toHaveCount(0);
    evidence.business.requiredValidationErrors = [...evidence.expectedValidationErrors];
    await checkpoint(page, evidence, 'required-validation');
    await fillInfo(wizard, `N04-invalid-${randomUUID()}`, 'invalid');
    const requiredErrorCount = evidence.expectedValidationErrors.length;
    await footerButton(wizard, /下一步|Next/).click();
    await expect(wizard).toContainText('请填写大写字母和数字');
    // A field's blur validation may show its message before the Next handler
    // finishes. Do not change the input while that save is still validating.
    await expect.poll(() => evidence.expectedValidationErrors.length).toBeGreaterThan(requiredErrorCount);
    await expect(page.locator('.ibiz-view--product_create_wizard_view .el-loading-mask:visible')).toHaveCount(0);
    await expect(wizard.getByPlaceholder('输入产品名称')).toBeVisible();
    await checkpoint(page, evidence, 'identifier-validation');
    evidence.expectedValidationPhase = false;
    evidence.business.identifierValidationErrors = evidence.expectedValidationErrors.slice(
      (evidence.business.requiredValidationErrors as string[]).length,
    );
    expect(evidence.requests.filter(request => request.method === 'POST' && /\/products\/?$/.test(request.url))).toEqual([]);
    const validName = `N04-cancel-${randomUUID()}`;
    await fillInfo(wizard, validName, `N04${Date.now().toString().slice(-10)}`);
    await footerButton(wizard, /下一步|Next/).click();
    await expect(wizard.locator('button[title="添加成员"]')).toBeVisible();
    await footerButton(wizard, /后退|Retreat/).click();
    await expect(wizard.getByPlaceholder('输入产品名称')).toHaveValue(validName);
    await checkpoint(page, evidence, 'retreat-preserved-input');
    await cancelWizard(page);
    expect(evidence.requests.filter(request => request.method === 'POST' && /\/products\/?$/.test(request.url))).toEqual([]);
    assertNoErrors(evidence);
  } finally {
    await finish(page, evidence);
  }
});

test('product member picker renders the initially fetched real users without a second root click', async ({ page }) => {
  const evidence = collect(page);
  try {
    const wizard = await openWizard(page);
    await fillInfo(wizard, `N04-picker-${randomUUID()}`, `N04${Date.now().toString().slice(-10)}`);
    const initialUsers = page.waitForResponse(response => response.url().includes('/users/fetch_default') && response.request().method() === 'GET');
    const picker = await openMemberPicker(page, wizard);
    const response = await initialUsers;
    expect(response.status()).toBe(200);
    const users = await response.json();
    expect(users.length, 'an empty directory does not verify initial rendering').toBeGreaterThan(0);
    evidence.business.initialUsers = users.map((user: { id: string }) => user.id);
    await checkpoint(page, evidence, 'initial-user-directory');
    for (const user of users) {
      await expect(picker.locator(`.el-checkbox input[value="${user.id}"]`), 'fetched user must render without manually rebinding root').toHaveCount(1);
    }
    await picker.locator('button[title="取消"]').click();
    await cancelWizard(page);
    assertNoErrors(evidence);
  } finally {
    await finish(page, evidence);
  }
});

test('organization product wizard adds a real member, creates, edits, deletes and cleans up its own product', async ({ page, playwright }) => {
  test.setTimeout(180_000);
  const evidence = collect(page);
  const identifier = `N04${Date.now().toString().slice(-10)}`;
  const originalName = `N04-CRUD-${randomUUID()}`;
  const editedName = `${originalName}-edited`;
  const headers = await authHeaders(page);
  const api = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: headers,
    timeout: 15_000,
  });
  let productId: string | undefined;
  const list = async (dataset: string) => {
    const response = await api.post(`/api/ibizplm__plmweb/products/fetch_${dataset}`, {
      headers, data: { page: 0, size: 1000, n_identifier_eq: identifier },
    });
    expect(response.status(), `product ${dataset} dataset must load`).toBe(200);
    return response.json();
  };
  try {
    const wizard = await openWizard(page);
    await fillInfo(wizard, originalName, identifier);
    const picker = await openMemberPicker(page, wizard);
    // Selecting an organization is a real navigation workflow; the separate
    // initial-directory test must still pass without this click.
    const usersResponse = page.waitForResponse(response => response.url().includes('/users/fetch_default') && response.request().method() === 'GET');
    await picker.locator('.el-tree-node__content').filter({ hasText: /^默认单位$/ }).click();
    const directory = await usersResponse;
    expect(directory.status()).toBe(200);
    const users = await directory.json();
    const member = users.find((user: { id: string }) => user.id === 'preview_admin') || users[0];
    expect(member?.id, 'must select a real user').toBeTruthy();
    evidence.business.selectedUser = member;
    const check = picker.locator('.el-checkbox').filter({ has: page.locator(`input[value="${member.id}"]`) });
    await check.click();
    await expect(check).toHaveClass(/is-checked/);
    const selectedItem = picker.locator('.ibiz-sample-list-item').filter({ hasText: member.display_name || member.name });
    await expect(selectedItem, 'selected directory user must appear in the real sample-list').toHaveCount(1);
    await checkpoint(page, evidence, 'member-picked');
    await selectedItem.locator('.ibiz-sample-list-item__icon').click();
    await expect(check, 'removing the selected-list item must uncheck the directory user').not.toHaveClass(/is-checked/);
    await expect(selectedItem).toHaveCount(0);
    await checkpoint(page, evidence, 'member-removed-from-selection');
    await check.click();
    await expect(check).toHaveClass(/is-checked/);
    await expect(selectedItem).toHaveCount(1);
    evidence.business.pickerSelectionRemovalVerified = true;
    const all = picker.locator('.ibiz-checkbox-grid .el-checkbox').filter({ hasText: /^全选$/ });
    await all.click();
    await expect(picker.locator('.ibiz-sample-list-item')).toHaveCount(users.length);
    expect(users.length, 'persistent member regression needs multiple real users').toBeGreaterThanOrEqual(2);
    evidence.business.allDirectoryUsersSelected = true;
    for (const ref of [
      '@ibiz-template-plm/group-tree@0.0.3-alpha.252',
      '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311',
      '@ibiz-template-plugin/sample-list@0.1.3-alpha.39',
    ]) {
      expect(evidence.requests.some(request =>
        request.url.includes(`/plugins/${ref}/`) && request.status === 200),
      'product picker must load its actual plugin').toBe(true);
    }
    await picker.locator('button[title="确定"]').click();
    await expect(wizard.locator('.el-table__row')).toHaveCount(users.length);
    await assertNativeMemberGridUsable(wizard, users.length);
    await checkpoint(page, evidence, 'member-added');
    await footerButton(wizard, /后退|Retreat/).click();
    await expect(wizard.getByPlaceholder('输入产品名称')).toHaveValue(originalName);
    await footerButton(wizard, /下一步|Next/).click();
    await expect(wizard.locator('.el-table__row')).toHaveCount(users.length);
    await assertNativeMemberGridUsable(wizard, users.length);
    const creation = page.waitForResponse(response => /\/products\/?$/.test(response.url()) && response.request().method() === 'POST');
    await footerButton(wizard, /完成|Complete/).click();
    const createdResponse = await creation;
    expect(createdResponse.status()).toBe(200);
    const created = await createdResponse.json();
    productId = created.id;
    expect(productId).toBeTruthy();
    evidence.business.created = created;
    evidence.business.createPayload = createdResponse.request().postDataJSON();
    const membersResponse = await api.post(`/api/ibizplm__plmweb/products/${productId}/product_members/fetch_default`, { headers, data: { page: 0, size: 1000 } });
    expect(membersResponse.status()).toBe(200);
    const members = await membersResponse.json();
    evidence.business.persistedMembers = members;
    expect(members.some((item: { user_id: string }) => item.user_id === member.id), 'selected member ID must actually persist').toBe(true);
    expect(members).toHaveLength(users.length);
    for (const user of users) {
      expect(members.filter((item: { user_id: string }) => item.user_id === user.id),
        'each selected native user must persist exactly once').toHaveLength(1);
    }
    expect(members.filter((item: { role_id: string }) => item.role_id === 'admin'),
      'selecting the default administrator again must preserve its single admin role').toHaveLength(1);
    evidence.business.persistedMemberUniquenessAndAdminRoleVerified = true;
    expect((await list('main')).some((item: { id: string }) => item.id === productId)).toBe(true);
    await checkpoint(page, evidence, 'product-created');

    await page.goto(appPath(`/#/-/index/product=${productId}/product_index_view/srfnav=usrdrgroup1228809432/product_setting_view/srfnav=base/product_base_information_edit_view/-`), { waitUntil: 'domcontentloaded' });
    const form = page.locator('.ibiz-view--product_base_information_edit_view .ibiz-control-form');
    const nameInput = form.locator('.ibiz-form-item').filter({ hasText: '产品名称' }).locator('input').first();
    await expect(nameInput).toHaveValue(originalName);
    await expect(nameInput, 'product settings must expose an editable native input').toBeVisible();
    await expect.poll(() => nameInput.evaluate(element => element.getBoundingClientRect().width),
      { message: 'settings sidebar must not collapse the product editor' }).toBeGreaterThan(100);
    evidence.business.settingsLayout = {
      viewport: page.viewportSize(),
      input: await nameInput.boundingBox(),
      form: await form.boundingBox(),
      menu: await page.locator('.ibiz-view--product_setting_view .ibiz-panel-container--view_drbar').boundingBox(),
    };
    await checkpoint(page, evidence, 'product-settings-editable');
    await nameInput.fill(editedName);
    const updatedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/products/${productId}`) && response.request().method() === 'PUT', { timeout: 15_000 });
    await form.getByRole('button', { name: /确定|保存/ }).click();
    expect((await updatedResponse).status()).toBe(200);
    const updated = await api.get(`/api/ibizplm__plmweb/products/${productId}`, { headers });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).name).toBe(editedName);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(nameInput).toHaveValue(editedName);
    await checkpoint(page, evidence, 'product-edited-and-reloaded');

    await gotoApp(page);
    await openMenu(page, '产品管理');
    const row = page.locator('.el-table__row').filter({ hasText: editedName });
    await expect(row).toHaveCount(1);
    await row.hover();
    await row.locator('button').last().click();
    await page.locator('.el-popper:visible').getByRole('button', { name: '更多设置', exact: true }).click();
    await page.getByText('高级设置', { exact: true }).click();
    const advanced = page.locator('.ibiz-view--product_advanced_setting_edit_view');
    await expect(advanced).toBeVisible();
    await checkpoint(page, evidence, 'product-advanced-settings');
    await advanced.getByRole('button', { name: '删除产品', exact: true }).click();
    const deletion = page.waitForResponse(response => response.url().endsWith(`/products/${productId}/delete`) && response.request().method() === 'POST');
    await page.locator('.el-message-box:visible').getByRole('button', { name: /确定|OK/ }).click();
    expect((await deletion).status()).toBe(200);
    expect((await list('main')).some((item: { id: string }) => item.id === productId)).toBe(false);
    await gotoApp(page);
    await openMenu(page, '产品管理');
    await expect(row).toHaveCount(0);
    evidence.business.uiDeleted = true;
    await checkpoint(page, evidence, 'product-ui-deleted');
    assertNoErrors(evidence);
  } finally {
    try {
      const owned = [...await list('main'), ...await list('deleted')]
        .filter(item => item.identifier === identifier && [originalName, editedName].includes(item.name));
      const ids = [...new Set<string>(owned.map(item => item.id))];
      if (productId && !ids.includes(productId)) ids.push(productId);
      evidence.cleanup.ids = ids;
      const statuses = [];
      for (const id of ids) {
        const response = await api.delete(`/api/ibizplm__plmweb/products/${id}`, { headers });
        statuses.push({ id, status: response.status(), body: await response.text() });
        expect(response.status(), 'owned test products must be removed, including soft-deleted records').toBe(200);
      }
      evidence.cleanup.responses = statuses;
      const remains = [...await list('main'), ...await list('deleted')].filter(item => ids.includes(item.id));
      evidence.cleanup.remains = remains;
      expect(remains, 'test records must not remain in active or deleted products').toEqual([]);
    } finally {
      try {
        await finish(page, evidence);
      } finally {
        await api.dispose();
      }
    }
  }
});
