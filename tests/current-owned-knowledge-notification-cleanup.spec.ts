import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyProductConsole, createProductEvidence, digest, loginProductSession,
  productApi, productOrigin, type ProductSession,
} from './current-owned-product-helper';
import { assertKnowledgeRuntimeUnchanged, knowledgeRuntimeWitness } from './current-owned-knowledge-helper';
import {
  bindKnowledgeNotificationActor, knowledgeNotificationPrivateRead, loadKnowledgeNotificationSources,
  notificationStateSnapshot, pageAllKnowledgeNotifications, persistableKnowledgeRuntimeWitness, planKnowledgeNotificationCleanup,
  validateKnowledgeNotificationTemplates, validateOwnedKnowledgeNotification,
} from './current-owned-knowledge-notification-contract.mjs';

const workspace = path.resolve(__dirname, '../..');
const extension = '/extension/internal_messages';
const sourcePaths = [
  'plm-e2e/tests/current-owned-knowledge-notification-cleanup.spec.ts',
  'plm-e2e/tests/current-owned-knowledge-notification-contract.mjs',
  'plm-e2e/playwright.current-owned-knowledge-notification-cleanup.config.ts',
  'plm-e2e/config-tests/current-owned-knowledge-notification-cleanup.test.mjs',
  'plm-e2e/tests/current-owned-product-helper.ts',
  'plm-e2e/tests/current-owned-knowledge-helper.ts',
  'plm-e2e/tests/current-owned-knowledge-lifecycle.spec.ts',
  'plm-e2e/playwright.current-owned-knowledge.config.ts',
  'plm/model/PSSYSTEM.json',
];

