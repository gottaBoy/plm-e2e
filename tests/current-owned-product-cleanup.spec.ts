import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import {
  assertProductRuntimeUnchanged, classifyProductConsole, createProductEvidence, digest, loadProductCredentials, loginProductSession,
  productJournal, runtimeWitness, validateOwnedProductMember, validateOwnedProductRecord,
} from './current-owned-product-helper';

test('exact cleanup of a journaled failed product keeps all errors and verifies product and membership absence',
  async ({ browser }, testInfo) => {
    const source = process.env.PLM_CURRENT_PRODUCT_CLEANUP_SOURCE;
    if (!source) throw new Error('An explicit private owned failure receipt is required for cleanup');
    const info = fs.lstatSync(source);
    expect(info.isFile() && !info.isSymbolicLink() && info.uid === process.geteuid() && (info.mode & 0o077) === 0).toBe(true);
    const previousBytes = fs.readFileSync(source);
    const previous = JSON.parse(previousBytes.toString('utf8'));
    expect(previous.contract).toBe('current-owned-product-lifecycle-v1');
    expect(previous.status).toBe('FAILED');
    expect(previous.marker).toMatch(/^CP-[a-f0-9-]{36}$/);
    const owned = previous.stages.ownedInput;
    expect(owned.marker).toBe(previous.marker);
    expect(owned.identifier).toMatch(/^CP\d{12}$/);
    const productId = previous.cleanup.productId;
    expect(productId).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
    const credentials = loadProductCredentials();
    const evidence = createProductEvidence(testInfo, previous.marker, credentials);
    evidence.contract = 'exact-owned-failed-product-cleanup-v1';
    evidence.stages.previousFailure = { path: source, sha256: digest(previousBytes) };
    const journal = productJournal(testInfo, evidence);
    journal('prepared-exact-owned-cleanup');
    let session;
    try {
      session = await loginProductSession(browser, credentials, evidence, 'zh-CN', testInfo);
      const list = async () => (await Promise.all(['main', 'archived', 'deleted'].map(dataset =>
        session!.request('POST', `/products/fetch_${dataset}`, { page: 0, size: 1000, n_identifier_eq: owned.identifier }))))
        .flat().filter(row => row.identifier === owned.identifier || row.id === productId);
      const products = await list();
      expect(products.length).toBeLessThanOrEqual(1);
      for (const product of products) validateOwnedProductRecord(product, {
        id: productId, identifier: owned.identifier, names: [owned.name, owned.editedName],
      });
      evidence.stages.beforeProductIds = products.map(row => row.id);
      const members = async () => {
        const rows = await session!.request('POST', '/product_members/fetch_default', {
          page: 0, size: 1000, n_product_id_eq: productId,
        });
        expect(Array.isArray(rows)).toBe(true);
        rows.forEach((row: any) => validateOwnedProductMember(row, productId));
        return rows;
      };
      const beforeMembers = await members();
      evidence.stages.beforeMemberIds = beforeMembers.map((row: any) => row.id);
      const nativeErrors: string[] = [];
      for (const member of beforeMembers) {
        evidence.cleanup.pendingMemberId = member.id;
        journal('before-exact-owned-member-remove');
        try { await session.request('DELETE', `/product_members/${member.id}`); }
        catch (error) { nativeErrors.push((error as Error).message); }
      }
      expect(await members(), 'The actual post-failure state must have no owned memberships').toEqual([]);
      if (products.length) {
        journal('before-exact-owned-product-remove');
        try { await session.request('DELETE', `/products/${productId}`); }
        catch (error) { nativeErrors.push((error as Error).message); }
      }
      expect(await list(), 'Active, archived and deleted native product reads must all be empty for the exact owned marker').toEqual([]);
      expect(await members()).toEqual([]);
      evidence.cleanup = { status: 'COMPLETE', productId, productRowsRemaining: 0, memberRowsRemaining: 0,
        nativeErrors, featureAcceptance: false };
      evidence.status = 'CLEANED-EXACT-OWNED-RECORDS-ONLY';
    } finally {
      await session?.close();
      evidence.runtimeAfter = runtimeWitness();
      try {
        evidence.runtimeComparison = assertProductRuntimeUnchanged(evidence.runtimeBefore, evidence.runtimeAfter);
      } catch (error) { evidence.captureErrors.push((error as Error).message); }
      const classification = classifyProductConsole(evidence);
      evidence.expectedPreAuthConsoleErrors = classification.expected;
      evidence.unexpectedConsoleErrors = classification.unexpected;
      evidence.finishedAt = new Date().toISOString();
      journal('finished-exact-owned-cleanup');
      fs.writeFileSync(testInfo.outputPath('cleanup-evidence.private.json'), `${JSON.stringify(evidence, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 });
    }
    expect(evidence.cleanup.status).toBe('COMPLETE');
    expect(evidence.runtimeComparison?.status).toBe('PASS');
  });
