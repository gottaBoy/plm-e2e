import { expect, test, type Frame, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertProductRuntimeUnchanged, classifyProductConsole, createProductEvidence, digest,
  loadProductCredentials, loginProductSession, openProductManagement, productApi, productEntry,
  productJournal, productOrigin, productScreenshot, runtimeWitness,
  validateOwnedProductMember, validateOwnedProductRecord, type ProductSession,
} from './current-owned-product-helper';
import { clickTab } from './helpers';
import {
  cleanupDocumentationNotifications, documentationNotificationSnapshot, documentationStableValue,
  pageDocumentationNotifications, validateDocumentationNotificationTemplates,
} from './current-api-documentation-notifications.mjs';

const workspace = path.resolve(__dirname, '../..');
const releaseReceipt = '.artifacts/api-documentation-install-apply-20261126-r2/report.private.json';
const releaseSha256 = 'c28496aa9141edaafa5db09281afeefd1ee0016890f99da2b72fdd8f0042d314';
const appliedRuntimeFiles = new Map([
  ['extras/js/@ibiz-template/runtime/lifecycle-529c247dced450f2/index.system.min.js',
    '529c247dced450f20772ca70ac7320ab4201c999af4eb85c40da9f873258c009'],
  ['extras/json/system-import-lifecycle-529c247dced450f2.json',
    '8bf8a86e1adf6c1292328c767f6224e2706542487eb350c79819e1452cfa4a33'],
  ['index.html', 'abe4897ef1e4082b6b118c330492823f1bad4efc71982562431b12ce84cb6f04'],
]);
const developmentLayoutRelative = 'static/css/plm-development-layout-a7960806acae7bae.css';
const developmentLayoutSha256 = 'a7960806acae7bae3355fdbe105210e9a742156370482d44daab9c395f5bc402';

async function nativeApiFrame(page: Page): Promise<Frame> {
  const iframe = page.locator('.ibiz-view--ps_core_prd_func_api_show_html_view iframe');
  await expect(iframe).toBeVisible();
  const frame = await (await iframe.elementHandle())!.contentFrame();
  assert.ok(frame, 'The native API Reference view must own its document iframe');
  await expect(frame.locator('.markdown-section').first()).toBeVisible();
  const url = new URL(frame.url());
  expect(url.origin).toBe(productOrigin);
  expect(url.pathname).toBe('/ibizplm-plmweb/doc/');
  return frame;
}

