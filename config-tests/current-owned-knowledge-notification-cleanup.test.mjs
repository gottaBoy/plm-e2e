import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
  bindKnowledgeNotificationActor, knowledgeNotificationText, knowledgeNotificationTotal,
  notificationDigest, notificationStateSnapshot, pageAllKnowledgeNotifications,
  persistableKnowledgeRuntimeWitness, planKnowledgeNotificationCleanup, validateKnowledgeNotificationSource,
  validateKnowledgeNotificationTemplates, validateOwnedKnowledgeNotification,
} from '../tests/current-owned-knowledge-notification-contract.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const originalHelper = path.join(workspace, 'plm-e2e/tests/current-owned-knowledge-helper.ts');
const compiledHelper = ts.transpileModule(fs.readFileSync(originalHelper, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: originalHelper, reportDiagnostics: true,
});
assert.equal(compiledHelper.diagnostics?.length ?? 0, 0);
const originalExports = {};
vm.runInNewContext(compiledHelper.outputText, {
  exports: originalExports, module: { exports: originalExports }, require, process, Buffer,
  setTimeout, clearTimeout, __dirname: path.join(workspace, 'plm-e2e/tests'),
}, { filename: originalHelper });
const originalRuntimeGuard = originalExports.assertKnowledgeRuntimeUnchanged;
const system = JSON.parse(fs.readFileSync(path.join(workspace, 'plm/model/PSSYSTEM.json')));
const templates = validateKnowledgeNotificationTemplates(system);
const identity = { srfuserid: 'owned-actor', srfpersonid: 'owned-person',
  srforgid: 'owned-org', srfsystemid: 'ibizplm', srfdcsystemid: 'owned-native-system' };
const usernameSha256 = notificationDigest('owned-user');
const marker = 'CK-12345678-1234-4234-8234-123456789abc';
const scope = { marker, identifier: 'CKABCDEF123456', name: `${marker} 知识🙂`,
  spaceId: 'owned-space', knownPageIds: ['owned-page', 'owned-space'],
  startedAt: '2026-11-26T17:00:00.000Z', finishedAt: '2026-11-26T17:01:00.000Z' };
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('🙂', '&#128578;');

function sourceFixture() {
  const receipt = {
    contract: 'current-owned-knowledge-lifecycle-v1', status: 'FAILED', ...scope,
    sessions: [{ usernameSha256, normalUiLogin: true, tokenInjected: false, system: 'ibizplm',
      organizationSha256: notificationDigest(identity.srforgid) }],
    sourceInputsStable: true, runtimeComparison: { status: 'PASS' },
    appdata: [{ identityMatches: true, identitySha256: notificationDigest(JSON.stringify({
      user: identity.srfuserid, organization: identity.srforgid, system: identity.srfsystemid,
    })) }],
    stages: Object.fromEntries(['spaceCreate', 'createdOwnerMembership', 'draftSaved',
      'freshDraftReadback', 'publish', 'draftPublicationIsolation', 'lockUnlock']
      .map(stage => [stage, { status: 'PASS', ...(stage === 'spaceCreate' ? { id: scope.spaceId } : {}) }])),
    cleanup: { status: 'PASS', spaceId: scope.spaceId, knownPageIds: scope.knownPageIds,
      pagesRemoved: 2, remainingSpaces: 0, remainingMembers: 0, remainingRecentRecords: 0 },
  };
  const journal = [
    { stage: 'intent-before-any-business-write', details: { marker, identifier: scope.identifier } },
    { stage: 'space-create-ui-intent', details: { name: scope.name, identifier: scope.identifier, expectedVisibility: 'private' } },
    { stage: 'space-created', details: { id: scope.spaceId, name: scope.name, identifier: scope.identifier } },
    ...scope.knownPageIds.map(pageId => ({ stage: 'cleanup-owned-page-intent', details: { spaceId: scope.spaceId, pageId } })),
    { stage: 'cleanup-complete', details: { status: 'PASS', spaceId: scope.spaceId, knownPageIds: scope.knownPageIds } },
  ];
  return { receipt, journal };
}

