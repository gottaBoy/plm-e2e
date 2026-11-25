import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  createProductEvidence, loadProductCredentials, loginProductSession,
  classifyProductConsole, productApi, productJournal, productSettingsPath, productScreenshot,
  assertProductRuntimeUnchanged, openProductManagement, runtimeWitness,
  productNotificationEvents,
  validateOwnedProductMember, validateOwnedProductRecord, type ProductSession,
} from './current-owned-product-helper';

test('current normal UI product persists across fresh sessions and lifecycle transitions with exact owned cleanup',
  async ({ browser }, testInfo) => {
    const credentials = loadProductCredentials();
    const marker = `CP-${randomUUID()}`;
    const identifier = `CP${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const name = `${marker} 产品🙂`;
    const editedName = `${name} e\u0301`;
    const description = `${marker}\n中文🙂 e\u0301 ' " \\`;
    const language = testInfo.project.use.locale === 'en-US' ? 'en' : 'zh-CN';
    const english = language === 'en';
    const evidence = createProductEvidence(testInfo, marker, credentials);
    const journal = productJournal(testInfo, evidence);
    evidence.stages.ownedInput = { identifier, name, editedName, marker };
    journal('prepared-own-product-run');
    const sessions: ProductSession[] = [];
    let productId: string | undefined;
    let session: ProductSession | undefined;
    let primaryFailure: unknown;
    const assertOwned = (product: any) => validateOwnedProductRecord(product, {
      id: productId, identifier, names: [name, editedName],
    });
    const uiConfirmation = async (page: Page) => {
      await page.locator('.el-message-box:visible').getByRole('button', { name: /^(?:确定|OK|Confirm)$/ }).click();
    };
    try {
      session = await loginProductSession(browser, credentials, evidence, language, testInfo);
      sessions.push(session);
      const { page } = session;
      await openProductManagement(page, language);
      await page.locator(`button[title="${english ? 'New Product' : '新建产品'}"]`).click();
      const wizard = page.locator('.ibiz-control-wizardpanel');
      await wizard.getByPlaceholder(english ? 'Enter product name' : '输入产品名称', { exact: true }).fill(name);
      await wizard.locator('.ibiz-form-item').filter({ hasText: english ? 'Product Identifier' : '产品标识' })
        .locator('input').fill(identifier);
      await wizard.getByPlaceholder(english ? 'Enter product description' : '输入产品描述', { exact: true }).fill(description);
      await wizard.locator('.ibiz-control-wizardpanel-footer').getByRole('button', { name: /^(?:下一步|Next)$/ }).click();
      await expect(wizard.locator('.el-table__row')).toHaveCount(1);
      await productScreenshot(page, testInfo, 'wizard-default-creator-member');
      const created = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${productApi}/products`);
      journal('before-product-create');
      await wizard.locator('.ibiz-control-wizardpanel-footer').getByRole('button', { name: /^(?:完成|Complete|Finish)$/ }).click();
      const response = await created;
      expect(response.status()).toBe(200);
      const initial = await response.json();
      productId = initial.id;
      expect(typeof productId).toBe('string');
      expect(productId).toBeTruthy();
      assertOwned(initial);
      expect(initial.description).toBe(description);
      evidence.stages.create = { status: 'PASS', productId, identifier };
      journal('after-product-create');
      const memberRows = await session.request('POST', `/products/${productId}/product_members/fetch_default`, { page: 0, size: 1000 });
      expect(Array.isArray(memberRows)).toBe(true);
      expect(memberRows.length).toBe(1);
      validateOwnedProductMember(memberRows[0], productId!);
      expect(memberRows[0].role_id).toBe('admin');
      evidence.stages.initialMembership = { status: 'PASS', count: memberRows.length,
        role: memberRows[0].role_id, memberIds: memberRows.map((row: any) => row.id) };

      await page.goto(productSettingsPath(productId!), { waitUntil: 'domcontentloaded' });
      const form = page.locator('.ibiz-view--product_base_information_edit_view .ibiz-control-form');
      const nameInput = form.locator('.ibiz-form-item').filter({ hasText: english ? 'Product Name' : '产品名称' }).locator('input').first();
      await expect(nameInput).toHaveValue(name);
      await nameInput.fill(editedName);
      const saveButton = form.locator('.ibiz-form-button--button1 button');
      await expect(saveButton).toBeVisible();
      journal('before-product-edit');
      const [saved] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'PUT' &&
          new URL(response.url()).pathname === `${productApi}/products/${productId}`),
        saveButton.click(),
      ]);
      expect(saved.status()).toBe(200);
      const edited = await session.request('GET', `/products/${productId}`);
      assertOwned(edited);
      expect(edited.name).toBe(editedName);
      expect(edited.description).toBe(description);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(nameInput).toHaveValue(editedName);
      evidence.stages.editReload = { status: 'PASS', nameUnicodeRoundtrip: true, descriptionUnicodeRoundtrip: true };
      await productScreenshot(page, testInfo, 'edited-product-after-reload');

      const fresh = await loginProductSession(browser, credentials, evidence, language, testInfo);
      sessions.push(fresh);
      await fresh.page.goto(productSettingsPath(productId!), { waitUntil: 'domcontentloaded' });
      await expect(fresh.page.locator('.ibiz-view--product_base_information_edit_view')
        .locator('.ibiz-form-item').filter({ hasText: english ? 'Product Name' : '产品名称' })
        .locator('input').first()).toHaveValue(editedName);
      const freshRead = await fresh.request('GET', `/products/${productId}`);
      assertOwned(freshRead);
      expect(freshRead.description).toBe(description);
      evidence.stages.freshSessionReadback = { status: 'PASS', sameActorNewNormalLogin: true };

      await page.goto(productSettingsPath(productId!, true), { waitUntil: 'domcontentloaded' });
      const advanced = page.locator('.ibiz-view--product_advanced_setting_edit_view');
      const archiveButton = advanced.locator('.ibiz-form-button--button2 button');
      const observedArchiveTitle = await archiveButton.getAttribute('title');
      const expectedArchiveTitle = english ? 'Archive Product' : '归档产品';
      evidence.stages.archiveActionLabel = { observed: observedArchiveTitle, expected: expectedArchiveTitle,
        matches: observedArchiveTitle === expectedArchiveTitle, fullLocalizationAcceptance: false };
      await archiveButton.click();
      const archive = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${productApi}/products/${productId}/archive`);
      journal('before-product-archive');
      await uiConfirmation(page);
      expect((await archive).status()).toBe(200);
      const archived = await session.request('POST', '/products/fetch_archived', { page: 0, size: 1000, n_identifier_eq: identifier });
      expect(archived).toHaveLength(1);
      assertOwned(archived[0]);
      expect(Number(archived[0].is_archived)).toBe(1);
      journal('before-product-activate');
      await session.request('POST', `/products/${productId}/activate`, {});
      const activated = await session.request('GET', `/products/${productId}`);
      assertOwned(activated);
      expect(Number(activated.is_archived)).toBe(0);
      evidence.stages.archiveActivate = { status: 'PASS', archive: 'normal-ui', activate: 'declared-native-action' };

      await page.goto(productSettingsPath(productId!, true), { waitUntil: 'domcontentloaded' });
      await advanced.getByRole('button', { name: english ? 'Delete Product' : '删除产品', exact: true }).click();
      const deleted = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${productApi}/products/${productId}/delete`);
      journal('before-product-delete');
      await uiConfirmation(page);
      expect((await deleted).status()).toBe(200);
      const recycle = await session.request('POST', '/products/fetch_deleted', { page: 0, size: 1000, n_identifier_eq: identifier });
      expect(recycle).toHaveLength(1);
      assertOwned(recycle[0]);
      expect(Number(recycle[0].is_deleted)).toBe(1);
      journal('before-product-recover');
      await session.request('POST', `/products/${productId}/recover`, {});
      const restored = await session.request('GET', `/products/${productId}`);
      assertOwned(restored);
      expect(Number(restored.is_deleted)).toBe(0);
      evidence.stages.deleteRecover = { status: 'PASS', delete: 'normal-ui', recover: 'declared-native-action' };
    } catch (error) {
      primaryFailure = error;
      evidence.stages.failure = String((error as Error).message);
    } finally {
      if (session) {
        try {
          try {
            journal('before-leaving-owned-product-pages');
            for (const current of sessions) {
              await openProductManagement(current.page, language);
              await expect(current.page.locator('.ibiz-view--product_index_view')).toHaveCount(0);
              await current.page.waitForLoadState('networkidle');
              await current.quiet();
            }
            evidence.stages.beforeCleanupNavigation = { status: 'PASS', sessions: sessions.length,
              ownProductViewUnmounted: true, destination: 'normal-product-management-menu' };
          } catch (error) {
            evidence.stages.beforeCleanupNavigation = { status: 'FAILED', error: (error as Error).message };
            primaryFailure ??= error;
          }
          const candidates = (await Promise.all(['main', 'archived', 'deleted'].map(dataset =>
            session!.request('POST', `/products/fetch_${dataset}`, { page: 0, size: 1000, n_identifier_eq: identifier }))))
            .flat().filter(row => row.identifier === identifier);
          expect(candidates.length, 'Only one product can belong to this unique run').toBeLessThanOrEqual(1);
          if (candidates.length) {
            const owned = assertOwned(candidates[0]);
            productId ??= owned.id;
            evidence.cleanup = { status: 'PREPARED-EXACT-OWNED-REMOVE', productId, identifier };
            journal('before-product-cleanup');
            const members = await session.request('POST', '/product_members/fetch_default', {
              page: 0, size: 1000, n_product_id_eq: owned.id,
            });
            expect(Array.isArray(members)).toBe(true);
            for (const member of members) {
              validateOwnedProductMember(member, owned.id);
              evidence.cleanup.pendingMemberId = member.id;
              journal('before-owned-membership-cleanup');
              await session.request('DELETE', `/product_members/${member.id}`);
            }
            expect(await session.request('POST', '/product_members/fetch_default', {
              page: 0, size: 1000, n_product_id_eq: owned.id,
            })).toEqual([]);
            await session.request('DELETE', `/products/${owned.id}`);
            expect(await session.request('POST', '/product_members/fetch_default', {
              page: 0, size: 1000, n_product_id_eq: owned.id,
            })).toEqual([]);
          } else if (productId) {
            throw new Error('The recorded product could not be located in active, archived or deleted native datasets');
          }
          const remains = (await Promise.all(['main', 'archived', 'deleted'].map(dataset =>
            session!.request('POST', `/products/fetch_${dataset}`, { page: 0, size: 1000, n_identifier_eq: identifier }))))
            .flat().filter(row => row.id === productId || row.identifier === identifier);
          expect(remains).toEqual([]);
          evidence.cleanup = { status: 'PASS', productId, exactOwnIdentifierVerified: true,
            activeArchivedDeletedRemain: 0, productsRemoved: candidates.length, membershipReadbackEmpty: true };
        } catch (error) {
          evidence.cleanup = { status: 'FAILED', productId, error: (error as Error).message };
          primaryFailure ??= error;
        }
      } else evidence.cleanup = { status: 'NO-CREATED-PRODUCT-ID' };
      if (process.env.PLM_CURRENT_PRODUCT_REQUIRE_REALTIME === '1' && productId) {
        try {
          await expect.poll(() => [...new Set(evidence.mqttPackets.filter(packet => packet.command === 'publish'
            && packet.matchesOwnedMarker && packet.portalSubtype === 'INTERNALMESSAGE')
            .map(packet => packet.businessEvent).filter(Boolean))].sort(),
          { timeout: 15_000, message: 'All six real product events must arrive over the browser MQTT socket' })
            .toEqual(productNotificationEvents.map(item => item.text).sort());
          const delivered = evidence.mqttPackets.filter(packet => packet.command === 'publish'
            && packet.matchesOwnedMarker && packet.portalSubtype === 'INTERNALMESSAGE');
          evidence.stages.realtimeBusinessDelivery = { status: 'PASS-browser-mqtt-owned-business-publish',
            matchedPackets: delivered.length, payloadHashes: delivered.map(packet => packet.payloadSha256),
            distinctBusinessEvents: [...new Set(delivered.map(packet => packet.businessEvent).filter(Boolean))].sort(),
            allSixDeclaredEventsDelivered: true,
            connackAccepted: evidence.mqttPackets.some(packet => packet.command === 'connack' && packet.returnCode === 0),
            actualWebSocketFrames: evidence.mqttFrames.length, tokensOrRawPayloadRetained: false };
        } catch (error) {
          evidence.stages.realtimeBusinessDelivery = { status: 'FAILED', error: (error as Error).message };
          primaryFailure ??= error;
        }
      }
      for (const current of sessions.reverse()) {
        try { await current.close(); } catch (error) { evidence.captureErrors.push((error as Error).message); }
      }
      try {
        evidence.runtimeAfter = runtimeWitness();
        evidence.runtimeComparison = assertProductRuntimeUnchanged(evidence.runtimeBefore, evidence.runtimeAfter);
      } catch (error) { evidence.captureErrors.push((error as Error).message); }
      evidence.finishedAt = new Date().toISOString();
      const consoleClassification = classifyProductConsole(evidence);
      evidence.expectedPreAuthConsoleErrors = consoleClassification.expected;
      evidence.unexpectedConsoleErrors = consoleClassification.unexpected;
      const rawIssues = [evidence.unexpectedConsoleErrors, evidence.pageErrors, evidence.failedRequests,
        evidence.httpErrors, evidence.captureErrors];
      if (!primaryFailure && rawIssues.every(issues => issues.length === 0) && evidence.cleanup.status === 'PASS') evidence.status = 'PASS';
      journal('finished');
      fs.writeFileSync(testInfo.outputPath('product-lifecycle-evidence.private.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    if (primaryFailure) throw primaryFailure;
    expect(evidence.status, 'Only completed persistence, cleanup and raw error gates may pass').toBe('PASS');
  });
