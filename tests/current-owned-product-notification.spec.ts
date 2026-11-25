import { expect, test, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertProductRuntimeUnchanged, classifyProductConsole, createProductEvidence, digest,
  loadProductCredentials, loginProductSession, productApi, productNotificationTotal, productJournal,
  productNotificationEvents, productNotificationText, productScreenshot, runtimeWitness,
  validateOwnedProductNotification, validateProductNotificationReceipt,
  validateFailedRealtimeNotificationCleanupReceipt,
  type ProductSession,
} from './current-owned-product-helper';

const extension = '/extension/internal_messages';
const validId = /^[A-Za-z0-9_-]{1,100}$/;
const englishEvents: Record<string, string> = {
  把你加入了产品: 'Added you to the product',
  把你移除了产品: 'Removed you from the product',
  归档了产品: 'Archived the product',
  激活了产品: 'Activated the product',
  删除了产品: 'Deleted the product',
  恢复了产品: 'Restored the product',
};

function ownedReceipt(project: string, usernameSha256: string) {
  const filenames = JSON.parse(process.env.PLM_CURRENT_PRODUCT_NOTIFICATION_SOURCES || 'null');
  expect(Array.isArray(filenames) && filenames.length > 0).toBe(true);
  const root = path.resolve(__dirname, '../../.artifacts');
  const sources = filenames.map((filename: string) => {
    expect(typeof filename === 'string' && path.isAbsolute(filename)).toBe(true);
    const actual = fs.realpathSync(filename);
    expect(actual.startsWith(`${root}/`)).toBe(true);
    const info = fs.lstatSync(filename);
    expect(info.isFile() && !info.isSymbolicLink() && info.uid === process.geteuid() && (info.mode & 0o077) === 0).toBe(true);
    const bytes = fs.readFileSync(filename);
    return { filename, sha256: digest(bytes), value: JSON.parse(bytes.toString('utf8')) };
  }).filter((source: any) => source.value.project === project);
  expect(sources).toHaveLength(1);
  const [source] = sources;
  const failedRealtimeCleanup = process.env.PLM_CURRENT_PRODUCT_NOTIFICATION_FAILED_REALTIME_CLEANUP === '1';
  const owned = failedRealtimeCleanup
    ? validateFailedRealtimeNotificationCleanupReceipt(source.value, project, usernameSha256)
    : validateProductNotificationReceipt(source.value, project, usernameSha256);
  return { owned, source: { path: source.filename, sha256: source.sha256, project,
    originalStatus: source.value.status,
    scope: failedRealtimeCleanup ? 'display-and-cleanup-of-completed-business-with-retained-realtime-failure'
      : 'passed-business-lifecycle',
    originalReceiptUnmodified: true } };
}

