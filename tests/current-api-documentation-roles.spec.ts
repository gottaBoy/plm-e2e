import { expect, test, type TestInfo } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyProductConsole, createProductEvidence, digest, loginProductSession,
  productApi, productEntry, productJournal, runtimeWitness, assertProductRuntimeUnchanged,
  type ProductSession,
} from './current-owned-product-helper';
import {
  documentationNotificationDigest, documentationNotificationSnapshot,
  documentationStableValue, pageDocumentationNotifications,
} from './current-api-documentation-notifications.mjs';
import {
  assertRoleIdea, assertRoleMessagesUnchanged, cleanupRoleIdea,
  roleIdeaEffectSql as nativeIdeaEffectSnapshotSQL,
} from './current-api-documentation-role-contract.mjs';
import { knowledgeRuntimeWitness, assertKnowledgeRuntimeUnchanged } from './current-owned-knowledge-helper';

const workspace = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(workspace, '.artifacts');
const productFixture = path.join(fixtureRoot, 'native-actors-run-20261124-r7/report.private.json');
const actorFiles: Record<string, string> = {
  ordinary: path.join(fixtureRoot, 'native-actors-run-20261124-r7/ordinary.credentials.private.json'),
  readonly: path.join(fixtureRoot, 'native-actors-run-20261124-r7/readonly.credentials.private.json'),
  objectadmin: path.join(fixtureRoot, 'native-product-admin-20261124-r1/objectadmin.credentials.private.json'),
  nonmember: path.join(fixtureRoot, 'native-actors-run-20261124-r7/nonmember.credentials.private.json'),
  crossorg: path.join(fixtureRoot, 'native-crossorg-20261124-r1/crossorg.credentials.private.json'),
};
const adminCredentials = path.join(fixtureRoot, 'current-business-actors-20261122-r1/credentials.private.json');
const roles = ['admin', 'ordinary', 'objectadmin', 'readonly', 'nonmember', 'crossorg'] as const;
type Role = typeof roles[number];
type Credentials = { username: string; password: string; declaredRole: string; userId?: string;
  personId?: string; productId?: string; productRole?: string | null; organizationId?: string };

