import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appPath, authHeaders, gotoApp, openMenu } from './helpers';

type RequestEvidence = {
  url: string;
  status: number;
  method: string;
  body: string | null;
};

export function isPersistentBusinessRequest(request: Pick<RequestEvidence, 'url' | 'method'>) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith('/api/') ||
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
  if (request.method !== 'POST') return true;
  // The product action model declares this exact counter as READ.
  return !/\/fetch_[^/]+\/?$/.test(pathname) &&
    !/^\/api\/ibizplm__plmweb\/products\/[^/]+\/product_index_addon_counter\/?$/.test(pathname);
}

function monitor(page: Page) {
  const evidence = {
    baseUrl: test.info().project.use.baseURL,
    distRoot: process.env.PLM_E2E_DIST_ROOT,
    fixtureAcceptance: false,
    nativeAcceptance: false,
    scope: 'real PLM plugin interactions; not all-plugin native acceptance',
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    requests: [] as RequestEvidence[],
    checkpoints: [] as string[],
  };
  page.on('pageerror', error => evidence.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (/\/(?:api|plugins)\//.test(response.url())) {
      evidence.requests.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
        body: response.request().postData(),
      });
    }
  });
  return evidence;
}

async function saveEvidence(
  page: Page,
  evidence: ReturnType<typeof monitor>,
  label: string,
) {
  evidence.checkpoints.push(label);
  const screenshot = test.info().outputPath(`${label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await test.info().attach(label, { path: screenshot, contentType: 'image/png' });
}

async function finishEvidence(evidence: ReturnType<typeof monitor>) {
  const file = test.info().outputPath('browser-evidence.json');
  await writeFile(file, JSON.stringify(evidence, null, 2));
  await test.info().attach('browser-evidence', {
    path: file,
    contentType: 'application/json',
  });
}

function expectNoErrors(evidence: ReturnType<typeof monitor>) {
  expect(evidence.pageErrors, 'no uncaught browser errors').toEqual([]);
  expect(evidence.consoleErrors, 'no console errors').toEqual([]);
  expect(
    evidence.requests.filter(request => request.status >= 400),
    'API and plugin HTTP errors must not be hidden',
  ).toEqual([]);
}

test('isolated HTTP plugin outputs match the dist under test', async ({ request }) => {
  test.setTimeout(120_000);
  const distRoot = path.resolve(
    process.env.PLM_E2E_DIST_ROOT || path.join(__dirname, '../../plm-web/dist'),
  );
  const refs = (
    await readFile(
      path.join(__dirname, '../../plm-web/tools/plugin-recovery/runtime-plugins.txt'),
      'utf8',
    )
  )
    .split(/\r?\n/)
    .map(ref => ref.trim())
    .filter(Boolean);
  expect(refs.length).toBeGreaterThan(0);
  const sha256 = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  const files: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  for (const ref of refs) {
    const localManifest = await readFile(
      path.join(distRoot, 'plugins', ref, 'package.json'),
    );
    const manifest = JSON.parse(localManifest.toString('utf8'));
    const outputs: string[] = [
      'package.json',
      ...['main', 'module', 'system'].flatMap(field =>
        manifest[field] ? [manifest[field]] : [],
      ),
      ...(manifest.styles || []),
    ];
    for (const output of new Set(outputs)) {
      const relative = path.posix.join('plugins', ref, output);
      const local = await readFile(path.join(distRoot, relative));
      const response = await request.get(`${appPath()}${relative}`);
      const remote = await response.body();
      const entry = {
        ref,
        path: output,
        status: response.status(),
        bytes: local.length,
        localSha256: sha256(local),
        httpSha256: sha256(remote),
        contentType: response.headers()['content-type'],
      };
      files.push(entry);
      if (entry.status !== 200 || entry.localSha256 !== entry.httpSha256) {
        failures.push(entry);
      }
    }
  }
  const identityPath = test.info().outputPath('plugin-http-identity.json');
  await writeFile(
    identityPath,
    JSON.stringify(
      {
        baseUrl: test.info().project.use.baseURL,
        distRoot,
        pluginCount: refs.length,
        fileCount: files.length,
        functionalAcceptance: false,
        fixtureAcceptance: false,
        nativeAcceptance: false,
        files,
        failures,
      },
      null,
      2,
    ),
  );
  await test.info().attach('plugin-http-identity', {
    path: identityPath,
    contentType: 'application/json',
  });
  expect(failures, 'all plugin manifests and declared outputs must match dist').toEqual([]);
});

test('person select searches, selects and clears a real contextual product member', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const evidence = monitor(page);
  try {
    const headers = await authHeaders(page);
    const productsResponse = await page.request.post(
      '/api/ibizplm__plmweb/products/fetch_default',
      { headers, data: { size: 100, page: 0 } },
    );
    expect(productsResponse.status()).toBe(200);
    const products = await productsResponse.json();
    expect(Array.isArray(products), 'real products must be available').toBe(true);
    expect(products.length, 'empty data does not prove member selection').toBeGreaterThan(0);
    const productId = products[0].id;
    expect(productId).toBeTruthy();
    await page.goto(
      appPath(`/#/-/index/product=${encodeURIComponent(productId)}/ticket_allocate_person_view/-`),
      { waitUntil: 'domcontentloaded' },
    );
    const editor = page.locator('.ibiz-personel-select');
    const trigger = editor.locator('.ibiz-picker-dropdown__select-value');
    await expect(trigger).toBeVisible();
    const membersResponse = page.waitForResponse(
      response =>
        response.url().includes(`/products/${productId}/product_members/fetch_default`) &&
        response.request().method() === 'POST',
    );
    await trigger.click();
    const response = await membersResponse;
    expect(response.status(), 'product context must bind the member endpoint').toBe(200);
    expect(response.request().postDataJSON()?.page, 'initial user request must send page zero').toBe(0);
    const members = await response.json();
    expect(Array.isArray(members)).toBe(true);
    expect(members.length, 'selection needs real members, not a mock or empty list').toBeGreaterThan(0);
    const popup = page.locator('.ibiz-picker-dropdown-person-select:visible');
    const firstMember = popup.locator('.ibiz-picker-dropdown__personel-list-item').first();
    await expect(firstMember).toBeVisible();
    const selectedLabel = (await firstMember.locator('.ibiz-picker-dropdown__personel-list-text > span').first().innerText()).trim();
    expect(selectedLabel).toBeTruthy();
    await saveEvidence(page, evidence, 'person-member-list');

    const search = popup.getByPlaceholder('搜索', { exact: true });
    const searchResponse = page.waitForResponse(
      result =>
        result.url().includes(`/products/${productId}/product_members/fetch_default`) &&
        result.request().postDataJSON()?.query === selectedLabel,
    );
    await search.fill(selectedLabel);
    const searchedMembers = await searchResponse;
    expect(searchedMembers.status()).toBe(200);
    expect(searchedMembers.request().postDataJSON()?.page, 'search must reset user pagination').toBe(0);
    await expect(firstMember).toBeVisible();
    await expect(firstMember).toContainText(selectedLabel);
    await saveEvidence(page, evidence, 'person-search');
    const missingQuery = `n04-missing-member-${Date.now()}`;
    const missingResponse = page.waitForResponse(
      result =>
        result.url().includes(`/products/${productId}/product_members/fetch_default`) &&
        result.request().postDataJSON()?.query === missingQuery,
    );
    await search.fill(missingQuery);
    const missingMembers = await missingResponse;
    expect(missingMembers.status()).toBe(200);
    expect(missingMembers.request().postDataJSON()?.page).toBe(0);
    expect(await missingMembers.json(), 'the native search must actually filter members').toEqual([]);
    await expect(popup).toContainText('暂无数据');
    await saveEvidence(page, evidence, 'person-empty-search');
    const resetResponse = page.waitForResponse(
      result =>
        result.url().includes(`/products/${productId}/product_members/fetch_default`) &&
        result.request().method() === 'POST' &&
        !result.request().postDataJSON()?.query,
    );
    await search.fill('');
    const resetMembers = await resetResponse;
    expect(resetMembers.status()).toBe(200);
    expect(resetMembers.request().postDataJSON()?.page).toBe(0);
    await expect(firstMember).toContainText(selectedLabel);
    await saveEvidence(page, evidence, 'person-search-reset');
    await firstMember.click();
    await expect(editor.locator('.ibiz-picker-dropdown__select-value-text')).toHaveText(selectedLabel);
    await expect(editor.locator('.ibiz-picker-dropdown__select-value-close')).toBeVisible();
    await saveEvidence(page, evidence, 'person-selected');
    await editor.locator('.ibiz-picker-dropdown__select-value-close').click();
    await expect(editor.locator('.ibiz-picker-dropdown__select-value-close')).toHaveCount(0);
    await expect(editor.locator('.ibiz-picker-dropdown__select-value-text')).toHaveText('');
    await saveEvidence(page, evidence, 'person-cleared');

    await trigger.click();
    const departmentResponse = page.waitForResponse(
      result => result.url().includes('/users/fetch_default'),
    );
    await popup.locator('.ibiz-picker-dropdown__select-state-select-department').click();
    const department = await departmentResponse;
    expect(department.status()).toBe(200);
    expect(new URL(department.url()).searchParams.get('page'), 'department pagination starts independently').toBe('0');
    await expect(popup.locator('.ibiz-picker-dropdown__select-state-select-slider')).toHaveClass(/is-right/);
    await saveEvidence(page, evidence, 'person-department');
    const userResponse = page.waitForResponse(
      result => result.url().includes(`/products/${productId}/product_members/fetch_default`),
    );
    await popup.locator('.ibiz-picker-dropdown__select-state-select-personel').click();
    const reopenedUsers = await userResponse;
    expect(reopenedUsers.status()).toBe(200);
    expect(reopenedUsers.request().postDataJSON()?.page, 'tab reset must restart user pagination').toBe(0);
    evidence.checkpoints.push('person-request-page-contract');
    await expect(popup.locator('.ibiz-picker-dropdown__select-state-select-slider')).toHaveClass(/is-left/);
    await expect(firstMember).toBeVisible();
    const switchedDepartment = page.waitForResponse(
      result => result.url().includes('/users/fetch_default'),
    );
    const switchedUsers = page.waitForResponse(
      result => result.url().includes(`/products/${productId}/product_members/fetch_default`) &&
        result.request().method() === 'POST',
    );
    await popup.locator('.ibiz-picker-dropdown__select-state-select-department').click();
    await popup.locator('.ibiz-picker-dropdown__select-state-select-personel').click();
    expect((await switchedDepartment).status()).toBe(200);
    const switchedMembers = await switchedUsers;
    expect(switchedMembers.status()).toBe(200);
    expect(switchedMembers.request().postDataJSON()?.page).toBe(0);
    await expect(popup.locator('.ibiz-picker-dropdown__select-state-select-slider')).toHaveClass(/is-left/);
    await expect(firstMember).toContainText(selectedLabel);
    await expect(popup.locator('.ibiz-picker-dropdown__loadmore')).toHaveCount(0);
    await saveEvidence(page, evidence, 'person-rapid-tab-reset');
    expect(evidence.requests.some(request =>
      request.url.includes('/plugins/@ibiz-template-plm/person-select@0.0.3-alpha.434/') &&
      request.status === 200), 'the real person-select plugin must be loaded').toBe(true);
    expectNoErrors(evidence);
  } finally {
    await finishEvidence(evidence);
  }
});