test('current normal notification UI reads exact owned product events and persists read state before native cleanup',
  async ({ browser }, testInfo) => {
    const credentials = loadProductCredentials();
    const { owned, source } = ownedReceipt(testInfo.project.name, digest(credentials.username));
    const language = testInfo.project.use.locale === 'en-US' ? 'en' : 'zh-CN';
    const evidence = createProductEvidence(testInfo, owned.marker, credentials);
    const touch = testInfo.project.use.hasTouch === true;
    const activate = (target: Locator) => touch ? target.tap() : target.click();
    evidence.contract = 'current-owned-product-notification-ui-v1';
    evidence.stages.sourceProductReceipt = source;
    evidence.stages.ownedInput = owned;
    evidence.stages.notificationInteraction = { hasTouch: touch,
      action: touch ? 'actual-locator-touch-tap' : 'ordinary-mouse-click',
      hoverRequired: !touch, forcedActions: false, scope: 'notification-popup-expand-pagination-and-leaf-read' };
    const journal = productJournal(testInfo, evidence);
    journal('prepared-owned-notification-ui');
    const sessions: ProductSession[] = [];
    let session: ProductSession | undefined;
    let primaryFailure: unknown;
    let baseline: any[] = [];
    let actor: Record<string, unknown> | undefined;
    let unrelatedBefore: { id: string; status: string; contentSha256: string }[] = [];
    const nativeMarkRead: { id: string; method: string; path: string }[] = [];
    const nativeBatchRead: string[] = [];
    const listAll = async (current: ProductSession) => {
      expect(actor).toBeTruthy();
      const rows: any[] = [];
      let total: number | undefined;
      const size = 100;
      for (let page = 0; page < 100; page++) {
        const response = await current.requestWithMetadata('POST', `${extension}/fetch_cur_receiver`, {
          page, size, sort: 'timestamp,desc',
        });
        expect(Array.isArray(response.value)).toBe(true);
        const count = productNotificationTotal(response.headers['x-total']);
        total ??= count;
        expect(count, 'The bounded current-receiver dataset changed while paging').toBe(total);
        expect(response.value.length).toBeLessThanOrEqual(size);
        rows.push(...response.value);
        expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
        expect(rows.length).toBeLessThanOrEqual(total);
        if (rows.length === total) break;
        expect(response.value).toHaveLength(size);
      }
      expect(rows.length).toBe(total);
      for (const row of rows) {
        expect(row.receiver).toBe(actor!.srfuserid);
        expect(row.system_tag).toBe(actor!.srfdcsystemid);
      }
      return rows;
    };
    const list = async (current: ProductSession) => {
      const selected = (await listAll(current)).filter(row => typeof row.content === 'string' && row.content.includes(owned.marker));
      selected.forEach(row => validateOwnedProductNotification(row, owned, actor!));
      return selected;
    };
    try {
      session = await loginProductSession(browser, credentials, evidence, language, testInfo);
      sessions.push(session);
      actor = await session.identity();
      evidence.stages.currentReceiver = { userSha256: digest(String(actor.srfuserid)),
        nativeSystemSha256: digest(String(actor.srfdcsystemid)), source: 'normally-authenticated-appdata' };
      const allBefore = await listAll(session);
      baseline = allBefore.filter(row => typeof row.content === 'string' && row.content.includes(owned.marker));
      baseline.forEach(row => validateOwnedProductNotification(row, owned, actor!));
      expect(baseline).toHaveLength(productNotificationEvents.length);
      expect(baseline.map(row => productNotificationText(row.content).event).sort())
        .toEqual(productNotificationEvents.map(event => event.text).sort());
      unrelatedBefore = allBefore.filter(row => !baseline.some(ownedRow => ownedRow.id === row.id))
        .map(row => ({ id: row.id, status: row.status, contentSha256: digest(row.content) }));
      expect(baseline.length, 'A real persisted owned notification is required').toBeGreaterThan(0);
      expect(baseline.every(row => row.status === 'RECEIVED')).toBe(true);
      expect(baseline.every(row => row.content.includes('🙂'))).toBe(true);
      evidence.stages.nativeDelivery = { status: 'PASS', count: baseline.length,
        rows: baseline.map(row => ({ id: row.id, status: row.status, contentSha256: digest(row.content),
          receiverSha256: digest(row.receiver), systemTagSha256: digest(row.system_tag) })) };
      const allowed = new Set(baseline.map(row => row.id));
      session.page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (pathname === `${productApi}${extension}/mark_all_read`) nativeBatchRead.push(pathname);
        const match = pathname.match(/\/extension\/internal_messages\/([^/]+)\/mark_read$/);
        if (match) nativeMarkRead.push({ id: match[1], method: request.method(), path: pathname });
      });
      await activate(session.page.locator('.ibiz-user-message'));
      const popover = session.page.locator('.ibiz-user-message-popover:visible');
      await expect(popover).toBeVisible();
      const readActions = [];
      for (const message of baseline) {
        const expected = productNotificationText(message.content);
        const displayedEvent = language === 'en' ? englishEvents[expected.event] : expected.event;
        expect(displayedEvent).toBeTruthy();
        const escaped = displayedEvent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const leaf = popover.locator('.ibiz-internal-message-container').filter({ hasText: owned.marker })
          .filter({ has: session.page.locator('.notice-card__event-desc').filter({ hasText: new RegExp(`^${escaped}$`) }) });
        for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
          const expand = popover.locator('.ibiz-internal-message-group ion-icon[name="chevron-forward-outline"]');
          for (let index = 0, count = await expand.count(); index < count; index++) await activate(expand.first());
          if (await leaf.count() > 0) break;
          const more = popover.locator('.ibiz-internal-message-tab__load-more');
          await expect(more, 'Ordinary pagination must expose the exact owned notification').toBeVisible();
          await Promise.all([
            session.page.waitForResponse(response => response.request().method() === 'POST' &&
              new URL(response.url()).pathname === `${productApi}${extension}/fetch_cur_receiver`),
            activate(more),
          ]);
        }
        await expect(leaf).toHaveCount(1);
        await expect(leaf.locator('.notice-card__object-name')).toHaveText(expected.name);
        await expect(leaf.locator('.notice-card__object-id')).toHaveText(owned.identifier);
        await expect(leaf).toContainText('🙂');
        await expect(leaf.locator('.notice-pilot-info')).toContainText(
          language === 'en' ? 'Product Management' : '产品管理');
        if (!touch) await leaf.hover();
        const readButton = leaf.locator('.ibiz-internal-message-container-toolbar__button');
        await expect(readButton).toHaveCount(1);
        await expect(readButton).toBeVisible();
        const label = await readButton.getAttribute('title');
        expect(label).toBe(language === 'en' ? 'Mark as read' : '标记为已读');
        if (readActions.length === 0) await productScreenshot(session.page, testInfo, 'owned-product-notification-before-read');
        journal('before-exact-owned-leaf-ui-mark-read');
        const [response] = await Promise.all([
          session.page.waitForResponse(response => response.request().method() === 'POST' &&
            new URL(response.url()).pathname === `${productApi}${extension}/${message.id}/mark_read`),
          activate(readButton),
        ]);
        expect(response.status()).toBe(200);
        await expect.poll(async () => {
          const readback = await session!.request('GET', `${extension}/${message.id}`);
          validateOwnedProductNotification(readback, owned, actor!);
          expect(digest(readback.content)).toBe(digest(message.content));
          return readback.status;
        }).toBe('READ');
        readActions.push({ id: message.id, event: expected.event, displayedEvent, label,
          expectedLabel: language === 'en' ? 'Mark as read' : '标记为已读',
          action: touch ? 'ordinary-touch-tap-own-leaf-read-icon' : 'ordinary-hover-and-own-leaf-read-icon',
          groupBulkUsed: false });
      }
      await expect.poll(async () => {
        const rows = await list(session!);
        expect(rows.map((row: any) => row.id).sort()).toEqual([...allowed].sort());
        return rows.every((row: any) => row.status === 'READ');
      }, { timeout: 20_000 }).toBe(true);
      expect(nativeBatchRead).toEqual([]);
      expect(nativeMarkRead.length).toBe(allowed.size);
      expect(nativeMarkRead.every(request => request.method === 'POST' && allowed.has(request.id))).toBe(true);
      evidence.stages.uiMarkRead = { status: 'PASS', ids: [...allowed], leafActions: readActions,
        nativeRequests: nativeMarkRead, batchAllReadUsed: false, groupBulkUsed: false,
        linkedAndUnlinkedTemplateEventsVerified: true, fullLocalizationAcceptance: false };
      evidence.stages.displayOnlyLocalization = { status: 'PASS-six-declared-product-events',
        language, originalPersistedContentRetained: true, namesIdentifiersAndUnicodeUnchanged: true,
        unknownTemplatesAcceptance: false, fullLocalizationAcceptance: false };
      const fresh = await loginProductSession(browser, credentials, evidence, language, testInfo);
      sessions.push(fresh);
      expect(await fresh.identity()).toEqual(actor);
      const freshRows = await list(fresh);
      expect(freshRows.map((row: any) => row.id).sort()).toEqual([...allowed].sort());
      for (const row of freshRows) {
        expect(row.status).toBe('READ');
        expect(digest(row.content)).toBe(digest(baseline.find(before => before.id === row.id).content));
      }
      evidence.stages.freshSessionReadState = { status: 'PASS', count: freshRows.length,
        secondNormalLogin: true, contentUnicodeUnchanged: true };
      await productScreenshot(session.page, testInfo, 'owned-product-notification-after-read');
    } catch (error) {
      primaryFailure = error;
      evidence.stages.failure = (error as Error).message;
    } finally {
      if (session && baseline.length && actor &&
          (evidence.stages.freshSessionReadState as any)?.status === 'PASS') {
        const errors = [];
        try {
          evidence.cleanup = { status: 'PREPARED-EXACT-OWNED-NOTIFICATION-REMOVE',
            ids: baseline.map(row => row.id), receiverSha256: digest(String(actor!.srfuserid)), marker: owned.marker };
          journal('before-owned-notification-cleanup');
          const current = await list(session);
          const originalIds = new Set(baseline.map(row => row.id));
          expect(current.every((row: any) => originalIds.has(row.id))).toBe(true);
          for (const row of current) {
            expect(row.id).toMatch(validId);
            const exact = await session.request('GET', `${extension}/${row.id}`);
            validateOwnedProductNotification(exact, owned, actor!);
            expect(digest(exact.content)).toBe(digest(baseline.find(before => before.id === exact.id).content));
            evidence.cleanup.pendingId = row.id;
            journal('before-exact-owned-notification-delete');
            try { await session.request('DELETE', `${extension}/${row.id}`); }
            catch (error) { errors.push((error as Error).message); primaryFailure ??= error; }
          }
          expect(await list(session)).toEqual([]);
          const allAfter = await listAll(session);
          const unrelatedAfter = unrelatedBefore.map(before => {
            const after = allAfter.find(row => row.id === before.id);
            expect(after, 'An unrelated original notification disappeared').toBeTruthy();
            return { id: after.id, status: after.status, contentSha256: digest(after.content) };
          });
          expect(unrelatedAfter).toEqual(unrelatedBefore);
          evidence.stages.unrelatedNotificationReadback = { status: 'PASS', count: unrelatedBefore.length,
            originalStatusesAndContentUnchanged: true };
          evidence.cleanup = { status: 'PASS', marker: owned.marker, exactIds: baseline.map(row => row.id),
            receiverBoundToNormalAppdata: true, remaining: 0, nativeErrors: errors,
            sendAuditDeleted: false, productAndMembersAlreadyCleanedBySourceReceipt: true };
        } catch (error) {
          evidence.cleanup = { status: 'FAILED', marker: owned.marker, error: (error as Error).message, nativeErrors: errors };
          primaryFailure ??= error;
        }
      } else evidence.cleanup = { status: baseline.length ? 'RETAINED-PENDING-UI-ACCEPTANCE' : 'NO-ELIGIBLE-OWNED-NOTIFICATIONS',
        exactOwnedIds: baseline.map(row => row.id), nativeDeleteAttempted: false };
      for (const current of sessions.reverse()) await current.close();
      try {
        evidence.runtimeAfter = runtimeWitness();
        evidence.runtimeComparison = assertProductRuntimeUnchanged(evidence.runtimeBefore, evidence.runtimeAfter);
      } catch (error) { evidence.captureErrors.push((error as Error).message); }
      const classification = classifyProductConsole(evidence);
      evidence.expectedPreAuthConsoleErrors = classification.expected;
      evidence.unexpectedConsoleErrors = classification.unexpected;
      evidence.finishedAt = new Date().toISOString();
      const raw = [evidence.unexpectedConsoleErrors, evidence.pageErrors, evidence.failedRequests,
        evidence.httpErrors, evidence.captureErrors];
      if (!primaryFailure && raw.every(rows => rows.length === 0) && evidence.cleanup.status === 'PASS') evidence.status = 'PASS';
      evidence.stages.batchAllReadRequests = nativeBatchRead;
      journal('finished-owned-notification-ui');
      const descriptor = fs.openSync(testInfo.outputPath('product-notification-evidence.private.json'), 'wx', 0o600);
      try { fs.writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
    }
    if (primaryFailure) throw primaryFailure;
    expect(evidence.status).toBe('PASS');
  });