test('prepare or apply exact source-bound knowledge notification cleanup without changing old receipts',
  async ({ browser }, testInfo) => {
    const mode = process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_MODE ?? 'prepare';
    assert.ok(['prepare', 'apply'].includes(mode));
    assert.equal(process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_EXCLUSIVE_WINDOW, '1',
      'Wait for the root-coordinated stable runtime and exclusive normal-account window');
    assert.equal(productOrigin, 'http://127.0.0.1:30250');
    const credentialsPath = process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_CREDENTIALS;
    assert.ok(credentialsPath && path.isAbsolute(credentialsPath));
    const credentialBytes = knowledgeNotificationPrivateRead(credentialsPath, workspace);
    const credentials = JSON.parse(credentialBytes.toString());
    for (const key of ['username', 'password', 'declaredRole']) {
      assert.ok(typeof credentials[key] === 'string' && credentials[key]);
    }
    const usernameSha256 = digest(credentials.username);
    const sources = loadKnowledgeNotificationSources(usernameSha256, workspace);
    assert.equal(new Set(sources.map((source: any) => source.owned.spaceId)).size, 3);
    const systemBytes = fs.readFileSync(path.join(workspace, 'plm/model/PSSYSTEM.json'));
    const templates = validateKnowledgeNotificationTemplates(JSON.parse(systemBytes.toString()));
    const templateSha256 = digest(JSON.stringify(templates));
    fs.mkdirSync(testInfo.outputDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(testInfo.outputDir, 0o700);
    const write = (name: string, value: unknown) => {
      const filename = testInfo.outputPath(name);
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      const fd = fs.openSync(filename, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const parent = fs.openSync(testInfo.outputDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
      return { path: filename, sha256: digest(bytes) };
    };
    const sourceBindings = sourcePaths.map((relative, index) => {
      const bytes = fs.readFileSync(path.join(workspace, relative));
      const snapshot = testInfo.outputPath(`source-${String(index).padStart(3, '0')}.private.txt`);
      fs.writeFileSync(snapshot, bytes, { flag: 'wx', mode: 0o600 });
      return { path: relative, sha256: digest(bytes), snapshot };
    });
    const marker = `KNOWLEDGE-NOTIFICATION-CLEANUP-${randomUUID()}`;
    const evidence = createProductEvidence(testInfo, marker, credentials);
    evidence.contract = 'current-owned-knowledge-notification-cleanup-v1';
    evidence.stages.mode = mode;
    evidence.stages.sourceKnowledgeReceipts = sources;
    evidence.stages.authoritativeTemplates = { path: 'plm/model/PSSYSTEM.json',
      systemSha256: digest(systemBytes), templatesSha256: templateSha256, codes: Object.keys(templates) };
    evidence.stages.sourceBindings = sourceBindings;
    evidence.stages.notAProductReceipt = true;
    const runtimeBefore = knowledgeRuntimeWitness();
    const runtimeBinding = persistableKnowledgeRuntimeWitness(runtimeBefore);
    evidence.stages.knowledgeRuntimeBefore = runtimeBefore;
    const approvedPath = process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_PLAN;
    const approvedSha256 = process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_PLAN_SHA256;
    let approved: any;
    if (mode === 'apply') {
      assert.equal(process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_DELETE_OWNED, '1');
      assert.ok(approvedPath && path.isAbsolute(approvedPath) && /^[a-f0-9]{64}$/.test(approvedSha256 ?? ''));
      const bytes = knowledgeNotificationPrivateRead(approvedPath, workspace);
      assert.equal(digest(bytes), approvedSha256);
      approved = JSON.parse(bytes.toString());
      assert.equal(approved.contract, 'current-owned-knowledge-notification-plan-v1');
      assert.equal(approved.status, 'PREPARED-NOT-DELETED');
      assert.equal(approved.usernameSha256, usernameSha256);
      assert.equal(approved.templatesSha256, templateSha256);
      assert.deepEqual(approved.sources, sources);
      assert.deepEqual(approved.sourceBindings.map(({ path: file, sha256 }: any) => ({ path: file, sha256 })),
        sourceBindings.map(({ path: file, sha256 }) => ({ path: file, sha256 })));
      assertKnowledgeRuntimeUnchanged(persistableKnowledgeRuntimeWitness(approved.runtimeBinding), runtimeBinding);
    }
    let sequence = 0;
    const journal = (stage: string, value: unknown) => write(
      `event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`, { stage, at: new Date().toISOString(), value });
    let session: ProductSession | undefined;
    let primaryFailure: unknown;
    let proposedPlan: any;
    const deletedIds: string[] = [];
    let requestSerial = 0;
    const request = async (method: string, suffix: string, data?: unknown, expected = [200]) => {
      assert.ok(session);
      assert.ok(suffix === `${extension}/fetch_cur_receiver` || new RegExp(`^${extension}/[A-Za-z0-9_-]{1,100}$`).test(suffix));
      if (expected.length === 1 && expected[0] === 200) return session.requestWithMetadata(method, suffix, data);
      assert.equal(method, 'GET');
      assert.deepEqual(expected, [404]);
      const response = await session.context.request.fetch(`${productOrigin}${productApi}${suffix}`, {
        method, headers: await session.headers(),
      });
      const bytes = await response.body();
      write(`readback-${String(++requestSerial).padStart(3, '0')}.private.json`, {
        method, suffix, status: response.status(), body: bytes.toString('utf8'),
      });
      evidence.apiResponses.push({ source: 'native-ui-session-exact-deleted-notification-readback',
        method, path: `${productApi}${suffix}`, status: response.status(), bytes: bytes.length, sha256: digest(bytes) });
      assert.equal(response.status(), 404);
      return { value: bytes.length ? JSON.parse(bytes.toString('utf8')) : null,
        status: response.status(), headers: response.headers() };
    };
    try {
      journal('source-scope-prepared-before-normal-login', { mode, sources, templateSha256 });
      session = await loginProductSession(browser, credentials, evidence, 'zh-CN', testInfo);
      const identity = await session.identity();
      bindKnowledgeNotificationActor(sources, identity, usernameSha256);
      evidence.stages.currentReceiver = { usernameSha256, userSha256: digest(String(identity.srfuserid)),
        personSha256: digest(String(identity.srfpersonid)), systemSha256: digest(String(identity.srfdcsystemid)),
        source: 'real-normal-ui-login-and-appdata', manufacturedIdentityHeaders: false };
      const allBefore = await pageAllKnowledgeNotifications(request, identity);
      const selection = planKnowledgeNotificationCleanup(allBefore, sources, identity, templates);
      const allBaseline = notificationStateSnapshot(allBefore);
      const unrelatedBaseline = notificationStateSnapshot(selection.unrelated);
      const preflight = [];
      for (const candidate of selection.owned) {
        const current = (await request('GET', `${extension}/${candidate.id}`)).value;
        const owned = sources.find((source: any) => source.owned.marker === candidate.marker)!.owned;
        validateOwnedKnowledgeNotification(current, owned, identity, templates);
        assert.deepEqual(notificationStateSnapshot([current]), notificationStateSnapshot([candidate.record]));
        assert.equal(current.message_type, candidate.record.message_type);
        assert.equal(current.create_time, candidate.record.create_time);
        write(`preflight-owned-${String(preflight.length).padStart(3, '0')}.private.json`, current);
        preflight.push({ ...candidate, record: current });
      }
      assert.deepEqual(notificationStateSnapshot(await pageAllKnowledgeNotifications(request, identity)), allBaseline);
      evidence.stages.completePreflight = { status: 'PASS', pagedCount: allBefore.length,
        exactOwnedCount: preflight.length, unrelatedCount: selection.unrelated.length,
        allCandidatesFetchedBeforeAnyDelete: true, nativeTotalsVerified: true };
      proposedPlan = {
        contract: 'current-owned-knowledge-notification-plan-v1', status: 'PREPARED-NOT-DELETED',
        createdAt: new Date().toISOString(), usernameSha256, identity, sources,
        templatesSha256: templateSha256, sourceBindings, runtimeBinding,
        allBaseline, unrelatedBaseline, candidates: preflight,
        allCandidatesFetchedBeforeAnyDelete: true, readStateChanged: false, sendAuditDeletion: false,
        sourceReceiptsModified: false, productBusinessReceiptUsed: false,
      };
      if (mode === 'apply') {
        assert.deepEqual(proposedPlan.identity, approved.identity);
        assert.deepEqual(proposedPlan.allBaseline, approved.allBaseline);
        assert.deepEqual(proposedPlan.unrelatedBaseline, approved.unrelatedBaseline);
        assert.deepEqual(proposedPlan.candidates, approved.candidates);
        journal('all-owned-candidates-preflight-complete-before-any-delete', {
          approvedPlanSha256: approvedSha256, ids: preflight.map(item => item.id) });
        for (const candidate of preflight) {
          const current = (await request('GET', `${extension}/${candidate.id}`)).value;
          const owned = sources.find((source: any) => source.owned.marker === candidate.marker)!.owned;
          validateOwnedKnowledgeNotification(current, owned, identity, templates);
          assert.deepEqual(notificationStateSnapshot([current]), notificationStateSnapshot([candidate.record]));
          journal('before-exact-owned-notification-delete', {
            id: candidate.id, marker: candidate.marker, template: candidate.template,
            contentSha256: candidate.contentSha256, approvedPlanSha256: approvedSha256 });
          await request('DELETE', `${extension}/${candidate.id}`);
          deletedIds.push(candidate.id);
          await request('GET', `${extension}/${candidate.id}`, undefined, [404]);
          journal('exact-owned-delete-readback-absent', { id: candidate.id });
        }
        const allAfter = await pageAllKnowledgeNotifications(request, identity);
        assert.equal(allAfter.filter((row: any) => sources.some((source: any) =>
          typeof row.content === 'string' && row.content.includes(source.owned.marker))).length, 0);
        const originalUnrelated = allAfter.filter((row: any) =>
          unrelatedBaseline.some((before: any) => before.id === row.id));
        assert.deepEqual(notificationStateSnapshot(originalUnrelated), unrelatedBaseline);
        evidence.stages.unrelatedMessageReadback = { status: 'PASS', count: unrelatedBaseline.length,
          originalStatusesAndContentUnchanged: true, newUnrelatedRowsRetained: allAfter.length - originalUnrelated.length };
        evidence.cleanup = { status: 'PASS', exactIds: deletedIds, remainingOwned: 0,
          allPreflightBeforeDelete: true, receiverAndOwnerBoundToRealAppdata: true,
          unrelatedOriginalMessagesUnchanged: true, sendAuditDeleted: false, sourceReceiptsModified: false };
      } else evidence.cleanup = { status: 'PREPARED-NOT-DELETED', exactIds: preflight.map(item => item.id),
        deleteAttempted: false, readStateChanged: false, sendAuditDeleted: false };
    } catch (error) {
      primaryFailure = error;
      evidence.stages.failure = (error as Error).message;
      evidence.cleanup = { status: 'FAILED-RETAINED-FOR-REVIEW', deletedIds, automaticRetry: false,
        sourceReceiptsModified: false, sendAuditDeleted: false };
    } finally {
      if (session) await session.close();
      try {
        const after = knowledgeRuntimeWitness();
        evidence.stages.knowledgeRuntimeAfter = after;
        evidence.stages.knowledgeRuntimeComparison = assertKnowledgeRuntimeUnchanged(runtimeBefore, after);
        for (const binding of sourceBindings) {
          assert.equal(digest(fs.readFileSync(path.join(workspace, binding.path))), binding.sha256);
        }
        assert.deepEqual(loadKnowledgeNotificationSources(usernameSha256, workspace), sources);
        assert.equal(digest(knowledgeNotificationPrivateRead(credentialsPath, workspace)), digest(credentialBytes));
      } catch (error) {
        evidence.captureErrors.push((error as Error).message);
        primaryFailure ??= error;
      }
      const classification = classifyProductConsole(evidence);
      evidence.expectedPreAuthConsoleErrors = classification.expected;
      evidence.unexpectedConsoleErrors = classification.unexpected;
      evidence.finishedAt = new Date().toISOString();
      const raw = [evidence.unexpectedConsoleErrors, evidence.pageErrors, evidence.failedRequests,
        evidence.httpErrors, evidence.captureErrors];
      if (!primaryFailure && raw.every(rows => rows.length === 0)) {
        if (mode === 'prepare') {
          const prepared = write('prepared.private.json', proposedPlan);
          evidence.stages.preparedPlan = { ...prepared, status: proposedPlan.status,
            exactOwnedCount: proposedPlan.candidates.length };
          evidence.status = 'PREPARED-NOT-DELETED';
        } else if (evidence.cleanup.status === 'PASS') evidence.status = 'PASS-EXACT-OWNED-NOTIFICATIONS-CLEANED';
      }
      journal('finished-with-original-knowledge-failures-retained', {
        status: evidence.status, mode, deletedIds, originalStatuses: sources.map((source: any) => source.owned.originalStatus) });
      write('knowledge-notification-cleanup-evidence.private.json', evidence);
    }
    if (primaryFailure) throw primaryFailure;
    expect(evidence.status).toBe(mode === 'prepare'
      ? 'PREPARED-NOT-DELETED' : 'PASS-EXACT-OWNED-NOTIFICATIONS-CLEANED');
  });