function record(template = 'space_member_create', id = 'message-1') {
  const deletion = template === 'space_remove_or_recover';
  const event = deletion ? '删除了空间' : template === 'space_member_create' ? '把你加入了空间' : '把你移除了空间';
  const encodedName = escape(scope.name);
  const content = `<div class="notice-card">
    <span class="notice-card__event-desc">${event}</span>
    ${deletion ? `<span class="notice-card__object-id">${scope.identifier}</span>` : ''}
    <span class="notice-card__object-name" title="${encodedName}">${encodedName}</span>
    <span class="notice-pilot-time">2026-11-27 01:00:30</span>
    <span class="notice-pilot-info"> · 知识管理 · ${encodedName}</span>
  </div>`;
  const linked = template === 'space_member_create';
  return { id, receiver: identity.srfuserid, owner_id: identity.srfpersonid,
    system_tag: identity.srfdcsystemid, owner_type: 'PERSONAL', content_type: 'HTML',
    message_type: template, status: 'RECEIVED', create_time: '2026-11-27 01:00:30', content,
    url: linked ? templates[template].taskUrl.replaceAll('${data.space_id}', scope.spaceId) : null,
    mobile_url: linked ? templates[template].mobTaskUrl.replaceAll('${data.space_id}', scope.spaceId) : null };
}

test('only exact failed knowledge receipts and their own resource-cleanup journals establish source scope', () => {
  const { receipt, journal } = sourceFixture();
  const owned = validateKnowledgeNotificationSource(receipt, journal, usernameSha256);
  assert.equal(owned.originalStatus, 'FAILED');
  assert.equal(owned.fullBusinessAcceptance, false);
  bindKnowledgeNotificationActor([{ owned }], identity, usernameSha256);
  for (const mutate of [
    value => { value.receipt.contract = 'current-owned-product-lifecycle-v1'; },
    value => { value.receipt.status = 'PASS'; },
    value => { value.receipt.sessions[0].usernameSha256 = notificationDigest('foreign'); },
    value => { value.receipt.sessions[0].tokenInjected = true; },
    value => { value.receipt.cleanup.status = 'FAILED'; },
    value => { value.receipt.cleanup.knownPageIds = ['foreign-page']; },
    value => { value.receipt.stages.publish.status = 'FAILED'; },
    value => { value.journal[2].details.name = `${marker} arbitrary object`; },
    value => { value.journal[2].details.id = 'foreign-space'; },
    value => { value.journal.push(value.journal[0]); },
  ]) {
    const value = sourceFixture();
    mutate(value);
    assert.throws(() => validateKnowledgeNotificationSource(value.receipt, value.journal, usernameSha256));
  }
  assert.throws(() => bindKnowledgeNotificationActor([{ owned }], { ...identity, srfuserid: 'foreign' }, usernameSha256));
});

test('three exact authoritative templates distinguish linked creation from unlinked removal/deletion', () => {
  assert.deepEqual(Object.keys(templates).sort(),
    ['space_member_create', 'space_member_remove', 'space_remove_or_recover'].sort());
  for (const name of Object.keys(templates)) {
    const result = validateOwnedKnowledgeNotification(record(name), scope, identity, templates);
    assert.equal(result.template, name);
    assert.equal(knowledgeNotificationText(record(name).content).name, scope.name);
  }
  const changed = structuredClone(system);
  changed.getAllPSSysMsgTempls.find(row => row.codeName === 'space_member_remove').taskUrl = 'route://-/index/foreign';
  assert.throws(() => validateKnowledgeNotificationTemplates(changed));
});

test('receiver, owner, system, template, full object text, exact route and time must all agree', () => {
  for (const mutate of [
    row => { row.receiver = 'foreign'; },
    row => { row.owner_id = 'foreign'; },
    row => { row.system_tag = 'foreign'; },
    row => { row.owner_type = 'SYSTEM'; },
    row => { row.status = 'UNKNOWN'; },
    row => { row.message_type = 'product_member_create'; },
    row => { row.content = row.content.replace('把你加入了空间', '恢复了空间'); },
    row => { row.content = row.content.replaceAll(escape(scope.name), `${marker} arbitrary name`); },
    row => { row.content = row.content.replace(`title="${escape(scope.name)}"`, 'title="foreign"'); },
    row => { row.content = row.content.replace('</div>', '<span class="notice-card__object-name">duplicate</span></div>'); },
    row => { row.content += '<script>alert(1)</script>'; },
    row => { row.content = row.content.replace('class="notice-card"', 'class="notice-card" onclick="unsafe()"'); },
    row => { row.create_time = '2026-11-26 01:00:30'; },
    row => { row.content = row.content.replace('2026-11-27 01:00:30', '2026-11-25 01:00:30'); },
    row => { row.url = row.url.replace(scope.spaceId, 'foreign-space'); },
    row => { row.mobile_url += '/other'; },
    row => { row.url = 'https://foreign.example'; },
  ]) {
    const row = record();
    mutate(row);
    assert.throws(() => validateOwnedKnowledgeNotification(row, scope, identity, templates));
  }
  const removal = record('space_member_remove');
  removal.url = templates.space_member_create.taskUrl.replaceAll('${data.space_id}', scope.spaceId);
  assert.throws(() => validateOwnedKnowledgeNotification(removal, scope, identity, templates));
  const deletion = record('space_remove_or_recover');
  deletion.content = deletion.content.replace(scope.identifier, 'CKFFFFFFFFFFFF');
  assert.throws(() => validateOwnedKnowledgeNotification(deletion, scope, identity, templates));
});

