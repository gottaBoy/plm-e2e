import { expect, test, type Browser, type TestInfo } from '@playwright/test';
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
  pageDocumentationNotifications,
} from './current-api-documentation-notifications.mjs';

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
  const evidence: any = createProductEvidence(testInfo, `ROLE-${randomUUID()}`, credentials);
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
  return Object.fromEntries(['id', 'title', 'product_id', 'state', 'create_man', 'update_man',
    'update_time', 'is_deleted', 'is_archived'].map(key => [key, value?.[key] ?? null]));
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
  return async (method: string, suffix: string, body?: unknown) => {
    assert.ok(suffix.startsWith('/') && !suffix.includes('..'));
    const response = await session.context.request.fetch(`${new URL(productEntry).origin}${productApi}${suffix}`, {
      method, headers: await session.headers(),
      ...(body === undefined ? {} : { data: body }),
    });
    const raw = await response.body();
    let value: any = null;
    try { value = raw.length ? JSON.parse(raw.toString('utf8')) : null; } catch {}
    evidence.apiResponses.push({ source: 'normal-ui-issued-headers', role, method,
      path: `${productApi}${suffix}`, status: response.status(), bytes: raw.length, sha256: sha(raw) });
    return { status: response.status(), value, headers: response.headers(), raw };
  };
}

async function notificationRows(session: ProductSession, role: Role) {
  const request = requestFor(session, { apiResponses: [] }, role);
  const rows = await pageDocumentationNotifications(async (method, suffix, data) => {
    const result = await request(method, suffix, data);
    return { status: result.status, value: result.value, headers: result.headers };
  }, await session.identity());
  return rows;
}

function notificationScope(rows: any[], marker: string, identity: any, startedAt: number,
  ownerIds = new Set([identity.srfuserid, identity.srfpersonid])) {
  return rows.filter(row => typeof row.content === 'string' && row.content.includes(marker)
    && row.receiver === identity.srfuserid && row.system_tag === identity.srfdcsystemid
    && ownerIds.has(row.owner_id)
    && Date.parse(String(row.create_time).replace(' ', 'T') + '+08:00') >= startedAt - 120_000);
}

function nativeIdeaEffectSnapshotSQL(productId: string, actorId: string, providedId: string,
  marker: string, titleMarker: string) {
  assert.match(productId, /^[a-f0-9]{32}$/);
  assert.match(providedId, /^[a-f0-9]{32}$/);
  assert.match(actorId, /^nat_[a-f0-9]{12}_(?:ordinary|readonly|nonmember|crossorg)$/);
  assert.match(marker, /^Native ACL native-product-role-matrix-[A-Za-z0-9-]+$/);
  assert.ok(titleMarker.startsWith(marker) && titleMarker.length <= 200
    && /^[A-Za-z0-9 -]+$/.test(titleMarker));
  const literal = (value: string) => `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
  const product = literal(productId), actor = literal(actorId), id = literal(providedId);
  const prefix = literal(marker), title = literal(titleMarker);
  const sequence = ' FROM `plm`.`SEQUENCE_GENERATOR`'
    + ` WHERE \`NAME\`='seq_idea_id' AND \`GROUP_TAG\`=${product}`;
  const entries = [
    "'sequenceRows',(SELECT COUNT(*)" + sequence + ')',
    "'sequenceMin',(SELECT MIN(`CURRENT_VALUE`)" + sequence + ')',
    "'sequenceMax',(SELECT MAX(`CURRENT_VALUE`)" + sequence + ')',
    "'ownProductIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `PRODUCT_ID`=" + product + ')',
    "'ownPrefixIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `PRODUCT_ID`=" + product
      + ` AND LOCATE(${prefix},\`TITLE\`)>0)`,
    "'plannedIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `ID`=" + id + ')',
    "'actorIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `PRODUCT_ID`=" + product
      + ` AND \`CREATE_MAN\`=${actor})`,
    "'actorVersionRows',(SELECT COUNT(*) FROM `plm`.`VERSION` WHERE `CREATE_MAN`=" + actor + ')',
    "'plannedVersionRows',(SELECT COUNT(*) FROM `plm`.`VERSION` WHERE `OWNER_ID`=" + id + ')',
    "'actorRecentRows',(SELECT COUNT(*) FROM `plm`.`RECENT` WHERE `CREATE_MAN`=" + actor
      + ` AND \`RECENT_PARENT\`=${product})`,
    "'plannedRecentRows',(SELECT COUNT(*) FROM `plm`.`RECENT` WHERE `OWNER_ID`=" + id + ')',
    "'plannedInternalMessageRows',(SELECT COUNT(*) FROM `a_lab01_3f9ebc219`.`INTERNAL_MESSAGE` WHERE `OWNER_ID`=" + id + ')',
    "'actorInternalMessageRows',(SELECT COUNT(*) FROM `a_lab01_3f9ebc219`.`INTERNAL_MESSAGE` WHERE `CREATE_MAN`=" + actor + ')',
    "'titleInternalMessageRows',(SELECT COUNT(*) FROM `a_lab01_3f9ebc219`.`INTERNAL_MESSAGE`"
      + ` WHERE LOCATE(${title},\`TITLE\`)>0 OR LOCATE(${title},\`SHORT_CONTENT\`)>0`
      + ` OR LOCATE(${title},\`CONTENT\`)>0)`,
  ];
  return `START TRANSACTION READ ONLY;\nSELECT JSON_OBJECT(${entries.join(',')});\nCOMMIT;\n`;
}

