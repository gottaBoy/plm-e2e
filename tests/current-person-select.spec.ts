import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertProductRuntimeUnchanged, classifyProductConsole, createProductEvidence, digest,
  loginProductSession, openProductManagement, productApi, productEntry, productJournal,
  productNotificationText, runtimeWitness, type ProductSession,
} from './current-owned-product-helper';
import {
  documentationNotificationSnapshot, pageDocumentationNotifications,
} from './current-api-documentation-notifications.mjs';
import {
  classifyPersonSelectFault, pagePersonSelectRows, personSelectEditorRequest,
  personSelectIdeaProjection, personSelectPlugin, personSelectSnapshot, readPersonSelectPrivateJson,
  samePersonSelectRequest, validatePersonSelectIdea, validatePersonSelectNotification,
} from './current-person-select-contract.mjs';

const workspace = path.resolve(__dirname, '../..');
const artifactRoot = path.join(workspace, '.artifacts');
const actorRoot = path.join(artifactRoot, 'native-actors-run-20261124-r7');
const roles = ['admin', 'ordinary', 'objectadmin', 'readonly', 'nonmember', 'crossorg'] as const;
type Role = typeof roles[number];
type Credentials = { username: string; password: string; declaredRole: string; userId?: string;
  personId?: string; productId?: string; productRole?: string; organizationId?: string };

function loadActors() {
  const fixture = readPersonSelectPrivateJson(path.join(actorRoot, 'report.private.json'));
  assert.equal(fixture.status, 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED');
  assert.equal(fixture.retainedForMatrix, true);
  assert.equal(fixture.product.createdByThisRun, true);
  const credentials: Record<Role, Credentials> = {
    admin: readPersonSelectPrivateJson(path.join(artifactRoot, 'current-business-actors-20261122-r1/credentials.private.json')),
    ordinary: readPersonSelectPrivateJson(path.join(actorRoot, 'ordinary.credentials.private.json')),
    objectadmin: readPersonSelectPrivateJson(path.join(artifactRoot, 'native-product-admin-20261124-r1/objectadmin.credentials.private.json')),
    readonly: readPersonSelectPrivateJson(path.join(actorRoot, 'readonly.credentials.private.json')),
    nonmember: readPersonSelectPrivateJson(path.join(actorRoot, 'nonmember.credentials.private.json')),
    crossorg: readPersonSelectPrivateJson(path.join(artifactRoot, 'native-crossorg-20261124-r1/crossorg.credentials.private.json')),
  };
  for (const role of roles) {
    assert.ok(credentials[role].username && credentials[role].password);
    credentials[role].declaredRole ??= credentials[role].productRole ?? role;
    if (role !== 'admin') assert.equal(credentials[role].productId, fixture.product.id);
  }
  return { credentials, productId: fixture.product.id };
}

function candidateInputs() {
  const directory = path.join(artifactRoot, 'person-select-closeout-20261128-r4');
  const reportBytes = fs.readFileSync(path.join(directory, 'report.private.json'));
  assert.equal(digest(reportBytes), 'a80541e362abf583e709df4739cd72ba019707bdde33dd1c795cb67f99745934');
  const report = JSON.parse(reportBytes.toString());
  assert.equal(report.status, 'PREPARED-REPRODUCIBLE-SINGLE-PLUGIN-DELTA-NOT-PUBLISHED');
  assert.equal(report.pluginRef, personSelectPlugin);
  assert.equal(report.first.inventory.fingerprint, report.second.inventory.fingerprint);
  assert.equal(report.payload.files, 4);
  return { directory, report, reportSha256: digest(reportBytes) };
}

function nativeRequest(session: ProductSession, evidence: any, role: string) {
  return async (method: string, suffix: string, body?: unknown) => {
    assert.ok(suffix.startsWith('/') && !suffix.includes('..'));
    const response = await session.context.request.fetch(`${new URL(productEntry).origin}${productApi}${suffix}`, {
      method, headers: await session.headers(), ...(body === undefined ? {} : { data: body }),
    });
    const raw = await response.body();
    let value: any = null;
    try { value = raw.length ? JSON.parse(raw.toString()) : null; } catch {}
    evidence.apiResponses.push({ source: 'normal-ui-issued-headers', role, method, path: `${productApi}${suffix}`,
      status: response.status(), bytes: raw.length, sha256: digest(raw) });
    return { status: response.status(), value, headers: response.headers() };
  };
}

function editorDescriptor(request: Request, productId: string) {
  return personSelectEditorRequest({ url: request.url(), method: request.method(),
    body: request.postDataJSON() }, productId, productApi);
}

function matchesEditor(request: Request, productId: string, query?: string) {
  try {
    const description = editorDescriptor(request, productId);
    return query === undefined || (description.body.query ?? '') === query;
  } catch { return false; }
}

function ideaSaveRequest(request: Request, productId: string, ideaId: string, assigneeId: string | null) {
  const url = new URL(request.url());
  if (request.method() !== 'PUT' || ![
    `${productApi}/products/${productId}/ideas/${ideaId}`, `${productApi}/ideas/${ideaId}`,
  ].includes(url.pathname)) return false;
  const body = request.postDataJSON();
  return body?.id === ideaId && body.product_id === productId && (body.assignee_id ?? null) === assigneeId;
}

async function activate(locator: Locator, touch: boolean) {
  await expect(locator).toHaveCount(1);
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  if (touch) await locator.tap();
  else await locator.click();
}

async function openNativeIdeaDirectory(session: ProductSession, product: any, language: 'zh-CN' | 'en', touch: boolean) {
  const page = session.page;
  await openProductManagement(page, language);
  const tree = page.locator('.ibiz-view--product_tree_exp_view:visible');
  await activate(tree.getByText(language === 'en' ? 'All Products' : '全部产品', { exact: true }).first(), touch);
  const products = page.locator('.ibiz-view--product_all_grid_view:visible');
  await expect(products).toBeVisible();
  const productSearch = products.locator('.ibiz-control-searchbar input').first();
  await expect(productSearch).toBeVisible();
  await productSearch.fill(product.name);
  await productSearch.press('Enter');
  const row = products.locator('.el-table__row').filter({ hasText: product.name });
  await expect(row).toHaveCount(1);
  await activate(row.getByText(product.name, { exact: true }), touch);
  const productView = page.locator('.ibiz-view--product_index_view:visible');
  await expect(productView).toBeVisible();
  const tab = productView.locator('[role="tab"][id="tab-usrdrgroup1228809432"]');
  if (await tab.getAttribute('aria-selected') !== 'true') await activate(tab, touch);
  const directory = page.locator('.ibiz-view--idea_all_grid_view:visible');
  await expect(directory).toBeVisible();
  return directory;
}

function editorOn(page: Page) {
  return page.locator('.ibiz-view--idea_main_view:visible')
    .locator('.ibiz-form-item--assignee_name .ibiz-personel-select');
}

function pickerOn(page: Page) {
  return page.locator('.ibiz-picker-dropdown-person-select:visible');
}

async function assertPickerLayout(page: Page, testName: string, evidence: any) {
  const picker = pickerOn(page);
  const box = await picker.boundingBox();
  const input = await picker.locator('input').boundingBox();
  const viewport = page.viewportSize()!;
  assert.ok(box && input);
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1
    && box.y + box.height <= viewport.height + 1, 'The native picker must fit the real viewport');
  assert.ok(input.x >= box.x && input.x + input.width <= box.x + box.width + 1);
  evidence.pickerGeometry.push({ stage: testName, viewport, picker: box, search: input });
}