test('a nonce alone or an unknown matching object cannot authorize any cleanup batch', () => {
  const unrelated = { ...record(), id: 'unrelated', content: 'unrelated ordinary message', status: 'READ' };
  const source = { owned: scope };
  const planned = planKnowledgeNotificationCleanup([record(), unrelated], [source], identity, templates);
  assert.equal(planned.owned.length, 1);
  assert.deepEqual(planned.unrelated, [unrelated]);
  const unknown = { ...record(), id: 'unknown', message_type: 'unknown_notification' };
  assert.throws(() => planKnowledgeNotificationCleanup([record(), unknown], [source], identity, templates));
  assert.throws(() => planKnowledgeNotificationCleanup([record(), record()], [source], identity, templates));
});

test('native total headers and full pagination cover every original receiver message', async () => {
  const all = Array.from({ length: 203 }, (_, index) => record('space_member_create', `msg-${index}`));
  const pages = [];
  const rows = await pageAllKnowledgeNotifications(async (method, suffix, data) => {
    assert.equal(method, 'POST');
    assert.equal(suffix, '/extension/internal_messages/fetch_cur_receiver');
    pages.push(data.page);
    return { status: 200, value: all.slice(data.page * 100, (data.page + 1) * 100), headers: { 'x-total': '203' } };
  }, identity);
  assert.deepEqual(pages, [0, 1, 2]);
  assert.deepEqual(rows, all);
  for (const value of [undefined, '', '-1', '1.5', '01', '10001', 'NaN']) {
    assert.throws(() => knowledgeNotificationTotal(value));
  }
  assert.equal(knowledgeNotificationTotal('0'), 0);
});

test('missing totals, synthetic envelopes, duplicates, truncated pages and foreign rows fail closed', async () => {
  for (const response of [
    { value: [], headers: {} },
    { value: { content: [] }, headers: { 'x-total': '0' } },
    { value: [record(), record()], headers: { 'x-total': '2' } },
    { value: [record()], headers: { 'x-total': '101' } },
    { value: [{ ...record(), receiver: 'foreign' }], headers: { 'x-total': '1' } },
  ]) await assert.rejects(pageAllKnowledgeNotifications(async () => ({ status: 200, ...response }), identity));
  let page = 0;
  await assert.rejects(pageAllKnowledgeNotifications(async () => {
    const index = page++;
    return { status: 200, value: Array.from({ length: 100 }, (_, item) => record('space_member_create', `${index}-${item}`)),
      headers: { 'x-total': index === 0 ? '200' : '201' } };
  }, identity));
});

test('unrelated state snapshots retain every original status and full content hash', () => {
  const rows = [record('space_member_remove', 'b'), { ...record('space_member_create', 'a'), status: 'READ' }];
  const before = notificationStateSnapshot(rows);
  assert.deepEqual(before.map(row => row.id), ['a', 'b']);
  assert.deepEqual(notificationStateSnapshot([...rows].reverse()), before);
  assert.notDeepEqual(notificationStateSnapshot([{ ...rows[0], status: 'READ' }, rows[1]]), before);
  assert.notDeepEqual(notificationStateSnapshot([{ ...rows[0], content: `${rows[0].content} changed` }, rows[1]]), before);
  const nullable = { ...rows[0], content: null };
  assert.deepEqual(notificationStateSnapshot([nullable]), notificationStateSnapshot([{ ...nullable }]));
  const absent = { ...nullable };
  delete absent.content;
  assert.notDeepEqual(notificationStateSnapshot([nullable]), notificationStateSnapshot([absent]));
  assert.notDeepEqual(notificationStateSnapshot([nullable]), notificationStateSnapshot([{ ...nullable, content: '' }]));
});

