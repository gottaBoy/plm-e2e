import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const config = fs.readFileSync(path.join(root, 'plm-e2e/playwright.current-api-documentation-roles.config.ts'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'plm-e2e/tests/current-api-documentation-roles.spec.ts'), 'utf8');

test('B03 authenticated role config is serial, bounded and private', () => {
  for (const text of [
    'fullyParallel: false', 'workers: 1', 'retries: 0', 'maxFailures: 1',
    'timeout: 300_000', 'serviceWorkers: \'block\'', 'testMatch: /current-api-documentation-roles',
    'PLM_CURRENT_API_DOCUMENTATION_ROLES_ARTIFACT_DIR', 'outputDir',
  ]) assert.ok(config.includes(text), `Missing role harness contract: ${text}`);
  assert.ok(!config.includes('docker compose') && !config.includes('pull'));
});

test('spec requires six normal UI accounts and does not manufacture identity headers', () => {
  for (const role of ['admin', 'ordinary', 'objectadmin', 'readonly', 'nonmember', 'crossorg']) {
    assert.ok(spec.includes(`${role}:`), `Missing account role ${role}`);
  }
  for (const text of [
    'loginProductSession', 'normalUiLogin: true', 'tokenInjected: false',
    'session.headers()', 'product_members/fetch_default', 'restrictedOrganizationAdmin: \'NOT_ESTABLISHED\'',
  ]) assert.ok(spec.includes(text), `Missing normal UI identity binding: ${text}`);
  assert.ok(!spec.includes('srforgid:'), 'The role spec must not manufacture organization headers');
});

test('spec covers bounded positive and negative idea API operations with readback', () => {
  for (const text of [
    'POST', '/ideas', 'PUT', '/ideas/save', 'DELETE',
    'readonly', 'nonmember', 'crossorg', 'businessProjectionUnchanged',
    'freshSessionReadback', 'normalArchivedDeletedMarkerRows',
  ]) assert.ok(spec.includes(text), `Missing B03 operation gate: ${text}`);
});

test('spec snapshots paginated notifications and exact keyed cleanup without product MQTT assertions', () => {
  for (const text of [
    'pageDocumentationNotifications', 'documentationNotificationSnapshot',
    'zeroOwnedAfter', 'actualKeyed404', 'realtimeAcceptance = false',
    'mqttPackets', 'NOT_RUN_NO_DOCKER',
  ]) assert.ok(spec.includes(text), `Missing notification boundary: ${text}`);
  assert.ok(!spec.includes('productNotificationEvents'), 'The role spec must not reuse six product event assertions');
});

test('spec keeps deletion bounded to the retained product fixture and exact marker', () => {
  for (const text of [
    'retainedForMatrix', 'native-actors-run-20261124-r7',
    'normalArchivedDeletedMarkerRows', 'physicalMarkerRows',
    'productId', 'marker',
  ]) assert.ok(spec.includes(text), `Missing owned cleanup binding: ${text}`);
  assert.ok(!spec.includes('DELETE FROM') && !spec.includes('INSERT INTO') && !spec.includes('UPDATE '));
});

test('read-only effect snapshot helper is explicit and rejects Docker by default', () => {
  assert.ok(spec.includes('PLM_CURRENT_API_DOCUMENTATION_ROLES_READONLY_SQL'));
  assert.ok(spec.includes('nativeIdeaEffectSnapshotSQL'));
  assert.ok(spec.includes('physicalDatabaseRead: false'));
  assert.ok(spec.includes('MYSQL_PWD="$MYSQL_ROOT_PASSWORD"'));
});

test('evidence keeps top-level acceptance open', () => {
  assert.ok(spec.includes('fullB03Acceptance = false'));
  assert.ok(spec.includes('roleMatrixAcceptance = false'));
  assert.ok(spec.includes('restrictedOrganizationAdminEstablished = false'));
  assert.ok(spec.includes('PASS-AUTHENTICATED-ROLE-GATE'));
});

test('the role harness has one browser project and no anonymous shortcut', () => {
  assert.equal((config.match(/name: 'api-documentation-roles-zh-desktop'/g) ?? []).length, 1);
  assert.ok(!spec.includes('context.request.newContext'));
  assert.ok(!spec.includes('authorization: `Bearer'));
});

test('source path and artifact path remain inside the workspace artifact boundary', () => {
  assert.ok(config.includes('path.resolve'));
  assert.ok(config.includes('artifactDir'));
  assert.ok(spec.includes("path.join(workspace, '.artifacts')"));
});

test('spec does not invoke Docker, pull images or write SQL', () => {
  assert.ok(!spec.includes("spawnSync('docker', ['compose'"));
  assert.ok(!spec.includes("docker', ['pull'"));
  assert.ok(!spec.includes('INSERT INTO'));
  assert.ok(!spec.includes('UPDATE '));
});

test('expected status sets are explicit for protected reads and writes', () => {
  assert.ok(spec.includes('[403, 404].includes(result.status)'));
  assert.ok(spec.includes('[403, 404].includes(update.status)'));
  assert.ok(spec.includes('[403, 404].includes(save.status)'));
  assert.ok(spec.includes('[403, 404].includes(remove.status)'));
});

test('role credentials remain private files and only hashes enter evidence', () => {
  assert.ok(spec.includes('(info.mode & 0o077) === 0'));
  assert.ok(spec.includes('usernameSha256'));
  assert.ok(!spec.includes('password: credentials'));
});

test('runtime and raw browser error gates are retained', () => {
  for (const text of ['runtimeWitness()', 'assertProductRuntimeUnchanged', 'unexpectedConsoleErrors',
    'pageErrors', 'failedRequests', 'httpErrors']) assert.ok(spec.includes(text));
});

test('role matrix does not claim restricted organization administrator', () => {
  assert.ok(spec.includes('restrictedOrganizationAdmin: \'NOT_ESTABLISHED\''));
  assert.ok(spec.includes('restrictedOrganizationAdminEstablished = false'));
});

test('notification cleanup keeps send audit and recent deletion explicitly open', () => {
  assert.ok(spec.includes('sendAuditDeleted: false'));
  assert.ok(spec.includes('recentRecordsDeleted: false'));
  assert.ok(spec.includes('physicalDatabaseTotalInvarianceClaimed: false'));
});

test('normal UI session is used for the fresh readback', () => {
  assert.ok(spec.includes('freshOrdinary = await loginProductSession'));
  assert.ok(spec.includes('freshSessionReadback'));
});

test('the test file contains no credentials or static bearer token', () => {
  assert.ok(!/password\\s*[:=]\\s*['"][^'"]+['"]/.test(spec));
  assert.ok(!/Bearer\\s+[A-Za-z0-9._-]{16,}/.test(spec));
});

test('the role harness is a child gate, not a parent B03 closeout', () => {
  assert.ok(spec.includes('authenticatedRoleGate'));
  assert.ok(spec.includes('fullB03Acceptance = false'));
  assert.ok(spec.includes('realtimeAcceptance = false'));
});