test('resource gantt supports expand, collapse, member search and search reset', async ({
  page,
}) => {
  const evidence = monitor(page);
  try {
    await gotoApp(page);
    await openMenu(page, '资源管理');
    await page.locator('.el-tree-node__content').filter({ hasText: /^资源分配$/ }).click();
    const gantt = page.locator('.ibiz-control-resource-gantt .xg-root');
    await expect(gantt).toBeVisible();
    await page.getByRole('button', { name: '全部展开', exact: true }).click();
    await expect(page.getByRole('button', { name: '全部收起', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '全部收起', exact: true }).click();
    await expect(page.getByRole('button', { name: '全部展开', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '搜索成员', exact: true }).click();
    const search = page.getByPlaceholder('搜索成员', { exact: true });
    await expect(search).toBeVisible();
    await search.fill('runtime-no-such-member');
    await expect(search).toHaveValue('runtime-no-such-member');
    await expect(gantt).toBeVisible();
    await saveEvidence(page, evidence, 'gantt-member-search');
    await page.locator('.ibiz-resource-gantt-column-head-search__suffix').click();
    await expect(search).toHaveCount(0);
    await expect(page.getByRole('button', { name: '搜索成员', exact: true })).toBeVisible();
    await saveEvidence(page, evidence, 'gantt-reset');
    await page.getByRole('button', { name: '搜索成员', exact: true }).click();
    await expect(search, 'reopened search must agree with the cleared member filter').toHaveValue('');
    await saveEvidence(page, evidence, 'gantt-reopened-search');
    expect(evidence.requests.some(request =>
      request.url.includes('/plugins/@ibiz-template-plm/resource-gantt@0.0.3-alpha.304/') &&
      request.status === 200), 'the real resource-gantt plugin must be loaded').toBe(true);
    expectNoErrors(evidence);
  } finally {
    await finishEvidence(evidence);
  }
});

test('route picker handles empty keyboard selection and restores real product navigation', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const evidence = monitor(page);
  try {
    const headers = await authHeaders(page);
    const productsResponse = await page.request.post(
      '/api/ibizplm__plmweb/products/fetch_main',
      { headers, data: { size: 1000, page: 0 } },
    );
    expect(productsResponse.status()).toBe(200);
    const products = await productsResponse.json();
    expect(Array.isArray(products)).toBe(true);
    expect(products.length, 'navigation requires two distinct real products').toBeGreaterThanOrEqual(2);
    const [first, next] = products;
    expect(first.id).toBeTruthy();
    expect(next.id).toBeTruthy();
    expect(next.id).not.toBe(first.id);
    await page.goto(
      appPath(`/#/-/index/product=${encodeURIComponent(first.id)}/product_index_view/-`),
      { waitUntil: 'domcontentloaded' },
    );
    const picker = page.locator('.ibiz-route-picker').first();
    const trigger = picker.locator('.ibiz-route-picker__dropdown--cur-text');
    await expect(trigger).toHaveText(first.name);
    await trigger.click();
    const popup = page.locator('.ibiz-route-picker__dropdown--transfer:visible');
    const search = popup.getByPlaceholder('搜索', { exact: true });
    await expect(search).toBeVisible();
    await expect(popup.locator('.ibiz-route-picker__dropdown-item')).toHaveCount(products.length);
    await saveEvidence(page, evidence, 'route-real-products');

    const missingQuery = `N04-missing-route-${Date.now()}`;
    const emptyResponse = page.waitForResponse(response =>
      response.url().includes('/products/fetch_main') &&
      response.request().postDataJSON()?.query === missingQuery,
    );
    await search.fill(missingQuery);
    await search.press('Enter');
    const empty = await emptyResponse;
    expect(empty.status()).toBe(200);
    expect(await empty.json(), 'empty state must come from the real backend').toEqual([]);
    await expect(popup).toContainText('暂无数据');
    const originalUrl = page.url();
    await search.press('ArrowDown');
    await search.press('ArrowUp');
    await search.press('Enter');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('暂无数据');
    expect(page.url(), 'empty keyboard selection must not change product context').toBe(originalUrl);
    await saveEvidence(page, evidence, 'route-empty-keyboard');
    expectNoErrors(evidence);

    const restoredResponse = page.waitForResponse(response =>
      response.url().includes('/products/fetch_main') &&
      response.request().method() === 'POST' &&
      !response.request().postDataJSON()?.query,
    );
    await search.fill('');
    expect((await restoredResponse).status()).toBe(200);
    await expect(popup.locator('.ibiz-route-picker__dropdown-item')).toHaveCount(products.length);
    await popup.locator('.ibiz-route-picker__dropdown-item').filter({ hasText: next.name }).click();
    await expect(trigger).toHaveText(next.name);
    await expect.poll(() => decodeURIComponent(page.url())).toContain(`product=${next.id}`);
    await expect(popup).toHaveCount(0);
    await saveEvidence(page, evidence, 'route-context-switched');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(trigger).toHaveText(next.name);
    await expect.poll(() => decodeURIComponent(page.url())).toContain(`product=${next.id}`);
    await saveEvidence(page, evidence, 'route-context-reloaded');
    expect(evidence.requests.some(request =>
      request.url.includes('/plugins/@ibiz-template-plm/route-picker@0.0.3-alpha.245/') &&
      request.status === 200), 'navigation must load the actual route-picker plugin').toBe(true);
    expect(
      evidence.requests.filter(isPersistentBusinessRequest),
      'product navigation must not issue persistent business writes',
    ).toEqual([]);
    expectNoErrors(evidence);
  } finally {
    await finishEvidence(evidence);
  }
});