function runtimeFixture() {
  return ['plmweb', 'plmservice', 'ibizlab-uaa-api', 'ibiz-ebsx-allinone', 'ibiz-ebsx-gateway']
    .map((name, index) => ({
      name, id: String(index + 1).repeat(64), imageId: `sha256:${String(index + 2).repeat(64)}`,
      configurationSha256: String(index + 3).repeat(64),
      startedAt: '2026-11-26T12:00:00.000Z', restartCount: 0,
      mounts: [
        { Type: 'bind', Source: `/source/${name}`, Destination: '/data', Mode: 'ro', RW: false, Propagation: 'rprivate' },
        { Type: 'bind', Source: `/health/${name}`, Destination: '/health', Mode: 'ro', RW: false, Propagation: 'rprivate' },
      ],
      mountsSha256: 'a'.repeat(64),
      provider: name === 'plmservice'
        ? { sha256: 'b'.repeat(64), metadata: '101 200 0 0 644 1 300 400 500' } : undefined,
    }));
}

test('actual unchanged runtime guard accepts JSON roundtrip only after the narrow provider projection', () => {
  const fresh = runtimeFixture();
  const untouched = structuredClone(fresh);
  const persisted = JSON.parse(JSON.stringify(fresh));
  assert.throws(() => originalRuntimeGuard(persisted, fresh));
  const projected = persistableKnowledgeRuntimeWitness(fresh);
  assert.equal(originalRuntimeGuard(persistableKnowledgeRuntimeWitness(persisted), projected).status, 'PASS');
  assert.deepEqual(fresh, untouched);
  assert.equal(Object.hasOwn(projected[0], 'provider'), false);
  assert.deepEqual(projected[1].provider, fresh[1].provider);
  const reordered = structuredClone(fresh);
  for (const row of reordered) {
    row.mounts.reverse();
    row.mountsSha256 = 'c'.repeat(64);
  }
  assert.equal(originalRuntimeGuard(projected, persistableKnowledgeRuntimeWitness(reordered)).status, 'PASS');
});

test('real guard still rejects provider bytes/metadata and every container identity, lifecycle or mount drift', () => {
  const before = persistableKnowledgeRuntimeWitness(runtimeFixture());
  for (let index = 0; index < 5; index++) {
    for (const mutate of [
      row => { row.id = 'e'.repeat(64); },
      row => { row.imageId = `sha256:${'f'.repeat(64)}`; },
      row => { row.configurationSha256 = 'd'.repeat(64); },
      row => { row.startedAt = '2026-11-26T12:00:01.000Z'; },
      row => { row.restartCount++; },
      row => { row.mounts[0].Source = '/foreign'; },
      row => { row.mounts[0].Destination = '/foreign'; },
      row => { row.mounts[0].Type = 'volume'; },
      row => { row.mounts[0].Mode = 'rw'; },
      row => { row.mounts[0].RW = true; },
      row => { row.mounts[0].Propagation = 'rshared'; },
      row => { row.mounts[0].FutureMountField = true; },
      row => { row.FutureBindingField = true; },
    ]) {
      const changed = runtimeFixture();
      mutate(changed[index]);
      assert.throws(() => originalRuntimeGuard(before, persistableKnowledgeRuntimeWitness(changed)));
    }
  }
  for (const mutate of [
    rows => { rows[1].provider.sha256 = 'f'.repeat(64); },
    rows => { rows[1].provider.metadata = '101 201 0 0 644 1 300 400 500'; },
    rows => { rows[1].provider.FutureArchiveField = true; },
    rows => { delete rows[1].provider; },
    rows => { rows[0].provider = { ...rows[1].provider }; },
    rows => { rows[0].provider = null; },
    rows => { rows.pop(); },
    rows => { rows[0].name = rows[1].name; },
  ]) {
    const changed = runtimeFixture();
    mutate(changed);
    assert.throws(() => originalRuntimeGuard(before, persistableKnowledgeRuntimeWitness(changed)));
  }
});