async function deleteOwnedNotifications(session: ProductSession, evidence: any, marker: string,
  baseline: any[], role: Role, startedAt: number, ownerIds: Set<string>) {
  const identity = await session.identity();
  const request = requestFor(session, evidence, role);
  const rows = await pageDocumentationNotifications(async (method, suffix, data) => {
    const result = await request(method, suffix, data);
    return { status: result.status, value: result.value, headers: result.headers };
  }, identity);
  const owned = notificationScope(rows, marker, identity, startedAt, ownerIds);
  const baselineIds = new Set(baseline.map(row => row.id));
  assert.ok(owned.every(row => !baselineIds.has(row.id)));
  for (const row of owned) {
    const read = await request('GET', `/extension/internal_messages/${row.id}`);
    assert.equal(read.status, 200);
    assert.ok(notificationScope([read.value], marker, identity, startedAt, ownerIds).length === 1);
  }
  for (const row of owned) {
    const removed = await request('DELETE', `/extension/internal_messages/${row.id}`);
    assert.equal(removed.status, 200);
    const absent = await request('GET', `/extension/internal_messages/${row.id}`);
    assert.equal(absent.status, 404);
  }
  const after = await pageDocumentationNotifications(async (method, suffix, data) => {
    const result = await request(method, suffix, data);
    return { status: result.status, value: result.value, headers: result.headers };
  }, identity);
  assert.equal(notificationScope(after, marker, identity, startedAt, ownerIds).length, 0);
  const originalIds = new Set(baseline.map(row => row.id));
  assert.deepEqual(documentationNotificationSnapshot(after.filter(row => originalIds.has(row.id))),
    documentationNotificationSnapshot(baseline));
  evidence.notificationSnapshots.push({ role, before: documentationNotificationSnapshot(baseline),
    owned: documentationNotificationSnapshot(owned), after: documentationNotificationSnapshot(after),
    zeroOwnedAfter: true, actualKeyed404: owned.length ? true : null,
    sendAuditDeleted: false, recentRecordsDeleted: false,
    physicalDatabaseTotalInvarianceClaimed: false });
  return owned;
}