function privateJson(filename: string) {
  const info = fs.lstatSync(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid === process.geteuid()
    && (info.mode & 0o077) === 0, `Private credential or fixture receipt is not safe: ${filename}`);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function boundedEvidence(testInfo: TestInfo, marker: string, credentials: Credentials) {
  const evidence: any = createProductEvidence(testInfo, marker, credentials);
  evidence.contract = 'current-native-api-documentation-authenticated-roles-v1';
  evidence.fullB03Acceptance = false;
  evidence.fullLocalizationAcceptance = false;
  evidence.roleMatrixAcceptance = false;
  evidence.restrictedOrganizationAdminEstablished = false;
  evidence.realtimeAcceptance = false;
  evidence.ownedIdea = { marker };
  evidence.roleAccounts = {};
  evidence.notificationSnapshots = [];
  evidence.effectSnapshots = [];
  evidence.expectedControlledApiRefusals = [];
  return evidence;
}

function sha(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function stableIdea(value: any) {
  return documentationStableValue(value);
}

function fixtureCredentials() {
  const result: Record<Role, Credentials> = {
    admin: privateJson(adminCredentials),
    ordinary: privateJson(actorFiles.ordinary),
    objectadmin: privateJson(actorFiles.objectadmin),
    readonly: privateJson(actorFiles.readonly),
    nonmember: privateJson(actorFiles.nonmember),
    crossorg: privateJson(actorFiles.crossorg),
  };
  for (const role of roles) result[role].declaredRole ??= result[role].productRole ?? role;
  return result;
}

function requestFor(session: ProductSession, evidence: any, role: string) {
  return async (method: string, suffix: string, body?: unknown, expected = [200]) => {
    assert.ok(suffix.startsWith('/') && !suffix.includes('..'));
    const response = await session.context.request.fetch(`${new URL(productEntry).origin}${productApi}${suffix}`, {
      method, headers: await session.headers(),
      ...(body === undefined ? {} : { data: body }),
    });
    const raw = await response.body();
    let value: any = null;
    if (raw.length) value = JSON.parse(raw.toString('utf8'));
    const observation = { source: 'normal-ui-issued-headers', role, method,
      path: `${productApi}${suffix}`, status: response.status(), bytes: raw.length, sha256: sha(raw) };
    evidence.apiResponses.push(observation);
    if (!expected.includes(response.status())) evidence.httpErrors.push(observation);
    else if (response.status() >= 400) evidence.expectedControlledApiRefusals.push(observation);
    return { status: response.status(), value, headers: response.headers(), raw };
  };
}

async function notificationRows(session: ProductSession, role: Role, evidence: any) {
  const request = requestFor(session, evidence, role);
  const rows = await pageDocumentationNotifications(async (method, suffix, data) => {
    const result = await request(method, suffix, data);
    return { status: result.status, value: result.value, headers: result.headers };
  }, await session.identity());
  return rows;
}

function readOnlyEffectSnapshot(productId: string, actorId: string, providedId: string, marker: string, title: string) {
  const sql = nativeIdeaEffectSnapshotSQL({ productId, actorId, id: providedId, marker, title });
  if (process.env.PLM_CURRENT_API_DOCUMENTATION_ROLES_READONLY_SQL !== '1') {
    return { status: 'NOT_RUN_NO_DOCKER', sqlSha256: documentationNotificationDigest(sql),
      physicalDatabaseRead: false };
  }
  const inspect = spawnSync('docker', ['inspect', 'mysql'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(inspect.status, 0);
  const mysql = JSON.parse(inspect.stdout)[0];
  assert.equal(mysql.State.Status, 'running');
  const result = spawnSync('docker', ['exec', '-i', mysql.Id, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
  { input: sql, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0);
  return { status: 'PASS_READ_ONLY', physicalDatabaseRead: true, value: JSON.parse(result.stdout.trim()),
    sqlSha256: documentationNotificationDigest(sql) };
}

function assertStableEffect(before: any, after: any) {
  if (before.status === 'PASS_READ_ONLY' && after.status === 'PASS_READ_ONLY') {
    assert.deepEqual(after.value, before.value);
    return true;
  }
  return false;
}

test('normal-UI authenticated B03 role gate uses the retained shared product fixture', async ({ browser }, testInfo) => {
  const fixture = privateJson(productFixture);
  assert.equal(fixture.status, 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED');
  assert.equal(fixture.retainedForMatrix, true);
  assert.equal(fixture.product.createdByThisRun, true);
  const productId = fixture.product.id;
  const credentials = fixtureCredentials();
  for (const role of ['ordinary', 'readonly', 'objectadmin', 'nonmember', 'crossorg'] as const) {
    assert.equal(credentials[role].productId, productId);
  }
  const marker = `CD-${randomUUID()}`;
  const identifier = `CD${Date.now().toString().slice(-12)}`;
  const title = `${marker} idea`;
  const providedId = randomBytes(16).toString('hex');
  const scope = { productId, id: providedId, marker };
  const titles = [title, `${title} updated`, `${title} objectadmin`,
    ...['readonly', 'nonmember', 'crossorg'].flatMap(role =>
      [`${title} unauthorized ${role}`, `${title} save unauthorized ${role}`])];
  const evidence: any = boundedEvidence(testInfo, marker, credentials.admin);
  evidence.productId = productId;
  evidence.rawMqttPackets = evidence.mqttPackets;
  evidence.identifier = identifier;
  evidence.roleDeclarations = { admin: credentials.admin.declaredRole ?? 'admin',
    objectadmin: 'product-object-admin', ordinary: 'product-member',
    readonly: 'product-readonly-member', nonmember: 'product-nonmember',
    crossorg: 'cross-organization-user', restrictedOrganizationAdmin: 'NOT_ESTABLISHED' };
  const journal = productJournal(testInfo, evidence);
  const sessions = new Map<Role, ProductSession>();
  const identities = new Map<Role, any>();
  const requests = new Map<Role, ReturnType<typeof requestFor>>();
  let productIdeaId: string | undefined;
  let creationAttempted = false;
  let primaryFailure: unknown;
  const notificationBaselines = new Map<Role, any[]>();
  const runtimeBefore = knowledgeRuntimeWitness();
  evidence.knowledgeRuntimeBefore = runtimeBefore;
  const sourcePaths = ['plm-e2e/tests/current-api-documentation-roles.spec.ts',
    'plm-e2e/tests/current-api-documentation-role-contract.mjs',
    'plm-e2e/tests/current-owned-product-helper.ts', 'plm-e2e/tests/current-owned-knowledge-helper.ts',
    'plm-e2e/tests/current-api-documentation-notifications.mjs',
    'plm-e2e/playwright.current-api-documentation-roles.config.ts',
    'plm/model/PSSYSSERVICEAPIS/ServiceAPI.json',
    'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/product_member.json'];
  evidence.executedProbeSources = sourcePaths.map((relative, index) => {
    const bytes = fs.readFileSync(path.join(workspace, relative));
    const snapshot = testInfo.outputPath(`role-source-${index}.private.txt`);
    fs.writeFileSync(snapshot, bytes, { flag: 'wx', mode: 0o600 });
    return { path: relative, sha256: sha(bytes), snapshot };
  });
  try {
    for (const role of roles) {
      const session = await loginProductSession(browser, credentials[role], evidence, 'zh-CN', testInfo,
        { businessEventMode: 'observe' });
      sessions.set(role, session);
      identities.set(role, await session.identity());
      for (const [key, expected] of [['srfuserid', credentials[role].userId],
        ['srfpersonid', credentials[role].personId], ['srforgid', credentials[role].organizationId]]) {
        if (expected) assert.equal(identities.get(role)[key], expected);
      }
      const loaded = evidence.resourceBindings.filter((resource: any) =>
        resource.path.endsWith('/runtime/lifecycle-529c247dced450f2/index.system.min.js'));
      assert.ok(loaded.length > 0);
      assert.ok(loaded.every((resource: any) =>
        resource.sha256 === '529c247dced450f20772ca70ac7320ab4201c999af4eb85c40da9f873258c009'));
      requests.set(role, requestFor(session, evidence, role));
      evidence.roleAccounts[role] = { usernameSha256: digest(credentials[role].username),
        productRole: credentials[role].productRole ?? null, organizationId: credentials[role].organizationId ?? null,
        normalUiLogin: true, tokenInjected: false, identity: identities.get(role) };
    }
    const adminRequest = requests.get('admin')!;
    const members = await sessions.get('admin')!.request('POST', `/products/${productId}/product_members/fetch_default`,
      { page: 0, size: 1000 });
    const expectedMembers = new Map(Object.entries(credentials).map(([role, value]) => [value.userId, role]));
    for (const member of members) {
      if (expectedMembers.has(member.user_id)) evidence.roleAccounts[expectedMembers.get(member.user_id)!].memberReadback = {
        id: member.id, role: member.role_id,
      };
    }
    for (const [role, expected] of [['ordinary', 'user'], ['readonly', 'reader'], ['objectadmin', 'admin']] as const) {
      assert.equal(evidence.roleAccounts[role].memberReadback?.role, expected);
    }
    for (const role of ['nonmember', 'crossorg'] as const) {
      assert.equal(evidence.roleAccounts[role].memberReadback, undefined);
    }
    assert.equal((await adminRequest('GET', `/products/${productId}`)).status, 200);
    for (const role of roles) {
      notificationBaselines.set(role, await notificationRows(sessions.get(role)!, role, evidence));
    }
    const ordinary = requests.get('ordinary')!;
    const beforeCreate = readOnlyEffectSnapshot(productId, credentials.ordinary.personId!, providedId, marker, title);
    if (beforeCreate.status === 'PASS_READ_ONLY') {
      assert.equal(beforeCreate.value.plannedIdeaRows, 0);
      assert.equal(beforeCreate.value.ownPrefixIdeaRows, 0);
    }
    creationAttempted = true;
    journal('before-owned-idea-create');
    const create = await ordinary('POST', `/products/${productId}/ideas`, {
      id: providedId, title, product_id: productId, state: '10',
    });
    assertRoleIdea(create, scope, title);
    productIdeaId = create.value?.id;
    assert.equal(productIdeaId, providedId);
    evidence.create = { status: 'PASS', method: 'POST', path: `/products/${productId}/ideas`,
      id: productIdeaId, title, productId };
    const ordinaryAfterCreate = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
    assertRoleIdea(ordinaryAfterCreate, scope, title);
    const afterCreate = readOnlyEffectSnapshot(productId, credentials.ordinary.personId!, providedId, marker, title);
    if (afterCreate.status === 'PASS_READ_ONLY') {
      assert.equal(afterCreate.value.plannedIdeaRows, 1);
      assert.equal(afterCreate.value.ownPrefixIdeaRows, 1);
    }
    evidence.createEffects = { before: beforeCreate, after: afterCreate };
    const allowed = ['admin', 'ordinary', 'objectadmin', 'readonly'] as Role[];
    for (const role of allowed) {
      const result = await requests.get(role)!('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assertRoleIdea(result, scope, title);
    }
    for (const role of ['nonmember', 'crossorg'] as Role[]) {
      const result = await requests.get(role)!('GET', `/products/${productId}/ideas/${productIdeaId}`, undefined, [403, 404]);
      assert.ok([403, 404].includes(result.status));
      evidence.expectedControlledApiRefusals.push({ role, method: 'GET', status: result.status });
    }
    const beforeRefusal = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
    const refusalRoles: Role[] = ['readonly', 'nonmember', 'crossorg'];
    for (const role of refusalRoles) {
      const before = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        marker, `${title} unauthorized ${role}`);
      const update = await requests.get(role)!('PUT', `/products/${productId}/ideas/${productIdeaId}`,
        { id: productIdeaId, product_id: productId, title: `${title} unauthorized ${role}` }, [403, 404]);
      assert.ok([403, 404].includes(update.status));
      const after = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        marker, `${title} unauthorized ${role}`);
      const physicalUpdateStable = assertStableEffect(before, after);
      const readback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.deepEqual(stableIdea(readback.value), stableIdea(beforeRefusal.value));
      evidence.effectSnapshots.push({ role, operation: 'PUT', before, after,
        businessProjectionUnchanged: true, physicalSideEffectsUnchanged: physicalUpdateStable,
        physicalSideEffectsStatus: before.status, status: update.status });
      const saveBefore = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        marker, `${title} save unauthorized ${role}`);
      const save = await requests.get(role)!('POST', '/ideas/save',
        { id: productIdeaId, product_id: productId, title: `${title} save unauthorized ${role}` }, [403, 404]);
      assert.ok([403, 404].includes(save.status));
      const saveAfter = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        marker, `${title} save unauthorized ${role}`);
      const physicalSaveStable = assertStableEffect(saveBefore, saveAfter);
      const saveReadback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.deepEqual(stableIdea(saveReadback.value), stableIdea(beforeRefusal.value));
      evidence.effectSnapshots.push({ role, operation: 'POST /ideas/save', status: save.status,
        before: saveBefore, after: saveAfter, businessProjectionUnchanged: true,
        physicalSideEffectsUnchanged: physicalSaveStable, physicalSideEffectsStatus: saveBefore.status });
      const deleteBefore = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        marker, title);
      const remove = await requests.get(role)!('DELETE', `/products/${productId}/ideas/${productIdeaId}`, undefined, [403, 404]);
      assert.ok([403, 404].includes(remove.status));
      const deleteAfter = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        marker, title);
      const physicalDeleteStable = assertStableEffect(deleteBefore, deleteAfter);
      const removeReadback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assertRoleIdea(removeReadback, scope, title);
      assert.deepEqual(stableIdea(removeReadback.value), stableIdea(beforeRefusal.value));
      evidence.effectSnapshots.push({ role, operation: 'DELETE', status: remove.status,
        before: deleteBefore, after: deleteAfter, businessProjectionUnchanged: true,
        physicalSideEffectsUnchanged: physicalDeleteStable, physicalSideEffectsStatus: deleteBefore.status });
    }
    evidence.physicalEffectGate = {
      status: process.env.PLM_CURRENT_API_DOCUMENTATION_ROLES_READONLY_SQL === '1'
        ? 'PASS_READ_ONLY' : 'NOT_RUN_NO_DOCKER',
      allObservedRefusalSnapshotsStable: evidence.effectSnapshots
        .filter((snapshot: any) => snapshot.before && snapshot.after)
        .every((snapshot: any) => snapshot.physicalSideEffectsUnchanged === true),
      sqlWriteCount: 0,
    };
    const ordinaryUpdate = await ordinary('PUT', `/products/${productId}/ideas/${productIdeaId}`,
      { id: productIdeaId, product_id: productId, title: `${title} updated` });
    assertRoleIdea(ordinaryUpdate, scope, `${title} updated`);
    assertRoleIdea(await adminRequest('GET', `/products/${productId}/ideas/${productIdeaId}`), scope, `${title} updated`);
    const objectAdminUpdate = await requests.get('objectadmin')!('PUT',
      `/products/${productId}/ideas/${productIdeaId}`,
      { id: productIdeaId, product_id: productId, title: `${title} objectadmin` });
    assertRoleIdea(objectAdminUpdate, scope, `${title} objectadmin`);
    const saveReadback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
    assertRoleIdea(saveReadback, scope, `${title} objectadmin`);
    await sessions.get('ordinary')!.close();
    sessions.delete('ordinary');
    const freshOrdinary = await loginProductSession(browser, credentials.ordinary, evidence, 'zh-CN', testInfo,
      { businessEventMode: 'observe' });
    sessions.set('ordinary', freshOrdinary);
    try {
      const freshRequest = requestFor(freshOrdinary, evidence, 'ordinary-fresh');
      const freshRead = await freshRequest('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assertRoleIdea(freshRead, scope, `${title} objectadmin`);
      evidence.freshSessionReadback = { status: 'PASS', ideaId: productIdeaId };
    } finally { await freshOrdinary.quiet(); }
    evidence.authenticatedRoleGate = { status: 'PASS', roleCount: 6,
      restrictedOrganizationAdmin: 'NOT_ESTABLISHED', realtimeAcceptance: false };
  } catch (error) {
    evidence.failure = String((error as Error).message);
    primaryFailure = error;
  } finally {
    if (creationAttempted && sessions.has('admin')) {
      try {
        const admin = requests.get('admin')!;
        evidence.cleanup = await cleanupRoleIdea({
          request: (method: string, suffix: string, data?: unknown) =>
            admin(method, suffix, data, method === 'GET' ? [200, 404] : [200]),
          scope, titles,
          journal: (stage: string) => journal(stage),
          physical: () => readOnlyEffectSnapshot(productId, credentials.ordinary.personId!, providedId, marker, title),
        });
      } catch (error) {
        evidence.cleanup = { status: 'FAILED-RETAINED', id: providedId, error: String(error) };
        primaryFailure ??= error;
      }
    } else evidence.cleanup = { status: 'NO-WRITE-INTENT' };
    for (const [role, baseline] of notificationBaselines) {
      try {
        const after = await notificationRows(sessions.get(role)!, role, evidence);
        evidence.notificationSnapshots.push({ role,
          ...assertRoleMessagesUnchanged(baseline, after, marker),
          before: documentationNotificationSnapshot(baseline), after: documentationNotificationSnapshot(after) });
      } catch (error) {
        evidence.captureErrors.push(`Notification readback ${role}: ${String(error)}`);
        primaryFailure ??= error;
      }
    }
    for (const session of [...sessions.values()].reverse()) await session.close();
    evidence.runtimeAfter = runtimeWitness();
    evidence.runtimeComparison = assertProductRuntimeUnchanged(evidence.runtimeBefore, evidence.runtimeAfter);
    try {
      evidence.knowledgeRuntimeComparison = assertKnowledgeRuntimeUnchanged(runtimeBefore, knowledgeRuntimeWitness());
      for (const source of evidence.executedProbeSources) {
        assert.equal(sha(fs.readFileSync(path.join(workspace, source.path))), source.sha256);
      }
    } catch (error) { evidence.captureErrors.push(String(error)); primaryFailure ??= error; }
    const classification = classifyProductConsole(evidence);
    evidence.expectedPreAuthConsoleErrors = classification.expected;
    evidence.unexpectedConsoleErrors = classification.unexpected;
    evidence.finishedAt = new Date().toISOString();
    evidence.status = !primaryFailure && evidence.cleanup?.status === 'PASS' && evidence.authenticatedRoleGate?.status === 'PASS'
      && evidence.unexpectedConsoleErrors.length === 0 && evidence.pageErrors.length === 0
      && evidence.failedRequests.length === 0 && evidence.httpErrors.length === 0 && evidence.captureErrors.length === 0
      ? 'PASS-AUTHENTICATED-ROLE-GATE' : 'FAILED';
    journal('finished-authenticated-role-gate');
    const output = testInfo.outputPath('api-documentation-roles-evidence.private.json');
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  if (primaryFailure) throw primaryFailure;
  expect(evidence.status).toBe('PASS-AUTHENTICATED-ROLE-GATE');
});