test('normal Development API Reference embeds the published host and documented owned API preserves refusal and cleanup',
  async ({ browser }, testInfo) => {
    const credentials = loadProductCredentials();
    const language = testInfo.project.use.locale === 'en-US' ? 'en' : 'zh-CN';
    const english = language === 'en';
    const marker = `CD-${randomUUID()}`;
    const identifier = `CD${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const name = `${marker} 产品🙂`;
    const editedName = `${name} e\u0301`;
    const description = `${marker}\n中文🙂 e\u0301 ' " \\`;
    const evidence: any = createProductEvidence(testInfo, marker, credentials);
    evidence.contract = 'current-native-api-documentation-v1';
    evidence.fullB03Acceptance = false;
    evidence.fullL03Acceptance = false;
    evidence.fullLocalizationAcceptance = false;
    evidence.expectedControlledApiRefusals = [];
    evidence.expectedCleanupAbsences = [];
    evidence.rawStageGates = [];
    evidence.stages.ownedInput = { marker, identifier, name, editedName };
    const journal = productJournal(testInfo, evidence);
    const sourcePaths = [
      'plm-e2e/tests/current-api-documentation.spec.ts',
      'plm-e2e/playwright.current-api-documentation.config.ts',
      'plm-e2e/tests/current-owned-product-helper.ts',
      'plm-e2e/tests/helpers.ts',
      'plm-e2e/tests/current-api-documentation-notifications.mjs',
      'plm-e2e/config-tests/current-api-documentation-notifications.test.mjs',
      'ibiz-app-hub/packages/runtime/src/controller/common/base.controller.ts',
      'ibiz-app-hub/packages/runtime/src/controller/common/control/control.controller.ts',
      'ibiz-app-hub/packages/runtime/src/service/service/auth/v7-auth.service.ts',
      'ibiz-app-hub/packages/runtime/src/controller/control/app-menu/app-menu.controller.ts',
      'scripts/tests/app-menu-navigation-lifecycle.test.mjs',
      'plm-web/src/runtime/development-layout.css',
      'plm/model/PSSYSTEM.json',
    ];
    evidence.executedProbeSources = sourcePaths.map(relative => {
      const bytes = fs.readFileSync(path.join(workspace, relative));
      const target = testInfo.outputPath('api-documentation-source', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      return { path: relative, sha256: digest(bytes), snapshot: target };
    });
    const receiptBytes = fs.readFileSync(path.join(workspace, releaseReceipt));
    expect(digest(receiptBytes)).toBe(releaseSha256);
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    expect(receipt.status).toBe('APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING');
    expect(receipt.parentAcceptance).toBe(false);
    evidence.documentationRelease = { path: releaseReceipt, sha256: releaseSha256, status: receipt.status };
    const runtimeReceiptPath = process.env.PLM_CURRENT_API_DOCUMENTATION_RUNTIME_APPLY;
    const runtimeReceiptSha256 = process.env.PLM_CURRENT_API_DOCUMENTATION_RUNTIME_APPLY_SHA256;
    assert.ok(runtimeReceiptPath && path.isAbsolute(runtimeReceiptPath));
    assert.match(runtimeReceiptSha256 ?? '', /^[a-f0-9]{64}$/);
    const runtimeReceiptInfo = fs.lstatSync(runtimeReceiptPath);
    assert.ok(runtimeReceiptInfo.isFile() && !runtimeReceiptInfo.isSymbolicLink() &&
      runtimeReceiptInfo.uid === process.geteuid() && (runtimeReceiptInfo.mode & 0o077) === 0);
    const runtimeReceiptBytes = fs.readFileSync(runtimeReceiptPath);
    expect(digest(runtimeReceiptBytes)).toBe(runtimeReceiptSha256);
    const runtimeReceipt = JSON.parse(runtimeReceiptBytes.toString('utf8'));
    expect(runtimeReceipt.contract).toBe('plm-language-runtime-apply-v1');
    expect(runtimeReceipt.status).toBe('APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING');
    expect(runtimeReceipt.manifestSha256).toBe('ea1830df11093c23758b86519a3e959c979742ecd527a4e70fd0641a38e343e8');
    expect(runtimeReceipt.planSha256).toBe('bba2004ded34376f5afb279c7246f6c6abbdbd90258e62886b9b63d202fd7fd5');
    expect(runtimeReceipt.epoch).toBe('da4f24ac-6670-42e9-a2ef-261dcebfe468');
    expect(runtimeReceipt.mutations).toHaveLength(6);
    for (const scope of ['host', 'container']) {
      const rows = runtimeReceipt.mutations.filter((row: any) => row.scope === scope);
      expect(new Set(rows.map((row: any) => row.path)).size).toBe(3);
      for (const [relative, sha256] of appliedRuntimeFiles) {
        const matching = rows.filter((row: any) => row.path === relative);
        expect(matching).toHaveLength(1);
        expect(matching[0].sha256).toBe(sha256);
      }
    }
    evidence.runtimeRelease = { path: runtimeReceiptPath, sha256: runtimeReceiptSha256,
      manifestSha256: runtimeReceipt.manifestSha256, epoch: runtimeReceipt.epoch,
      status: runtimeReceipt.status, sourcesChangedFromServingPredecessor: 3 };
    const developmentReceiptPath = process.env.PLM_CURRENT_API_DOCUMENTATION_DEVELOPMENT_LAYOUT_APPLY;
    const developmentReceiptSha256 =
      process.env.PLM_CURRENT_API_DOCUMENTATION_DEVELOPMENT_LAYOUT_APPLY_SHA256;
    assert.ok(developmentReceiptPath && path.isAbsolute(developmentReceiptPath));
    assert.match(developmentReceiptSha256 ?? '', /^[a-f0-9]{64}$/);
    const developmentReceiptBytes = fs.readFileSync(developmentReceiptPath);
    expect(digest(developmentReceiptBytes)).toBe(developmentReceiptSha256);
    const developmentReceipt = JSON.parse(developmentReceiptBytes.toString('utf8'));
    expect(developmentReceipt.contract).toBe('plm-language-runtime-apply-v1');
    expect(developmentReceipt.status).toBe('APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING');
    expect(developmentReceipt.manifestSha256)
      .toBe('ca764ce33b76fe5c39741fdf13089d22299d435c08a4b870cc30a2f0cd9cb24d');
    expect(developmentReceipt.planSha256)
      .toBe('d4aa4f34920edde52af1a3644c8403b3e18dad1febedfc6ff5a8b9ec66cc0484');
    expect(developmentReceipt.mutations).toHaveLength(4);
    evidence.developmentLayoutRelease = {
      path: developmentReceiptPath, sha256: developmentReceiptSha256,
      manifestSha256: developmentReceipt.manifestSha256,
      cssPath: developmentLayoutRelative, cssSha256: developmentLayoutSha256,
      status: developmentReceipt.status,
    };
    journal('prepared-native-documentation-run');
    let session: ProductSession | undefined;
    let productId: string | undefined;
    let creationIntent = false;
    let primaryFailure: unknown;
    let actor: Record<string, unknown> | undefined;
    let notificationBaseline: any[] | undefined;
    let createdProof: any;
    let updatedProof: any;
    let productCleanupVerified = false;
    const observedNames = new Set<string>();
    const memberRemovals: { memberId: string; productId: string; status: number; method: 'DELETE'; path: string }[] = [];
    const deletedNotificationIds = new Set<string>();
    const templates = validateDocumentationNotificationTemplates(
      JSON.parse(fs.readFileSync(path.join(workspace, 'plm/model/PSSYSTEM.json'), 'utf8')),
    );
    const notificationRequest = async (method: string, suffix: string, data?: unknown) => {
      assert.ok(session);
      const matchedKey = suffix.match(/^\/extension\/internal_messages\/([A-Za-z0-9_-]{1,100})$/);
      assert.ok(method === 'POST' && suffix === '/extension/internal_messages/fetch_cur_receiver'
        || ['GET', 'DELETE'].includes(method) && matchedKey,
      'Only bounded native receiver paging and exact owned message keys are permitted');
      const response = await session.context.request.fetch(`${productOrigin}${productApi}${suffix}`, {
        method, headers: await session.headers(), ...(data === undefined ? {} : { data }),
      });
      const bytes = await response.body();
      let value: any = null;
      if (bytes.length) {
        try { value = JSON.parse(bytes.toString('utf8')); }
        catch { value = bytes.toString('utf8'); }
      }
      const observation = { source: 'native-notification-api-with-ui-issued-headers',
        method, path: `${productApi}${suffix}`, status: response.status(),
        bytes: bytes.length, sha256: digest(bytes) };
      evidence.apiResponses.push(observation);
      if (method === 'DELETE' && response.status() === 200) deletedNotificationIds.add(matchedKey![1]);
      if (response.status() >= 400) {
        if (method === 'GET' && response.status() === 404 && matchedKey
            && deletedNotificationIds.has(matchedKey[1])) {
          evidence.expectedCleanupAbsences.push({ ...observation, reason: 'exact-preflighted-owned-message-after-DELETE' });
        } else evidence.httpErrors.push(observation);
      }
      return { value, status: response.status(), headers: response.headers() };
    };
    const receiverMessages = async () => {
      assert.ok(actor);
      return pageDocumentationNotifications(notificationRequest, actor);
    };
    const refusalSnapshot = async () => {
      assert.ok(session && productId);
      const product = await session.request('GET', `/products/${productId}`);
      assertOwned(product);
      const members = await session.request('POST', `/products/${productId}/product_members/fetch_default`, { page: 0, size: 1000 });
      expect(Array.isArray(members)).toBe(true);
      members.forEach((member: any) => validateOwnedProductMember(member, productId!));
      return {
        product: documentationStableValue(product),
        members: documentationStableValue([...members].sort((left: any, right: any) => left.id.localeCompare(right.id))),
        receiverMessages: documentationNotificationSnapshot(await receiverMessages()),
      };
    };
    const assertRawGate = async (stage: string) => {
      await session?.quiet();
      const consoleClassification = classifyProductConsole(evidence);
      const counts = {
        unexpectedConsoleErrors: consoleClassification.unexpected.length,
        pageErrors: evidence.pageErrors.length, failedRequests: evidence.failedRequests.length,
        httpErrors: evidence.httpErrors.length, captureErrors: evidence.captureErrors.length,
      };
      evidence.rawStageGates.push({ stage, counts });
      journal(`raw-gate-${stage}`);
      expect(Object.values(counts).every(count => count === 0), `Raw browser gate failed at ${stage}`).toBe(true);
    };
    const assertOwned = (record: any) => validateOwnedProductRecord(record, {
      id: productId, identifier, names: [name, editedName],
    });
    try {
      session = await loginProductSession(browser, credentials, evidence, language, testInfo);
      await assertRawGate('normal-login');
      const runtimeRelative = [...appliedRuntimeFiles.keys()][0];
      const loaded = evidence.resourceBindings.filter((resource: any) =>
        resource.path === `/ibizplm-plmweb/${runtimeRelative}`);
      expect(loaded.length, 'Normal login must load the exact applied lifecycle runtime bytes').toBeGreaterThan(0);
      expect(loaded.every((resource: any) => resource.sha256 === appliedRuntimeFiles.get(runtimeRelative))).toBe(true);
      evidence.stages.loadedRuntimeBinding = { status: 'PASS', path: runtimeRelative,
        sha256: appliedRuntimeFiles.get(runtimeRelative), observedBrowserResponses: loaded.length };
      const developmentCssLoaded = evidence.resourceBindings.filter((resource: any) =>
        resource.path === `/ibizplm-plmweb/${developmentLayoutRelative}`);
      expect(developmentCssLoaded.length,
        'Normal login must load the exact applied mobile Development layout CSS').toBeGreaterThan(0);
      expect(developmentCssLoaded.every((resource: any) =>
        resource.sha256 === developmentLayoutSha256)).toBe(true);
      evidence.stages.loadedDevelopmentLayoutBinding = {
        status: 'PASS', path: developmentLayoutRelative,
        sha256: developmentLayoutSha256, observedBrowserResponses: developmentCssLoaded.length,
      };
      const { page } = session;
      const navigation = page.locator('.ibiz-control-appmenu-plm_menu');
      if (await navigation.evaluate(element => element.classList.contains('is-collapse'))) {
        await navigation.locator('.ibiz-control-appmenu-collapse-icon').click();
      }
      const development = navigation.locator('.el-menu-item')
        .filter({ hasText: english ? /^Development$/ : /^二次开发$/ });
      await expect(development, 'The real configured Development menu is the required entry').toBeVisible();
      journal('before-development-menu');
      await development.click();
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await navigation.locator('.ibiz-control-appmenu-collapse-icon').click();
        await expect(navigation).toHaveClass(/\bis-collapse\b/);
      }
      const apiTab = page.getByRole('tab', { name: english ? 'API Reference' : '接口说明', exact: true });
      await expect(apiTab).toBeVisible();
      await clickTab(apiTab);
      const frame = await nativeApiFrame(page);
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        evidence.stages.mobileGeometryBeforeSearch = {
          iframe: await page.locator('.ibiz-view--ps_core_prd_func_api_show_html_view iframe').boundingBox(),
          hostViewport: page.viewportSize(),
          layout: await page.locator('.second_dev_tab_style').evaluate(element =>
            [...element.querySelectorAll('.ibiz-control-viewlayoutpanel-content, .ibiz-panel-view-header, .ibiz-panel-view-header *, .el-tabs')].map(item => {
              const style = getComputedStyle(item);
              return { classes: item.className, rect: item.getBoundingClientRect().toJSON(),
                scrollWidth: item.scrollWidth, minWidth: style.minWidth, display: style.display,
                flexDirection: style.flexDirection, overflow: style.overflow, width: style.width };
            })),
          matched: await page.locator('.second_dev_tab_style .ibiz-panel-view-header > .ibiz-row')
            .evaluate(element => {
              const style = getComputedStyle(element);
              return { matched: true, flexDirection: style.flexDirection, height: style.height,
                parentHeight: getComputedStyle(element.parentElement!).height,
                selectorParent: element.parentElement?.className,
                inlineStyle: element.getAttribute('style'),
                parentInlineStyle: element.parentElement?.getAttribute('style'),
                scopedMatch: element.matches('.ibiz-view--ps_core_prd_func_second_dev_tav_exp_view .ibiz-panel-view-header > .ibiz-row'),
                themeMatch: element.matches('.second_dev_tab_style .ibiz-panel-view-header > .ibiz-row'),
                nearestView: element.closest('[class*="second_dev"]')?.className ?? null,
              };
            }).catch(() => ({ matched: false })),
          matchingRules: await page.evaluate(() => {
            const found: any[] = [];
            const visit = (rules: CSSRuleList) => {
              for (const rule of Array.from(rules)) {
                if (rule instanceof CSSMediaRule) visit(rule.cssRules);
                else if (rule instanceof CSSStyleRule &&
                  /second_dev_tab_style|ibiz-panel-view-header/.test(rule.selectorText)) {
                  found.push({ selector: rule.selectorText, css: rule.cssText });
                }
              }
            };
            for (const sheet of Array.from(document.styleSheets)) {
              try { if (sheet.cssRules) visit(sheet.cssRules); } catch {}
            }
            return found.slice(-30);
          }),
          ancestors: await page.locator('.ibiz-view--ps_core_prd_func_api_show_html_view iframe').evaluate(element => {
            const result = [];
            for (let item: Element | null = element; item; item = item.parentElement) {
              const style = getComputedStyle(item);
              result.push({ tag: item.tagName, classes: item.className,
                rect: item.getBoundingClientRect().toJSON(), scrollLeft: item.scrollLeft,
                scrollWidth: item.scrollWidth, clientWidth: item.clientWidth, overflow: style.overflow,
                position: style.position, width: style.width, transform: style.transform,
                minWidth: style.minWidth, flex: style.flex });
            }
            return result;
          }),
          document: await frame.evaluate(() => {
            const rect = (element: Element | null) => element?.getBoundingClientRect().toJSON();
            return { width: innerWidth, height: innerHeight, bodyClass: document.body.className,
              toggle: rect(document.querySelector('.sidebar-toggle')),
              sidebar: rect(document.querySelector('.sidebar')),
              search: rect(document.querySelector('[data-aibiz-api-search]')),
              scrollWidth: document.documentElement.scrollWidth };
          }),
        };
        journal('mobile-geometry-before-search');
        const body = frame.locator('body');
        if (!await body.evaluate(element => element.classList.contains('close'))) {
          const toggle = frame.locator('.sidebar-toggle');
          const box = await toggle.boundingBox();
          const viewport = page.viewportSize()!;
          expect(box, 'The native document menu must have a real hit box').not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
          await toggle.click();
        }
        await expect(body).toHaveClass(/\bclose\b/);
        await expect.poll(() => frame.locator('.sidebar').evaluate(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= innerWidth + 1;
        })).toBe(true);
        await frame.locator('[data-aibiz-api-search]').scrollIntoViewIfNeeded();
      }
      const apiSearch = frame.locator('[data-aibiz-api-search]');
      await expect(apiSearch).toBeVisible();
      await apiSearch.fill(english ? 'Access Password' : '访问密码');
      await expect(frame.locator('[data-aibiz-api-results] a').first()).toBeVisible();
      await frame.locator('[data-aibiz-api-results] a').first().click();
      await expect(frame.locator('.markdown-section').first()).toContainText(english ? 'Access Password' : '访问密码');
      await assertRawGate('native-menu-iframe');
      evidence.stages.nativeMenuEmbedding = { status: 'PASS', parentUrl: page.url(),
        iframeUrl: frame.url(), normalMenuClick: true, normalTabClick: true };
      await productScreenshot(page, testInfo, 'native-api-reference');
      const deepLink = page.url();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await nativeApiFrame(page);
      await assertRawGate('native-refresh');
      evidence.stages.refresh = { status: 'PASS', url: page.url() };
      await page.goto(productEntry, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.ibiz-control-appmenu-plm_menu')).toBeVisible();
      await page.goto(deepLink, { waitUntil: 'domcontentloaded' });
      await nativeApiFrame(page);
      await assertRawGate('native-deep-link');
      evidence.stages.deepLink = { status: 'PASS', normalAuthenticatedSession: true, url: page.url() };
      journal('native-embedding-passed');

      if (testInfo.project.name !== 'api-documentation-zh-desktop') {
        evidence.stages.representativeApi = { status: 'NOT-RUN-IN-THIS-CELL', cell: 'api-documentation-zh-desktop' };
      } else {
        actor = await session.identity();
        notificationBaseline = await receiverMessages();
        expect(notificationBaseline.some(row => typeof row.content === 'string' && row.content.includes(marker))).toBe(false);
        evidence.stages.receiverBeforeCreate = { status: 'PASS', normalServerIdentity: actor,
          originalCount: notificationBaseline.length, snapshot: documentationNotificationSnapshot(notificationBaseline),
          ownMarkerAbsent: true };
        journal('receiver-message-baseline-before-product-create');
        await openProductManagement(page, language);
        await page.locator('button[title="新建产品"]').click();
        const wizard = page.locator('.ibiz-control-wizardpanel');
        await wizard.getByPlaceholder('输入产品名称', { exact: true }).fill(name);
        await wizard.locator('.ibiz-form-item').filter({ hasText: '产品标识' }).locator('input').fill(identifier);
        await wizard.getByPlaceholder('输入产品描述', { exact: true }).fill(description);
        await wizard.locator('.ibiz-control-wizardpanel-footer')
          .getByRole('button', { name: '下一步', exact: true }).click();
        await expect(wizard.locator('.el-table__row')).toHaveCount(1);
        const created = page.waitForResponse(response => response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `${productApi}/products`);
        creationIntent = true;
        journal('before-owned-product-create');
        await wizard.locator('.ibiz-control-wizardpanel-footer')
          .getByRole('button', { name: /^(?:完成|Complete|Finish)$/ }).click();
        const createdResponse = await created;
        expect(createdResponse.status()).toBe(200);
        const initial = await createdResponse.json();
        productId = initial.id;
        assertOwned(initial);
        expect(initial.description).toBe(description);
        createdProof = { status: 'PASS', productId, identifier, name: initial.name,
          method: 'POST', path: '/products', source: 'normal-native-ui' };
        observedNames.add(initial.name);
        evidence.stages.documentedCreate = createdProof;
        journal('owned-product-create-response-bound');
        await expect(wizard).toBeHidden();
        await expect(page.locator('.ibiz-view--product_index_view')).toBeVisible();
        await assertRawGate('owned-create-native-view-ready');
        evidence.stages.documentedCreate = createdProof;
        journal('owned-product-created');
        const read = await session.request('GET', `/products/${productId}`);
        assertOwned(read);
        expect(read.name).toBe(name);
        expect(read.description).toBe(description);
        const update = await session.request('PUT', `/products/${productId}`, { name: editedName, description });
        assertOwned(update);
        expect(update.name).toBe(editedName);
        expect(update.description).toBe(description);
        updatedProof = { status: 'PASS', productId, name: update.name,
          method: 'PUT', path: `/products/${productId}` };
        observedNames.add(update.name);
        evidence.stages.productUpdateProof = updatedProof;
        const updated = await session.request('GET', `/products/${productId}`);
        assertOwned(updated);
        expect(updated.name).toBe(editedName);
        expect(updated.description).toBe(description);
        await assertRawGate('documented-read-update');
        evidence.stages.documentedReadUpdate = { status: 'PASS', get: true, put: true,
          exactUnicodeRoundtrip: true, declaredDtoSubsetOnly: true };
        for (const method of ['GET', 'PUT']) {
          const effectsBefore = await refusalSnapshot();
          evidence.stages.refusalEffects ??= [];
          const effect = { method, before: effectsBefore, after: null as unknown, status: 'PREPARED' };
          evidence.stages.refusalEffects.push(effect);
          journal(`before-anonymous-${method.toLowerCase()}-refusal`);
          const response = await session.context.request.fetch(`${productOrigin}${productApi}/products/${productId}`, {
            method, headers: { accept: 'application/json' },
            ...(method === 'PUT' ? { data: { name: `${marker}-anonymous-rejected` } } : {}),
          });
          const body = await response.body();
          evidence.expectedControlledApiRefusals.push({ method, path: `${productApi}/products/${productId}`,
            status: response.status(), authenticated: false, bytes: body.length, sha256: digest(body) });
          expect(response.status(), 'Anonymous documented resource access must be refused').toBe(401);
          const unchanged = await session.request('GET', `/products/${productId}`);
          assertOwned(unchanged);
          expect(unchanged.name).toBe(editedName);
          expect(unchanged.description).toBe(description);
          const effectsAfter = await refusalSnapshot();
          effect.after = effectsAfter;
          expect(effectsAfter, 'Refused access must leave product DTO, exact memberships and receiver messages unchanged').toEqual(effectsBefore);
          effect.status = 'PASS';
          await assertRawGate(`anonymous-${method.toLowerCase()}-refusal-readback`);
        }
        evidence.stages.anonymousRefusal = { status: 'PASS', getStatus: 401, putStatus: 401,
          persistenceUnchangedAfterEach: true, productDtoMembersAndReceiverMessagesUnchanged: true,
          physicalDatabaseTotalInvarianceClaimed: false, roleMatrixAcceptance: false };
      }
    } catch (error) {
      primaryFailure = error;
      evidence.stages.failure = String((error as Error).message);
      if (session) {
        try {
          evidence.failureLocation = { url: session.page.url(),
            text: (await session.page.locator('body').innerText()).slice(0, 30_000) };
          await productScreenshot(session.page, testInfo, 'native-documentation-failure');
        } catch (captureError) { evidence.captureErrors.push(String(captureError)); }
      }
    } finally {
      if (session && creationIntent) {
        try {
          await openProductManagement(session.page, language);
          await expect(session.page.locator('.ibiz-view--product_index_view')).toHaveCount(0);
          await session.page.waitForLoadState('networkidle');
          await session.quiet();
          const candidates = (await Promise.all(['main', 'archived', 'deleted'].map(dataset =>
            session!.request('POST', `/products/fetch_${dataset}`, { page: 0, size: 1000, n_identifier_eq: identifier }))))
            .flat().filter(row => row.identifier === identifier);
          expect(candidates.length).toBeLessThanOrEqual(1);
          if (candidates.length) {
            const owned = assertOwned(candidates[0]);
            productId ??= owned.id;
            evidence.cleanup = { status: 'PREPARED-EXACT-OWNED-REMOVE', productId, identifier };
            journal('before-owned-cleanup');
            const members = await session.request('POST', '/product_members/fetch_default', {
              page: 0, size: 1000, n_product_id_eq: productId,
            });
            expect(Array.isArray(members)).toBe(true);
            members.forEach((member: any) => validateOwnedProductMember(member, productId!));
            for (const member of members) {
              validateOwnedProductMember(member, productId!);
              evidence.cleanup.pendingMemberId = member.id;
              journal('before-owned-membership-remove');
              await session.request('DELETE', `/product_members/${member.id}`);
              memberRemovals.push({ memberId: member.id, productId: owned.id, status: 200,
                method: 'DELETE', path: `/product_members/${member.id}` });
              evidence.stages.ownedMembershipRemovals = memberRemovals;
            }
            expect(await session.request('POST', '/product_members/fetch_default', {
              page: 0, size: 1000, n_product_id_eq: productId,
            })).toEqual([]);
            await session.request('DELETE', `/products/${productId}`);
          } else if (productId) throw new Error('Recorded owned product is absent from all native cleanup datasets');
          const remains = (await Promise.all(['main', 'archived', 'deleted'].map(dataset =>
            session!.request('POST', `/products/fetch_${dataset}`, { page: 0, size: 1000, n_identifier_eq: identifier }))))
            .flat().filter(row => row.id === productId || row.identifier === identifier);
          expect(remains).toEqual([]);
          if (productId) {
            expect(await session.request('POST', '/product_members/fetch_default', {
              page: 0, size: 1000, n_product_id_eq: productId,
            })).toEqual([]);
          }
          evidence.cleanup = { status: 'PASS', productId, productsRemoved: candidates.length,
            exactOwnIdentifierVerified: true, activeArchivedDeletedRemain: 0, membershipReadbackEmpty: true };
          productCleanupVerified = true;
          evidence.stages.documentedRemove = { status: 'PASS', method: 'DELETE', exactOwnedProduct: true };
          await assertRawGate('owned-cleanup');
        } catch (error) {
          evidence.cleanup = { status: 'FAILED', productId, error: String((error as Error).message) };
          primaryFailure ??= error;
        }
      } else evidence.cleanup = { status: 'NO-WRITE-INTENT', verifiedNoCreateSubmitted: !creationIntent };
      if (session && createdProof && actor && notificationBaseline && productCleanupVerified) {
        try {
          const scope = {
            contract: 'native-api-documentation-owned-product-messages-v1', marker, identifier, productId,
            names: [...observedNames], created: createdProof, updated: updatedProof, memberRemovals,
            startedAt: evidence.startedAt, finishedAt: new Date().toISOString(),
          };
          evidence.notificationCleanup = await cleanupDocumentationNotifications({
            request: notificationRequest, identity: actor, templates, scope, baseline: notificationBaseline,
            journal(stage: string, details: unknown) {
              evidence.notificationCleanupStage = { stage, details };
              journal(stage);
            },
          });
          await assertRawGate('owned-message-cleanup');
        } catch (error) {
          evidence.notificationCleanup = { status: 'FAILED', error: String((error as Error).message),
            exactDeletedIds: [...deletedNotificationIds], sendAuditDeleted: false, recentRecordsDeleted: false };
          primaryFailure ??= error;
        }
      } else evidence.notificationCleanup = { status: creationIntent ? 'RETAINED-NO-VERIFIED-CLEANUP-SOURCE' : 'NO-WRITE-INTENT',
        nativeDeleteAttempted: false, sendAuditDeleted: false, recentRecordsDeleted: false };
      if (session) await session.close();
      try {
        evidence.runtimeAfter = runtimeWitness();
        evidence.runtimeComparison = assertProductRuntimeUnchanged(evidence.runtimeBefore, evidence.runtimeAfter);
        evidence.executedProbeSources.forEach((source: any) => {
          expect(digest(fs.readFileSync(path.join(workspace, source.path)))).toBe(source.sha256);
        });
      } catch (error) { evidence.captureErrors.push(String(error)); }
      const classification = classifyProductConsole(evidence);
      evidence.expectedPreAuthConsoleErrors = classification.expected;
      evidence.unexpectedConsoleErrors = classification.unexpected;
      evidence.finishedAt = new Date().toISOString();
      const rawIssues = [evidence.unexpectedConsoleErrors, evidence.pageErrors, evidence.failedRequests,
        evidence.httpErrors, evidence.captureErrors];
      if (!primaryFailure && rawIssues.every(issues => issues.length === 0) &&
          ['PASS', 'NO-WRITE-INTENT'].includes(evidence.cleanup.status) &&
          ['PASS', 'NO-WRITE-INTENT'].includes(evidence.notificationCleanup.status)) {
        evidence.status = 'PASS-CURRENT-NATIVE-CELL';
      }
      journal('finished-native-documentation');
      fs.writeFileSync(testInfo.outputPath('api-documentation-evidence.private.json'),
        `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    if (primaryFailure) throw primaryFailure;
    expect(evidence.status, 'Native entry, refusal, cleanup and raw browser gates must pass').toBe('PASS-CURRENT-NATIVE-CELL');
  });