test('native person selector persists a real member, recovers an exact request fault and cleans its owned idea',
  async ({ browser }, testInfo) => {
    const { credentials, productId } = loadActors();
    const candidate = candidateInputs();
    const marker = `PS-${randomUUID()}`;
    const title = `${marker} 需求🙂 e\u0301 ' " \\`;
    const language = testInfo.project.use.locale === 'en-US' ? 'en' : 'zh-CN';
    const english = language === 'en';
    const touch = Boolean(testInfo.project.use.hasTouch);
    const evidence: any = createProductEvidence(testInfo, marker, credentials.ordinary);
    Object.assign(evidence, { contract: 'current-native-person-select-v1', fullB02Acceptance: false,
      fullL02Acceptance: false, fullRoleMatrixAcceptance: false, realtimeAcceptance: false,
      candidateReportSha256: candidate.reportSha256, productId, marker, pickerGeometry: [],
      nativeMemberQueries: [], notificationSnapshots: [], refusalSnapshots: [], roleAccounts: {},
      expectedInjectedNetworkErrors: [], expectedInjectedConsoleErrors: [], faults: [] });
    const sourceFiles = [
      'plm-e2e/tests/current-person-select.spec.ts', 'plm-e2e/tests/current-person-select-contract.mjs',
      'plm-e2e/tests/current-owned-product-helper.ts', 'plm-e2e/playwright.current-person-select.config.ts',
      'plm/model/PSSYSTEM.json', 'plm/model/PSSYSAPPS/plmweb/PSAPPDEVIEWS/idea_main_view.json',
      'plm-web/plugin-src/@ibiz-template-plm/person-select/src/personel-select.tsx',
      'plm-web/plugin-src/@ibiz-template-plm/person-select/src/personel-select-controller.ts',
    ];
    evidence.nativeSource = sourceFiles.map(filename => {
      const bytes = fs.readFileSync(path.join(workspace, filename));
      const output = testInfo.outputPath('person-select-source', filename);
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
      return { path: filename, bytes: bytes.length, sha256: digest(bytes), snapshot: output };
    });
    const journal = productJournal(testInfo, evidence);
    const sessions: ProductSession[] = [];
    const byRole = new Map<Role, ProductSession>();
    const identities = new Map<Role, any>();
    const requests = new Map<Role, ReturnType<typeof nativeRequest>>();
    const notificationBaselines = new Map<Role, any[]>();
    const scope: any = { marker, title, productId, actorIds: [], startedAt: new Date().toISOString() };
    let original: any;
    let retainedProduct: any;
    let retainedMembers: string | undefined;
    let changedAssignee = false;
    let primaryFailure: unknown;
    const receiverRows = async (role: Role) => pageDocumentationNotifications(requests.get(role)!, identities.get(role));
    const snapshotEffects = async () => {
      const versions = await pagePersonSelectRows(requests.get('admin')!, '/versions/fetch_default',
        { n_owner_id_eq: scope.ideaId });
      assert.ok(versions.every((row: any) => row.owner_id === scope.ideaId));
      const actors = [];
      for (const role of roles) {
        const recent = await pagePersonSelectRows(requests.get(role)!, '/recents/fetch_default',
          { n_owner_id_eq: scope.ideaId });
        assert.ok(recent.every((row: any) => row.owner_id === scope.ideaId));
        actors.push({ role, recent: personSelectSnapshot(recent),
          messages: documentationNotificationSnapshot(await receiverRows(role)) });
      }
      return { versions: personSelectSnapshot(versions), actors,
        physicalDatabaseTotalsClaimed: false, source: 'paginated-native-role-visible-readback' };
    };
    try {
      for (const role of roles) {
        const session = await loginProductSession(browser, credentials[role], evidence, language, testInfo,
          { businessEventMode: 'observe' });
        sessions.push(session);
        byRole.set(role, session);
        identities.set(role, await session.identity());
        requests.set(role, nativeRequest(session, evidence, role));
        evidence.roleAccounts[role] = { usernameSha256: digest(credentials[role].username),
          nativeIdentity: identities.get(role), normalUiLogin: true, tokenInjected: false };
        notificationBaselines.set(role, await receiverRows(role));
        assert.ok(!notificationBaselines.get(role)!.some(row => typeof row.content === 'string' && row.content.includes(marker)));
      }
      const ordinary = byRole.get('ordinary')!;
      scope.actorIds = [identities.get('ordinary').srfuserid, identities.get('ordinary').srfpersonid].filter(Boolean);
      const productResponse = await requests.get('ordinary')!('GET', `/products/${productId}`);
      assert.equal(productResponse.status, 200);
      assert.equal(productResponse.value.id, productId);
      retainedProduct = Object.fromEntries(['id', 'name', 'identifier', 'visibility', 'is_deleted', 'is_archived']
        .map(key => [key, productResponse.value[key] ?? null]));
      const members = await pagePersonSelectRows(requests.get('admin')!,
        `/products/${productId}/product_members/fetch_default`);
      assert.ok(members.length >= 3);
      retainedMembers = personSelectSnapshot([...members].sort((left: any, right: any) => left.id.localeCompare(right.id)));
      for (const [role, expected] of [['ordinary', 'user'], ['readonly', 'reader'], ['objectadmin', 'admin']] as const) {
        const member = members.find((row: any) => row.user_id === credentials[role].userId);
        assert.ok(member && member.product_id === productId);
        assert.equal(member.role_id, expected);
      }
      for (const role of ['nonmember', 'crossorg'] as const) {
        assert.ok(!members.some((row: any) => row.user_id === credentials[role].userId));
      }
      evidence.stages.nativeMembership = { status: 'PASS', count: members.length, sixActualRolesBound: true };
      for (const entry of candidate.report.payload.entries) {
        const response = await ordinary.context.request.get(new URL(entry.path, productEntry).href);
        const bytes = await response.body();
        assert.equal(response.status(), 200);
        assert.equal(bytes.length, entry.bytes);
        assert.equal(digest(bytes), entry.sha256, 'The existing server must already serve the reviewed candidate');
        evidence.resourceBindings.push({ source: 'preflight-http-readback-before-business-create',
          path: new URL(response.url()).pathname, bytes: bytes.length, sha256: digest(bytes) });
      }
      const page = ordinary.page;
      const directory = await openNativeIdeaDirectory(ordinary, productResponse.value, language, touch);
      await activate(directory.getByRole('button', { name: english ? 'New Idea' : '新建需求', exact: true }), touch);
      const createView = page.locator('.ibiz-view--idea_quick_create_view:visible');
      await expect(createView).toBeVisible();
      await createView.locator('.ibiz-form-item--title textarea').fill(title);
      const created = page.waitForResponse(response => {
        const request = response.request();
        if (request.method() !== 'POST' || ![
          `${productApi}/products/${productId}/ideas`, `${productApi}/ideas`,
        ].includes(new URL(response.url()).pathname)) return false;
        const body = request.postDataJSON();
        return body?.title === title && body.product_id === productId;
      });
      journal('before-native-owned-idea-create');
      await activate(createView.getByRole('button', { name: /^(?:确定|保存|OK|Save|Confirm)$/ }).last(), touch);
      const createdResponse = await created;
      assert.equal(createdResponse.status(), 200);
      original = await createdResponse.json();
      assert.ok(typeof original.identifier === 'string' && original.identifier);
      scope.ideaId = original.id;
      scope.showIdentifier = original.show_identifier ?? original.identifier;
      validatePersonSelectIdea(original, scope);
      evidence.stages.create = { status: 'PASS', source: 'normal-native-ui', ideaId: scope.ideaId,
        titleSha256: digest(title), originalAssigneeId: original.assignee_id ?? null };
      journal('native-owned-idea-created');
      await expect(createView).toHaveCount(0);
      const search = directory.locator('.ibiz-control-searchbar input').first();
      await expect(search).toBeVisible();
      await search.fill(marker);
      await search.press('Enter');
      const row = directory.locator('.el-table__row').filter({ hasText: title });
      await expect(row).toHaveCount(1);
      await activate(row.getByText(original.identifier, { exact: true }), touch);
      await expect(page.locator('.ibiz-view--idea_main_view:visible')).toBeVisible();
      await expect(editorOn(page)).toBeVisible();
      const actualDeepLink = page.url();
      assert.ok(decodeURIComponent(actualDeepLink).includes(scope.ideaId)
        && actualDeepLink.includes('idea_main_view'), 'A replayable native detail route must come from visible navigation');
      evidence.stages.nativeNavigation = { status: 'PASS', route: actualDeepLink, guessedRoute: false };
      await page.waitForLoadState('networkidle');
      await ordinary.quiet();
      const firstQuery = page.waitForResponse(response => matchesEditor(response.request(), productId));
      await activate(editorOn(page).locator('.ibiz-picker-dropdown__select-value'), touch);
      const first = await firstQuery;
      assert.equal(first.status(), 200);
      const firstRows = await first.json();
      assert.ok(Array.isArray(firstRows) && firstRows.length > 0);
      const target = firstRows.find((member: any) => member.user_id !== (original.assignee_id ?? null)
        && roles.some(role => credentials[role].userId === member.user_id)
        && firstRows.filter((item: any) => item.name === member.name).length === 1);
      assert.ok(target?.user_id && target.name, 'Another real visible configured member is required');
      assert.ok(members.some((member: any) => member.user_id === target.user_id && member.name === target.name));
      await assertPickerLayout(page, 'initial-nonempty', evidence);
      const searchMember = pickerOn(page).getByPlaceholder(english ? 'Search' : '搜索', { exact: true });
      const observedSearch = page.waitForResponse(response => matchesEditor(response.request(), productId, target.name));
      await searchMember.fill(target.name);
      const targetSearch = await observedSearch;
      assert.equal(targetSearch.status(), 200);
      const searchRows = await targetSearch.json();
      assert.ok(searchRows.some((member: any) => member.user_id === target.user_id));
      const successfulDescriptor = editorDescriptor(targetSearch.request(), productId);
      evidence.nativeMemberQueries.push({ source: 'real-browser-response', request: successfulDescriptor,
        rows: searchRows.length, responseSha256: digest(await targetSearch.body()) });
      const unicodeQuery = `${marker} 空🙂 e\u0301 ' " \\`;
      const emptyResponse = page.waitForResponse(response => matchesEditor(response.request(), productId, unicodeQuery));
      await searchMember.fill(unicodeQuery);
      const empty = await emptyResponse;
      assert.equal(empty.status(), 200);
      assert.deepEqual(await empty.json(), []);
      await expect(pickerOn(page)).toContainText(english ? 'No Data' : '暂无数据');
      assert.equal(editorDescriptor(empty.request(), productId).body.query, unicodeQuery);
      evidence.stages.realSearch = { status: 'PASS', initialRows: firstRows.length,
        searchRows: searchRows.length, exactUnicodeQuery: unicodeQuery, genuineEmptyRows: 0 };

      const fault: any = { observedBeforeAbort: successfulDescriptor, abortedCount: 0,
        failureEvents: [], consoleEvents: [], faultOnlyNetworkAbort: true, fabricatedSuccessRows: false };
      let abortedRequest: Request | undefined;
      const failedListener = (request: Request) => {
        if (request !== abortedRequest) return;
        const rawIndex = evidence.failedRequests.length - 1;
        fault.failureEvents.push({ rawIndex, requestIsExactAbortedObject: true });
      };
      const consoleListener = (message: any) => {
        if (!abortedRequest || message.type() !== 'error' ||
            message.text() !== 'Failed to load resource: net::ERR_FAILED' ||
            message.location().url !== abortedRequest.url()) return;
        fault.consoleEvents.push({ rawIndex: evidence.consoleErrors.length - 1,
          exactAbortedUrl: abortedRequest.url() });
      };
      page.on('requestfailed', failedListener);
      page.on('console', consoleListener);
      await page.route(successfulDescriptor.url, async route => {
        const description = editorDescriptor(route.request(), productId);
        if (fault.abortedCount === 0 && samePersonSelectRequest(description, successfulDescriptor)) {
          abortedRequest = route.request();
          fault.injectedRequest = description;
          fault.abortedCount += 1;
          await route.abort('failed');
        } else await route.continue();
      });
      try {
        await searchMember.fill(target.name);
        await expect(pickerOn(page).getByRole('alert')).toHaveText(english ? 'Failed to load' : '加载失败');
        assert.equal(fault.abortedCount, 1);
        await assertPickerLayout(page, 'injected-failure', evidence);
        const alertBox = await pickerOn(page).getByRole('alert').boundingBox();
        const retryBox = await pickerOn(page).getByRole('button', {
          name: english ? 'Retry' : '重试', exact: true,
        }).boundingBox();
        assert.ok(alertBox && retryBox);
        assert.ok(alertBox.x + alertBox.width <= retryBox.x + 1
          || retryBox.x + retryBox.width <= alertBox.x + 1
          || alertBox.y + alertBox.height <= retryBox.y + 1
          || retryBox.y + retryBox.height <= alertBox.y + 1, 'Failure text and retry must not overlap');
        await page.screenshot({ path: testInfo.outputPath('person-select-native-injected-failure.png'), fullPage: true });
        await page.unroute(successfulDescriptor.url);
        const retryResponse = page.waitForResponse(response =>
          matchesEditor(response.request(), productId, target.name));
        await activate(pickerOn(page).getByRole('button', { name: english ? 'Retry' : '重试', exact: true }), touch);
        const retry = await retryResponse;
        assert.equal(retry.status(), 200);
        fault.recoveredRequest = editorDescriptor(retry.request(), productId);
        assert.equal(samePersonSelectRequest(fault.injectedRequest, fault.recoveredRequest), true);
        const recoveredRows = await retry.json();
        assert.ok(recoveredRows.some((member: any) => member.user_id === target.user_id));
        fault.recoveredRows = recoveredRows.length;
        await ordinary.quiet();
        classifyPersonSelectFault(evidence.failedRequests, evidence.consoleErrors, fault);
      } finally {
        await page.unroute(successfulDescriptor.url);
        page.off('requestfailed', failedListener);
        page.off('console', consoleListener);
        evidence.faults.push(fault);
      }
      await assertPickerLayout(page, 'recovered-nonempty', evidence);
      const saved = page.waitForResponse(response =>
        ideaSaveRequest(response.request(), productId, scope.ideaId, target.user_id));
      changedAssignee = true;
      await activate(pickerOn(page).locator('.ibiz-picker-dropdown__personel-list-item')
        .filter({ has: page.getByText(target.name, { exact: true }) }), touch);
      assert.equal((await saved).status(), 200);
      const persisted = await requests.get('ordinary')!('GET', `/products/${productId}/ideas/${scope.ideaId}`);
      assert.equal(persisted.status, 200);
      validatePersonSelectIdea(persisted.value, scope);
      assert.equal(persisted.value.assignee_id, target.user_id);
      assert.equal(persisted.value.assignee_name, target.name);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(editorOn(page)).toContainText(target.name);
      evidence.stages.nativePersistence = { status: 'PASS', source: 'visible-member-click-and-native-autosave',
        assigneeId: target.user_id, assigneeName: target.name, reloadReadback: true };
      const fresh = await loginProductSession(browser, credentials.ordinary, evidence, language, testInfo,
        { businessEventMode: 'observe' });
      sessions.push(fresh);
      await fresh.page.goto(actualDeepLink, { waitUntil: 'domcontentloaded' });
      await expect(editorOn(fresh.page)).toContainText(target.name);
      const freshRead = await nativeRequest(fresh, evidence, 'ordinary-fresh')('GET',
        `/products/${productId}/ideas/${scope.ideaId}`);
      assert.equal(freshRead.status, 200);
      assert.equal(freshRead.value.assignee_id, target.user_id);
      assert.equal(freshRead.value.assignee_name, target.name);
      evidence.stages.freshReadback = { status: 'PASS', normalUiLogin: true, exactIdAndName: true };
      await activate(page.getByRole('button', { name: 'Language / 语言', exact: true }), touch);
      await activate(page.locator('.plm-language-menu:visible').getByRole('menuitem', {
        name: english ? '中文' : 'English', exact: true,
      }), touch);
      const confirmation = page.locator('.el-message-box:visible');
      await expect(confirmation).toBeVisible();
      await Promise.all([
        page.waitForEvent('load'),
        activate(confirmation.getByRole('button', { name: english ? /^(?:OK|Confirm)$/ : /^(?:确定|确认)$/ }), touch),
      ]);
      await expect(page.locator('html')).toHaveAttribute('lang', english ? 'zh-CN' : 'en');
      await expect(editorOn(page)).toContainText(target.name);
      assert.equal(page.url(), actualDeepLink);
      const switched = await requests.get('ordinary')!('GET', `/products/${productId}/ideas/${scope.ideaId}`);
      assert.equal(switched.value.assignee_id, target.user_id);
      evidence.stages.languageSwitch = { status: 'PASS', visibleMenu: true, routePreserved: true, storedIdUnchanged: true };
      for (const suffix of ['index.legacy.js', 'style.css']) {
        const expectedFile = candidate.report.first.inventory.entries.find((entry: any) => entry.path === suffix);
        const binding = evidence.resourceBindings.find((entry: any) =>
          entry.source !== 'preflight-http-readback-before-business-create'
          && decodeURIComponent(entry.path).endsWith(`/plugins/${personSelectPlugin}/dist/${suffix}`)
          && entry.sha256 === expectedFile.sha256);
        assert.ok(binding, 'The actual browser must load the reviewed plugin runtime and CSS');
      }
      evidence.stages.browserPluginBinding = { status: 'PASS', actualBrowserLegacyAndCss: true,
        preflightFourFileReadback: true };
      const targetRole = roles.find(role => credentials[role].userId === target.user_id)!;
      await expect.poll(async () => (await receiverRows(targetRole)).filter((item: any) =>
        item.message_type === 'idea_assignee' && item.content?.includes(marker)).length,
      { message: 'The actual assignee receiver should read its own idea notification' }).toBeGreaterThan(0);
      for (const role of ['readonly', 'nonmember', 'crossorg'] as const) {
        const baseline = await snapshotEffects();
        const before = await requests.get('ordinary')!('GET', `/products/${productId}/ideas/${scope.ideaId}`);
        const denied = await requests.get(role)!('PUT', `/products/${productId}/ideas/${scope.ideaId}`,
          { id: scope.ideaId, product_id: productId, assignee_id: original.assignee_id ?? null,
            assignee_name: original.assignee_name ?? null });
        assert.ok([403, 404].includes(denied.status));
        const after = await requests.get('ordinary')!('GET', `/products/${productId}/ideas/${scope.ideaId}`);
        assert.deepEqual(personSelectIdeaProjection(after.value), personSelectIdeaProjection(before.value));
        const effects = await snapshotEffects();
        assert.deepEqual(effects, baseline, 'Denied writes must not alter visible versions, recents or receiver messages');
        evidence.refusalSnapshots.push({ role, status: denied.status, businessProjectionUnchanged: true,
          before: baseline, after: effects, physicalDatabaseTotalsClaimed: false });
      }
      evidence.stages.refusals = { status: 'PASS', roles: ['readonly', 'nonmember', 'crossorg'],
        nativePaginatedEffectsUnchanged: true, physicalDatabaseTotalsClaimed: false };
      await page.screenshot({ path: testInfo.outputPath('person-select-native-readback.png'), fullPage: true });
      evidence.stages.nativeScenario = { status: 'PASS', cell: testInfo.project.name };
    } catch (error) {
      primaryFailure = error;
      evidence.stages.failure = (error as Error).message;
      journal('native-person-select-failed-before-finally-cleanup');
    } finally {
      const ordinary = requests.get('ordinary');
      const admin = requests.get('admin');
      let notificationCleanupFailure: unknown;
      try {
        for (const session of sessions) {
          try { await session.quiet(); }
          catch (error) { evidence.captureErrors.push((error as Error).message); primaryFailure ??= error; }
          for (const page of session.context.pages()) {
            try { await page.close(); }
            catch (error) { evidence.captureErrors.push((error as Error).message); primaryFailure ??= error; }
          }
        }
        if (ordinary && admin) {
          const groups = await Promise.all(['normal', 'archived', 'deleted'].map(dataset =>
            pagePersonSelectRows(admin, `/products/${productId}/ideas/fetch_${dataset}`, { n_title_like: marker })));
          const own = [...new Map(groups.flat().filter((row: any) => row.title?.includes(marker))
            .map((row: any) => [row.id, row])).values()] as any[];
          assert.ok(own.length <= 1);
          if (own.length) {
            validatePersonSelectIdea(own[0], scope);
            scope.ideaId ??= own[0].id;
            scope.showIdentifier ??= own[0].show_identifier ?? own[0].identifier;
            if (changedAssignee && original) {
              try {
                const restored = await ordinary('PUT', `/products/${productId}/ideas/${scope.ideaId}`, {
                  id: scope.ideaId, product_id: productId, assignee_id: original.assignee_id ?? null,
                  assignee_name: original.assignee_name ?? null,
                });
                assert.equal(restored.status, 200);
                const read = await ordinary('GET', `/products/${productId}/ideas/${scope.ideaId}`);
                assert.equal(read.status, 200);
                validatePersonSelectIdea(read.value, scope);
                assert.equal(read.value.assignee_id ?? null, original.assignee_id ?? null);
                assert.equal(read.value.assignee_name ?? null, original.assignee_name ?? null);
                evidence.stages.restoreBeforeRemove = { status: 'PASS', exactOriginalId: true,
                  source: 'declared-native-cleanup-api-after-pages-closed' };
              } catch (error) {
                evidence.stages.restoreBeforeRemove = { status: 'FAILED', error: (error as Error).message };
                primaryFailure ??= error;
              }
            }
            const current = await admin('GET', `/products/${productId}/ideas/${scope.ideaId}`);
            assert.equal(current.status, 200);
            validatePersonSelectIdea(current.value, scope);
            journal('before-exact-owned-idea-remove');
            assert.equal((await admin('DELETE', `/products/${productId}/ideas/${scope.ideaId}`)).status, 200);
          } else assert.equal(scope.ideaId, undefined, 'A recorded idea must be located before exact cleanup');
          if (scope.ideaId) {
            const absent = await admin('GET', `/products/${productId}/ideas/${scope.ideaId}`);
            assert.equal(absent.status, 404);
          }
          const templates = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(workspace,
            'plm/model/PSSYSTEM.json'), 'utf8')).getAllPSSysMsgTempls
            .filter((row: any) => ['idea_assignee', 'idea_assignee_onchange', 'idea_assignee_cancel'].includes(row.codeName))
            .map((row: any) => [row.codeName, { ...row, expectedEvent: productNotificationText(row.content).event }]));
          for (let round = 0; round < 3; round += 1) {
            for (const role of roles) {
              if (!requests.has(role) || !notificationBaselines.has(role)) continue;
              try {
                const before = notificationBaselines.get(role)!;
                const originalIds = new Set(before.map(row => row.id));
                const rows = await receiverRows(role);
                const owned = rows.filter((row: any) => row.content?.includes(marker));
                const unrelated = rows.filter((row: any) => !owned.includes(row));
                assert.deepEqual(documentationNotificationSnapshot(unrelated.filter(row => originalIds.has(row.id))),
                  documentationNotificationSnapshot(before));
                for (const row of owned) {
                  assert.ok(!originalIds.has(row.id));
                  validatePersonSelectNotification(row, scope, identities.get(role), templates, productNotificationText(row.content));
                  const current = await requests.get(role)!('GET', `/extension/internal_messages/${row.id}`);
                  assert.equal(current.status, 200);
                  assert.deepEqual(documentationNotificationSnapshot([current.value]), documentationNotificationSnapshot([row]));
                  validatePersonSelectNotification(current.value, scope, identities.get(role), templates,
                    productNotificationText(current.value.content));
                }
                journal('before-exact-owned-idea-notification-remove');
                for (const row of owned) {
                  assert.equal((await requests.get(role)!('DELETE', `/extension/internal_messages/${row.id}`)).status, 200);
                  assert.equal((await requests.get(role)!('GET', `/extension/internal_messages/${row.id}`)).status, 404);
                }
                const after = await receiverRows(role);
                assert.ok(after.every((row: any) => !row.content?.includes(marker)));
                assert.deepEqual(documentationNotificationSnapshot(after.filter(row => unrelated.some(item => item.id === row.id))),
                  documentationNotificationSnapshot(unrelated));
                evidence.notificationSnapshots.push({ role, round, before: documentationNotificationSnapshot(before),
                  removed: documentationNotificationSnapshot(owned), after: documentationNotificationSnapshot(after),
                  exactKeyedAbsence: true, unrelatedRowsPreserved: true, sendAuditDeleted: false });
              } catch (error) {
                notificationCleanupFailure ??= error;
                primaryFailure ??= error;
                evidence.notificationSnapshots.push({ role, round, status: 'FAILED', error: (error as Error).message });
              }
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          for (const role of roles) {
            if (requests.has(role)) assert.ok((await receiverRows(role)).every((row: any) => !row.content?.includes(marker)),
              'No delayed owned message may remain after bounded cleanup observations');
          }
          const remains = (await Promise.all(['normal', 'archived', 'deleted'].map(dataset =>
            pagePersonSelectRows(admin, `/products/${productId}/ideas/fetch_${dataset}`, { n_title_like: marker }))))
            .flat().filter((row: any) => row.id === scope.ideaId || row.title?.includes(marker));
          assert.deepEqual(remains, []);
          if (retainedProduct) {
            const productAfter = await admin('GET', `/products/${productId}`);
            assert.equal(productAfter.status, 200);
            assert.deepEqual(Object.fromEntries(Object.keys(retainedProduct)
              .map(key => [key, productAfter.value[key] ?? null])), retainedProduct);
            const membersAfter = await pagePersonSelectRows(admin, `/products/${productId}/product_members/fetch_default`);
            assert.equal(personSelectSnapshot([...membersAfter].sort((left: any, right: any) =>
              left.id.localeCompare(right.id))), retainedMembers);
          }
          if (notificationCleanupFailure) throw notificationCleanupFailure;
          evidence.cleanup = { status: 'PASS', ideaId: scope.ideaId ?? null, createdIdeaRowsRemoved: own.length,
            normalArchivedDeletedMarkerRows: 0, exactKeyed404: Boolean(scope.ideaId),
            restoredBeforeRemove: changedAssignee ? evidence.stages.restoreBeforeRemove?.status === 'PASS' : null,
            unrelatedNotificationRowsPreserved: true, retainedProductPreserved: true,
            source: 'finally-exact-owned-native-cleanup', physicalDatabaseTotalsClaimed: false };
        } else evidence.cleanup = { status: 'NO-CREATE-ATTEMPT', ownBusinessWrites: false };
      } catch (error) {
        evidence.cleanup = { status: 'FAILED', ideaId: scope.ideaId ?? null, error: (error as Error).message };
        primaryFailure ??= error;
      }
      for (const session of sessions.reverse()) await session.close();
      try {
        evidence.runtimeAfter = runtimeWitness();
        evidence.runtimeComparison = assertProductRuntimeUnchanged(evidence.runtimeBefore, evidence.runtimeAfter);
      } catch (error) { evidence.captureErrors.push((error as Error).message); primaryFailure ??= error; }
      try {
        evidence.stages.nativeSourceUnchanged = { status: evidence.nativeSource.every((entry: any) =>
          digest(fs.readFileSync(path.join(workspace, entry.path))) === entry.sha256) ? 'PASS' : 'FAILED' };
        if (evidence.stages.nativeSourceUnchanged.status !== 'PASS') {
          primaryFailure ??= new Error('A bound native scenario source changed during execution');
        }
      } catch (error) {
        evidence.stages.nativeSourceUnchanged = { status: 'FAILED', error: (error as Error).message };
        primaryFailure ??= error;
      }
      const preAuth = classifyProductConsole(evidence);
      evidence.expectedPreAuthConsoleErrors = preAuth.expected;
      let raw: any = { expectedFailed: [], expectedConsole: [], unexpectedFailed: evidence.failedRequests,
        unexpectedConsole: preAuth.unexpected };
      try {
        const fault = evidence.faults[0];
        raw = classifyPersonSelectFault(evidence.failedRequests, evidence.consoleErrors, fault);
        raw.unexpectedConsole = raw.unexpectedConsole.filter((row: any) => !preAuth.expected.includes(row));
      } catch (error) { evidence.captureErrors.push((error as Error).message); primaryFailure ??= error; }
      evidence.expectedInjectedNetworkErrors = raw.expectedFailed;
      evidence.expectedInjectedConsoleErrors = raw.expectedConsole;
      evidence.unexpectedConsoleErrors = raw.unexpectedConsole;
      evidence.unexpectedFailedRequests = raw.unexpectedFailed;
      evidence.finishedAt = new Date().toISOString();
      const rawPass = [evidence.unexpectedConsoleErrors, evidence.pageErrors, evidence.unexpectedFailedRequests,
        evidence.httpErrors, evidence.captureErrors].every(rows => rows.length === 0);
      evidence.status = !primaryFailure && rawPass && evidence.cleanup.status === 'PASS'
        && evidence.stages.nativeScenario?.status === 'PASS' ? 'PASS-NATIVE-PERSON-SELECT-CELL' : 'FAILED';
      journal('finished-native-person-select');
      fs.writeFileSync(testInfo.outputPath('person-select-evidence.private.json'),
        `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    if (primaryFailure) throw primaryFailure;
    expect(evidence.status).toBe('PASS-NATIVE-PERSON-SELECT-CELL');
  });
