import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  cleanupKnowledgeAssociations, digest, knowledgeApi, knowledgeCredentials, knowledgeEvidence, knowledgeOrigin,
  knowledgeRecovery, knowledgeRuntimeWitness, loginKnowledgeSession, settleKnowledgeCaptures, type KnowledgeSession,
  assertKnowledgeRuntimeUnchanged, openKnowledgeManagement, validateOwnedKnowledgePage, validateOwnedKnowledgeHome,
  closeKnowledgeModals, performKnowledgeAction,
} from './current-owned-knowledge-helper';

const recovery = knowledgeRecovery();
test(recovery?.mode === 'resources' ? 'recover exact prior owned knowledge resources' :
  recovery ? 'recover exact prior owned knowledge associations' :
  'current owned knowledge draft publication lock and public sharing lifecycle', async ({ browser }, testInfo) => {
  const credentials = knowledgeCredentials();
  const marker = recovery?.marker ?? `CK-${randomUUID()}`;
  const identifier = recovery?.identifier ?? `CK${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const name = recovery?.name ?? `${marker} 知识🙂`;
  const title = `${marker} 页面`;
  const firstContent = `${marker} published 中文🙂 e\u0301 ' " \\\nSecond line`;
  const secretDraft = `${marker} UNPUBLISHED-SECOND-DRAFT`;
  const english = testInfo.project.use.locale === 'en-US';
  const evidence = knowledgeEvidence(testInfo, marker, identifier);
  const sessions: KnowledgeSession[] = [];
  let session: KnowledgeSession | undefined;
  let spaceId: string | undefined = recovery?.mode === 'resources' ? recovery.spaceId : undefined;
  let pageId: string | undefined = recovery?.mode === 'resources' ? recovery.pageIds[0] : undefined;
  let primaryFailure: unknown;
  const append = evidence.append;
  const assertSpace = (value: any) => {
    expect(value?.id).toBe(spaceId);
    expect(value?.identifier).toBe(identifier);
    expect(value?.name).toBe(name);
    return value;
  };
  const pagePath = () => `/spaces/${spaceId}/article_pages/${pageId}`;
  const assertPage = (value: any) => {
    expect(value?.id).toBe(pageId);
    expect(value?.space_id).toBe(spaceId);
    expect(value?.name).toBe(title);
    return value;
  };
  try {
    session = await loginKnowledgeSession(browser, credentials, evidence, testInfo);
    sessions.push(session);
    if (recovery?.mode === 'resources') {
      evidence.report.contract = 'current-owned-knowledge-resource-recovery-v1';
      assertSpace(await session.request('GET', `/spaces/${spaceId}`));
      evidence.report.stages.priorResourceRecovery = { originalJournalSha256: recovery.journalSha256,
        fullLifecycleExecuted: false };
    } else if (recovery) {
      evidence.report.contract = 'current-owned-knowledge-derived-association-recovery-v1';
      append('prior-derived-recovery-intent', { spaceId: recovery.spaceId,
        journalSha256: recovery.journalSha256, pageIds: recovery.pageIds });
      const spaces = await session.request('POST', '/spaces/fetch_default',
        { page: 0, size: 1000, n_identifier_eq: identifier });
      expect(spaces.filter((row: any) => row.id === recovery.spaceId || row.identifier === identifier
        || row.name === name)).toEqual([]);
      const associations = await cleanupKnowledgeAssociations(session, evidence, recovery);
      evidence.report.cleanup = { status: 'PASS', spaceId: recovery.spaceId,
        previouslyRemovedPages: recovery.pageIds.length, ...associations };
      evidence.report.stages.derivedAssociationRecovery = { status: 'PASS',
        originalJournalSha256: recovery.journalSha256, fullLifecycleExecuted: false };
      append('derived-recovery-complete', evidence.report.cleanup);
    } else {
    const { page } = session;
    await openKnowledgeManagement(page, english);
    await page.locator(`button[title="${english ? 'New Space' : '新建空间'}"]`).click();
    const wizard = page.locator('.ibiz-control-wizardpanel');
    await wizard.getByPlaceholder(english ? 'Enter space name' : '输入空间名称', { exact: true }).fill(name);
    await wizard.locator('.ibiz-form-item').filter({ hasText: english ? 'Space Identifier' : '空间标识' })
      .locator('input').first().fill(identifier);
    await wizard.getByPlaceholder(english ? 'Enter space description' : '输入空间描述', { exact: true }).fill(marker);
    append('space-create-ui-intent', { name, identifier, expectedVisibility: 'private' });
    await wizard.locator('.ibiz-control-wizardpanel-footer')
      .getByRole('button', { name: /^(?:下一步|Next)$/ }).click();
    const creation = await performKnowledgeAction(page, response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${knowledgeApi}/spaces`,
    () => wizard.locator('.ibiz-control-wizardpanel-footer')
      .getByRole('button', { name: /^(?:完成|Complete|Finish)$/ }).click());
    expect(creation.status()).toBe(200);
    const space = await creation.json();
    spaceId = space.id;
    expect(spaceId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    append('space-created', { id: spaceId, identifier, name });
    assertSpace(space);
    expect(space.visibility).toBe('private');
    const home = validateOwnedKnowledgeHome(
      await session.request('GET', `/spaces/${spaceId}/article_pages/${spaceId}`),
      { spaceId: spaceId!, actorId: session.userId() });
    append('space-home-page-observed', { spaceId, id: home.id,
      source: 'space.auto_create_home_page.ID=Default.ID', contentSha256: digest(home.content ?? '') });
    evidence.report.stages.spaceCreate = { status: 'PASS', id: spaceId, visibility: space.visibility };
    const members = await session.request('POST', `/spaces/${spaceId}/space_members/fetch_default`,
      { page: 0, size: 1000 });
    const currentMembership = members.find((member: any) => member.user_id === session!.userId());
    expect(currentMembership?.role_id).toBe('admin');
    evidence.report.stages.createdOwnerMembership = { status: 'PASS', role: currentMembership.role_id,
      source: 'actual-space-members-with-appdata-identity', ordinaryRoleAcceptance: false };
    await expect(page.locator('.ibiz-view--space_index_view')).toBeVisible();
    expect(page.url()).toContain(encodeURIComponent(spaceId!));
    await page.screenshot({ path: testInfo.outputPath('owned-space-after-create.png'), fullPage: true });

    await page.locator('.ibiz-view--article_page_tree_exp_view')
      .getByTitle(english ? 'New' : '新建', { exact: true }).getByRole('button').click();
    const newDocument = page.locator('button:visible').filter({
      hasText: english ? /^New Document$/ : /^新建文档$/,
    });
    await expect(newDocument).toHaveCount(1);
    evidence.report.stages.newDocumentAccessibility = await newDocument.evaluate(element => {
      const hidden = element.closest('[aria-hidden="true"]');
      return { visibleButtonHadHiddenAncestor: Boolean(hidden),
        ancestorTag: hidden?.tagName ?? null, ancestorClass: hidden?.getAttribute('class') ?? null };
    });
    await newDocument.click();
    const editorView = page.locator('.ibiz-view--article_page_qucik_create_view');
    await expect(editorView).toBeVisible();
    await editorView.getByPlaceholder(english ? 'Enter title' : '请输入标题', { exact: true }).fill(title);
    const editor = editorView.locator('.vditor-ir > pre.vditor-reset[contenteditable="true"]').first();
    await expect(editor).toBeVisible();
    await editor.fill(firstContent);
    append('draft-save-ui-intent', { spaceId, title });
    const draftResponse = await performKnowledgeAction(page, response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${knowledgeApi}/spaces/${spaceId}/article_pages`,
    () => page.locator('.ibiz-modal:visible').last().locator('.el-dialog__headerbtn').click());
    expect(draftResponse.status()).toBe(200);
    const draft = await draftResponse.json();
    pageId = draft.id;
    expect(pageId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    append('draft-created', { spaceId, id: pageId, title });
    assertPage(draft);
    expect(Number(draft.is_published || 0)).toBe(0);
    const persistedDraft = assertPage(await session.request('GET', pagePath()));
    expect(persistedDraft.content).toContain(firstContent);
    evidence.report.stages.draftSaved = { status: 'PASS', pageId, published: false };

    const fresh = await loginKnowledgeSession(browser, credentials, evidence, testInfo);
    sessions.push(fresh);
    expect(assertPage(await fresh.request('GET', pagePath())).content).toContain(firstContent);
    evidence.report.stages.freshDraftReadback = { status: 'PASS', newNormalLogin: true };
    await page.locator('button[title="草稿"],button[title="Draft"]').click();
    await page.getByText(title, { exact: true }).first().click();
    await page.locator('button[title="编辑"],button[title="Edit"]').first().click();
    append('publish-ui-intent', { spaceId, pageId });
    const published = await performKnowledgeAction(page, response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/article_pages/publish_page'),
    () => page.locator('button[title="发布"],button[title="Publish"]').last().click());
    expect(published.status()).toBe(200);
    const publishedPage = assertPage(await session.request('GET', pagePath()));
    expect(Number(publishedPage.is_published)).toBe(1);
    expect(publishedPage.publish_content).toContain(firstContent);
    evidence.report.stages.publish = { status: 'PASS', action: 'normal-ui' };

    await expect(page.locator('.ibiz-view--article_page_document_edit_view:visible')).toHaveCount(0);
    const selectedPage = await performKnowledgeAction(page, response => response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `${knowledgeApi}${pagePath()}`,
    () => page.getByRole('treeitem').filter({ hasText: title }).getByText(title, { exact: true }).click());
    expect(selectedPage.status()).toBe(200);
    assertPage(await selectedPage.json());
    await page.locator('button[title="编辑"],button[title="Edit"]').first().click();
    const editedView = page.locator('.ibiz-view--article_page_document_edit_view:visible').last();
    await expect(editedView).toBeVisible();
    await editedView.locator('.vditor-ir > pre.vditor-reset[contenteditable="true"]').first().fill(secretDraft);
    const draftUpdated = await performKnowledgeAction(page, response => response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === `${knowledgeApi}${pagePath()}`,
    () => page.locator('.ibiz-modal__close:visible,.el-dialog__close:visible').last().click());
    expect(draftUpdated.status()).toBe(200);
    const withDraft = assertPage(await session.request('GET', pagePath()));
    expect(withDraft.content).toContain(secretDraft);
    expect(withDraft.publish_content).toContain(firstContent);
    expect(withDraft.publish_content).not.toContain(secretDraft);
    evidence.report.stages.draftPublicationIsolation = { status: 'PASS' };

    append('native-lock-intent', { spaceId, pageId });
    await session.request('POST', `${pagePath()}/lock_page`, {});
    const locked = assertPage(await session.request('GET', pagePath()));
    expect(Number(locked.is_lock)).toBe(1);
    await session.request('PUT', pagePath(), { id: pageId, space_id: spaceId,
      name: title, content: `${marker} FORBIDDEN-LOCKED-WRITE` }, [400, 403]);
    const afterDenial = assertPage(await session.request('GET', pagePath()));
    const protectedReadbackFields = ['name', 'space_id', 'parent_id', 'content', 'publish_content',
      'is_lock', 'is_published', 'cur_version_id', 'cur_version_name', 'publish_time', 'publish_man'];
    for (const field of protectedReadbackFields) expect(afterDenial[field], field).toEqual(locked[field]);
    append('native-unlock-intent', { spaceId, pageId });
    await session.request('POST', `${pagePath()}/unlock_page`, {});
    expect(Number(assertPage(await session.request('GET', pagePath())).is_lock)).toBe(0);
    evidence.report.stages.lockUnlock = { status: 'PASS', lockAction: 'declared-native-api',
      ordinaryOrReadonlyRoleAcceptance: false, rejectedWriteHadNoContentEffect: true,
      protectedReadbackFields, completeAssociatedVersionCollectionAcceptance: false };

    const password = String(1000 + Math.floor(Math.random() * 9000));
    append('share-password-intent', { spaceId, pageId, passwordRecorded: false });
    await session.request('POST', `${pagePath()}/shared_setting`, {
      id: pageId, space_id: spaceId, enable_password: 1, access_password: password,
      enable_expiration: 0, is_shared_subset: 0,
    });
    const shared = await session.request('POST', `${pagePath()}/shared_url`, { id: pageId });
    const publicUrl = shared.shared_page_url;
    expect(typeof publicUrl).toBe('string');
    expect(new URL(publicUrl).origin, 'Use the actual configured local public address without URL rewriting').toBe(knowledgeOrigin);
    const anonymous = await browser.newContext({ locale: english ? 'en-US' : 'zh-CN', serviceWorkers: 'block',
      viewport: testInfo.project.use.viewport as { width: number; height: number },
      isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
    const guest = await anonymous.newPage();
    const anonymousResponses: unknown[] = [];
    const guestPending = new Set<Promise<unknown>>();
    let guestPhase = 'initial';
    let anonymousDraftLeaks = 0;
    guest.on('console', message => {
      if (message.type() === 'error') evidence.report.consoleErrors.push({
        phase: `anonymous-${guestPhase}`, text: message.text(), location: message.location() });
    });
    guest.on('pageerror', error => evidence.report.pageErrors.push({ phase: `anonymous-${guestPhase}`, text: error.message }));
    guest.on('requestfailed', request => evidence.report.failedRequests.push({
      phase: `anonymous-${guestPhase}`, path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    guest.on('response', response => {
      const task = (async () => {
        const url = new URL(response.url());
        const row = { phase: `anonymous-${guestPhase}`, path: url.pathname,
          status: response.status(), method: response.request().method() };
        anonymousResponses.push(row);
        if (response.status() >= 400) {
          if ([400, 403].includes(response.status()) && url.pathname.includes('/api/') &&
              url.pathname.includes(pageId!) && ['initial', 'wrong-password', 'revoked'].includes(guestPhase)) {
            evidence.report.expectedDenials.push(row);
          } else evidence.report.httpErrors.push(row);
        }
        if (url.pathname.includes('/api/') && response.status() === 200) {
          const bytes = await response.body();
          if (bytes.toString('utf8').includes(secretDraft)) anonymousDraftLeaks++;
          evidence.report.apiResponses.push({ ...row, source: 'anonymous-native-response',
            bytes: bytes.length, sha256: digest(bytes),
            unpublishedDraftFound: bytes.toString('utf8').includes(secretDraft) });
        }
      })().catch(error => evidence.report.captureErrors.push(String(error.message)))
        .finally(() => guestPending.delete(task));
      guestPending.add(task);
    });
    const guestQuiet = () => settleKnowledgeCaptures(guestPending);
    try {
      await guest.goto(publicUrl, { waitUntil: 'domcontentloaded' });
      await expect(guest.locator('body')).not.toContainText(secretDraft);
      await expect(guest.locator('body')).not.toContainText(firstContent);
      const passwordInput = guest.locator('input[type="password"],input[placeholder*="密码"],input[placeholder*="password" i]').first();
      await expect(passwordInput).toBeVisible();
      guestPhase = 'wrong-password';
      await passwordInput.fill(password === '9999' ? '0000' : '9999');
      const passwordCheck = () => performKnowledgeAction(guest, response =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/article_pages/${pageId}/check_access_password`),
      () => guest.getByRole('button', { name: /^(?:确定|访问|确认|Confirm|Access|OK)$/ }).click());
      const wrongPassword = await passwordCheck();
      expect(wrongPassword.status()).toBe(200);
      expect(Number((await wrongPassword.json()).check_access_password)).toBe(0);
      await expect(passwordInput).toBeVisible();
      await expect(guest.locator('body')).not.toContainText(firstContent);
      guestPhase = 'correct-password';
      await passwordInput.fill(password);
      const correctPassword = await passwordCheck();
      expect(correctPassword.status()).toBe(200);
      expect(Number((await correctPassword.json()).check_access_password)).toBe(1);
      await expect(guest.locator('body')).toContainText(firstContent);
      await expect(guest.locator('body')).not.toContainText(secretDraft);
      await session.request('POST', `${pagePath()}/closed_shared`, {});
      guestPhase = 'revoked';
      await guest.reload({ waitUntil: 'domcontentloaded' });
      await expect(guest.locator('body')).not.toContainText(firstContent);
      await guestQuiet();
      expect(anonymousDraftLeaks, 'Anonymous response bytes must never include the unpublished draft').toBe(0);
      evidence.report.stages.anonymousShare = { status: 'PASS', actualConfiguredUrl: true,
        anonymousResponses, freshAnonymousContext: true, ownerTokenInjected: false,
        wrongPasswordDenied: true, revokedOldGuestSession: true, unpublishedDraftHidden: true };
    } finally { try { await guestQuiet(); } finally { await anonymous.close(); } }
    await page.reload({ waitUntil: 'domcontentloaded' });
    const final = assertPage(await fresh.request('GET', pagePath()));
    expect(final.publish_content).toContain(firstContent);
    expect(Number(final.is_shared)).toBe(0);
    }
  } catch (error) {
    primaryFailure = error;
    evidence.report.stages.failure = String((error as Error).message);
    if (session) {
      await session.page.screenshot({ path: testInfo.outputPath('retained-failure.png'), fullPage: true }).catch(() => {});
      const controls = await session.page.locator('button:visible,input:visible,textarea:visible').evaluateAll(nodes =>
        nodes.map(node => ({ tag: node.tagName, text: node.textContent?.trim().slice(0, 80),
          title: node.getAttribute('title'), placeholder: node.getAttribute('placeholder') }))).catch(() => []);
      fs.writeFileSync(testInfo.outputPath('failure-controls.private.json'), JSON.stringify(controls, null, 2), { mode: 0o600 });
      const accessible = await session.page.locator('body').ariaSnapshot().catch(() => '');
      fs.writeFileSync(testInfo.outputPath('failure-aria.private.yaml'), accessible, { mode: 0o600 });
    }
  } finally {
    if (session && (!recovery || recovery.mode === 'resources')) {
      try {
        if (!spaceId) {
          const candidates = await session.request('POST', '/spaces/fetch_default',
            { page: 0, size: 1000, n_identifier_eq: identifier });
          const owned = candidates.filter((row: any) => row.identifier === identifier && row.name === name);
          expect(owned.length).toBeLessThanOrEqual(1);
          spaceId = owned[0]?.id;
        }
        if (spaceId) {
          assertSpace(await session.request('GET', `/spaces/${spaceId}`));
          append('cleanup-owned-space-verified', { spaceId, identifier });
          for (const current of sessions) {
            await closeKnowledgeModals(current.page);
            await current.quiet();
            await openKnowledgeManagement(current.page, english);
            await current.quiet();
          }
          append('cleanup-normal-ui-left-owned-space', { sessions: sessions.length });
          const pagesById = new Map<string, any>();
          for (const dataset of ['default', 'draft_page', 'is_deleted']) {
            const rows = await session.request('POST', `/spaces/${spaceId}/article_pages/fetch_${dataset}`,
              { page: 0, size: 1000 });
            for (const row of rows) pagesById.set(row.id, row);
          }
          const pages = [...pagesById.values()];
          for (const row of pages) {
            const owned = { spaceId, title, pageId };
            const validate = (value: any) => row.id === spaceId
              ? validateOwnedKnowledgeHome(value, { spaceId: spaceId!, actorId: session!.userId() })
              : validateOwnedKnowledgePage(value, owned);
            validate(row);
            const current = validate(await session.request('GET', `/spaces/${spaceId}/article_pages/${row.id}`));
            append('cleanup-owned-page-intent', { spaceId, pageId: row.id });
            if (Number(current.is_shared) === 1) {
              await session.request('POST', `/spaces/${spaceId}/article_pages/${row.id}/closed_shared`, {});
            }
            if (Number(current.is_lock) === 1) {
              await session.request('POST', `/spaces/${spaceId}/article_pages/${row.id}/unlock_page`, {});
            }
            await session.request('DELETE', `/spaces/${spaceId}/article_pages/${row.id}`);
          }
          for (const dataset of ['default', 'draft_page', 'is_deleted']) {
            const remainingPages = await session.request('POST', `/spaces/${spaceId}/article_pages/fetch_${dataset}`,
              { page: 0, size: 1000 });
            expect(remainingPages.filter((row: any) => row.space_id === spaceId)).toEqual([]);
          }
          await session.request('DELETE', `/spaces/${spaceId}`);
          const knownPageIds = [...new Set([...pages.map(row => row.id),
            ...(pageId ? [pageId] : []), ...(recovery?.pageIds ?? [])])];
          const associations = await cleanupKnowledgeAssociations(session, evidence,
            { spaceId, identifier, name, pageIds: knownPageIds });
          const remaining = await session.request('POST', '/spaces/fetch_default',
            { page: 0, size: 1000, n_identifier_eq: identifier });
          expect(remaining.filter((row: any) => row.identifier === identifier || row.id === spaceId)).toEqual([]);
          evidence.report.cleanup = { status: 'PASS', spaceId, pagesRemoved: pages.length,
            knownPageIds, remainingSpaces: 0, ...associations };
          append('cleanup-complete', evidence.report.cleanup);
        } else evidence.report.cleanup = { status: 'NO-SPACE-CREATED' };
      } catch (error) {
        evidence.report.cleanup = { status: 'FAILED', spaceId, pageId, error: (error as Error).message };
        append('cleanup-failure', evidence.report.cleanup);
        primaryFailure ??= error;
      }
    } else if (!session) {
      evidence.report.cleanup = { status: 'NO-SPACE-CREATED', normalLoginGateCompleted: false,
        verifiedAppdataObserved: evidence.report.appdata.some((row: any) => row.identityMatches === true) };
    } else if (evidence.report.cleanup.status !== 'PASS') {
      evidence.report.cleanup = { status: 'FAILED', priorDerivedRecovery: true, spaceId: recovery?.spaceId };
      append('derived-recovery-failure', evidence.report.cleanup);
    }
    for (const current of sessions.reverse()) await current.close().catch(error =>
      evidence.report.captureErrors.push(String(error.message)));
    try {
      evidence.report.runtimeAfter = knowledgeRuntimeWitness();
      evidence.report.runtimeComparison = assertKnowledgeRuntimeUnchanged(
        evidence.report.runtimeBefore, evidence.report.runtimeAfter);
      evidence.report.sourceInputsStable = evidence.verifySourceInputs();
    } catch (error) { evidence.report.captureErrors.push(String((error as Error).message)); }
    evidence.report.finishedAt = new Date().toISOString();
    const expectedRejections = [...evidence.report.expectedPreAuth, ...evidence.report.expectedDenials as any[]];
    const unexpectedConsole = evidence.report.consoleErrors.filter(row => !expectedRejections.some(expected =>
      row.text.includes(String(expected.status)) && row.location?.url === `${knowledgeOrigin}${expected.path}`));
    if (!primaryFailure && [unexpectedConsole, evidence.report.pageErrors, evidence.report.failedRequests,
      evidence.report.httpErrors, evidence.report.captureErrors].every(rows => rows.length === 0) &&
      evidence.report.cleanup.status === 'PASS') evidence.report.status = 'PASS';
    fs.writeFileSync(testInfo.outputPath('knowledge-lifecycle-evidence.private.json'),
      JSON.stringify(evidence.report, null, 2), { mode: 0o600 });
  }
  if (primaryFailure) throw primaryFailure;
  expect(evidence.report.status, recovery ? 'Exact prior association cleanup and raw error gates must all pass' :
    'Full lifecycle, cleanup and raw error gates must all pass').toBe('PASS');
});