function readOnlyEffectSnapshot(productId: string, actorId: string, providedId: string, marker: string, title: string) {
  const sql = nativeIdeaEffectSnapshotSQL(productId, actorId, providedId, marker, title);
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
  const effectMarker = `Native ACL native-product-role-matrix-${randomUUID().replaceAll('-', '')}`;
  const identifier = `CD${Date.now().toString().slice(-12)}`;
  const title = `${marker} idea`;
  const providedId = randomBytes(16).toString('hex');
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
  const notificationBaselines = new Map<Role, any[]>();
  const startedAt = Date.now();
  try {
    for (const role of roles) {
      const session = await loginProductSession(browser, credentials[role], evidence, 'zh-CN', testInfo);
      sessions.set(role, session);
      identities.set(role, await session.identity());
      requests.set(role, requestFor(session, evidence, role));
      evidence.roleAccounts[role] = { usernameSha256: digest(credentials[role].username),
        productRole: credentials[role].productRole ?? null, organizationId: credentials[role].organizationId ?? null,
        normalUiLogin: true, tokenInjected: false, identity: identities.get(role) };
    }
    const ownerIds = new Set([...identities.values()].flatMap(identity =>
      [identity.srfuserid, identity.srfpersonid].filter(Boolean)));
    const adminRequest = requests.get('admin')!;
    const members = await sessions.get('admin')!.request('POST', `/products/${productId}/product_members/fetch_default`,
      { page: 0, size: 1000 });
    const expectedMembers = new Map(Object.entries(credentials).map(([role, value]) => [value.userId, role]));
    for (const member of members) {
      if (expectedMembers.has(member.user_id)) evidence.roleAccounts[expectedMembers.get(member.user_id)!].memberReadback = {
        id: member.id, role: member.role_id ?? member.product_role ?? member.role ?? null,
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
      notificationBaselines.set(role, await notificationRows(sessions.get(role)!, role));
    }
    const ordinary = requests.get('ordinary')!;
    const create = await ordinary('POST', `/products/${productId}/ideas`, {
      id: providedId, title, product_id: productId, state: '10',
    });
    assert.equal(create.status, 200);
    productIdeaId = create.value?.id;
    assert.equal(productIdeaId, providedId);
    evidence.create = { status: 'PASS', method: 'POST', path: `/products/${productId}/ideas`,
      id: productIdeaId, title, productId };
    const ordinaryAfterCreate = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
    assert.equal(ordinaryAfterCreate.status, 200);
    const allowed = ['admin', 'ordinary', 'objectadmin', 'readonly'] as Role[];
    for (const role of allowed) {
      const result = await requests.get(role)!('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.equal(result.status, 200);
    }
    for (const role of ['nonmember', 'crossorg'] as Role[]) {
      const result = await requests.get(role)!('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.ok([403, 404].includes(result.status));
      evidence.expectedControlledApiRefusals.push({ role, method: 'GET', status: result.status });
    }
    const beforeRefusal = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
    const refusalRoles: Role[] = ['readonly', 'nonmember', 'crossorg'];
    for (const role of refusalRoles) {
      const before = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        effectMarker, `${effectMarker} ${role}`);
      const update = await requests.get(role)!('PUT', `/products/${productId}/ideas/${productIdeaId}`,
        { id: productIdeaId, product_id: productId, title: `${title} unauthorized ${role}` });
      assert.ok([403, 404].includes(update.status));
      const after = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        effectMarker, `${effectMarker} ${role}`);
      const physicalUpdateStable = assertStableEffect(before, after);
      const readback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.deepEqual(stableIdea(readback.value), stableIdea(beforeRefusal.value));
      evidence.effectSnapshots.push({ role, operation: 'PUT', before, after,
        businessProjectionUnchanged: true, physicalSideEffectsUnchanged: physicalUpdateStable,
        physicalSideEffectsStatus: before.status, status: update.status });
      const saveBefore = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        effectMarker, `${effectMarker} ${role}`);
      const save = await requests.get(role)!('POST', '/ideas/save',
        { id: productIdeaId, product_id: productId, title: `${title} save unauthorized ${role}` });
      assert.ok([403, 404].includes(save.status));
      const saveAfter = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        effectMarker, `${effectMarker} ${role}`);
      const physicalSaveStable = assertStableEffect(saveBefore, saveAfter);
      const saveReadback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.deepEqual(stableIdea(saveReadback.value), stableIdea(beforeRefusal.value));
      evidence.effectSnapshots.push({ role, operation: 'POST /ideas/save', status: save.status,
        before: saveBefore, after: saveAfter, businessProjectionUnchanged: true,
        physicalSideEffectsUnchanged: physicalSaveStable, physicalSideEffectsStatus: saveBefore.status });
      const deleteBefore = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        effectMarker, `${effectMarker} ${role}`);
      const remove = await requests.get(role)!('DELETE', `/products/${productId}/ideas/${productIdeaId}`);
      assert.ok([403, 404].includes(remove.status));
      const deleteAfter = readOnlyEffectSnapshot(productId, credentials[role].personId!, providedId,
        effectMarker, `${effectMarker} ${role}`);
      const physicalDeleteStable = assertStableEffect(deleteBefore, deleteAfter);
      const removeReadback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.equal(removeReadback.status, 200);
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
    assert.equal(ordinaryUpdate.status, 200);
    const objectAdminUpdate = await requests.get('objectadmin')!('PUT',
      `/products/${productId}/ideas/${productIdeaId}`,
      { id: productIdeaId, product_id: productId, title: `${title} objectadmin` });
    assert.equal(objectAdminUpdate.status, 200);
    const saveReadback = await ordinary('GET', `/products/${productId}/ideas/${productIdeaId}`);
    assert.equal(saveReadback.status, 200);
    const freshOrdinary = await loginProductSession(browser, credentials.ordinary, evidence, 'zh-CN', testInfo);
    try {
      const freshRequest = requestFor(freshOrdinary, evidence, 'ordinary-fresh');
      const freshRead = await freshRequest('GET', `/products/${productId}/ideas/${productIdeaId}`);
      assert.equal(freshRead.status, 200);
      evidence.freshSessionReadback = { status: 'PASS', ideaId: productIdeaId };
    } finally { await freshOrdinary.close(); }
    for (const role of roles) {
      await deleteOwnedNotifications(sessions.get(role)!, evidence, marker,
        notificationBaselines.get(role) ?? [], role, startedAt, ownerIds);
    }
    const remove = await adminRequest('DELETE', `/products/${productId}/ideas/${productIdeaId}`);
    assert.equal(remove.status, 200);
    const absent = await adminRequest('GET', `/products/${productId}/ideas/${productIdeaId}`);
    assert.ok([404, 403].includes(absent.status));
    const datasets = await Promise.all(['normal', 'archived', 'deleted'].map(dataset =>
      adminRequest('POST', `/products/${productId}/ideas/fetch_${dataset}`,
        { page: 0, size: 1000, n_title_like: marker })));
    assert.equal(datasets.flatMap(result => result.value ?? []).filter(row => row.title?.includes(marker)).length, 0);
    evidence.cleanup = { status: 'PASS', ideaId: productIdeaId, getAfterDelete: absent.status,
      normalArchivedDeletedMarkerRows: 0, physicalMarkerRows: 'NOT_RUN_NO_DOCKER' };
    evidence.authenticatedRoleGate = { status: 'PASS', roleCount: 6,
      restrictedOrganizationAdmin: 'NOT_ESTABLISHED', realtimeAcceptance: false };
  } catch (error) {
    evidence.failure = String((error as Error).message);
    throw error;
  } finally {
    for (const session of [...sessions.values()].reverse()) await session.close();
    evidence.runtimeAfter = runtimeWitness();
    evidence.runtimeComparison = assertProductRuntimeUnchanged(evidence.runtimeBefore, evidence.runtimeAfter);
    const classification = classifyProductConsole(evidence);
    evidence.expectedPreAuthConsoleErrors = classification.expected;
    evidence.unexpectedConsoleErrors = classification.unexpected;
    evidence.finishedAt = new Date().toISOString();
    evidence.status = evidence.cleanup?.status === 'PASS' && evidence.authenticatedRoleGate?.status === 'PASS'
      && evidence.unexpectedConsoleErrors.length === 0 && evidence.pageErrors.length === 0
      && evidence.failedRequests.length === 0 && evidence.httpErrors.length === 0
      ? 'PASS-AUTHENTICATED-ROLE-GATE' : 'FAILED';
    journal('finished-authenticated-role-gate');
    const output = testInfo.outputPath('api-documentation-roles-evidence.private.json');
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  expect(evidence.status).toBe('PASS-AUTHENTICATED-ROLE-GATE');
});
