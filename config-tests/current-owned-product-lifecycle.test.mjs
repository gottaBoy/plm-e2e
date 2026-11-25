import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const filename = new URL('../tests/current-owned-product-helper.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true }, fileName: filename.pathname, reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);
const exports = {};
vm.runInNewContext(compiled.outputText, {
  exports, module: { exports }, require, process, Buffer, setTimeout, clearTimeout,
  __dirname: new URL('../tests/', import.meta.url).pathname,
}, { filename: filename.pathname });
const { validateOwnedProductRecord, validateOwnedProductMember, validateProductIdentity,
  assertProductRuntimeUnchanged, classifyProductConsole, productDeadline, validateProductEntry,
  validateOwnedProductNotification, validateProductNotificationReceipt, productNotificationTotal, productEntry,
  productNotificationEvents, productNotificationText, validateProductNotificationLink,
  validateFailedRealtimeNotificationCleanupReceipt } = exports;

test('business cleanup eligibility requires both current-run identifier and allowed name, plus recorded ID when available', () => {
  const record = { id: 'owned-id', identifier: 'CP123456789012', name: 'CP-owned 产品🙂 e\u0301',
    description: '中文🙂 e\u0301 " \' \\ \n' };
  const owned = { id: record.id, identifier: record.identifier, names: [record.name] };
  const before = structuredClone(record);
  assert.equal(validateOwnedProductRecord(record, owned), record);
  assert.deepEqual(record, before);
  for (const altered of [
    { ...record, id: 'foreign-id' }, { ...record, identifier: 'FOREIGN' },
    { ...record, name: 'Another product' }, { ...record, id: 'owned-id/../../foreign' },
    { ...record, id: '' }, null, [], 'owned-id',
  ]) assert.throws(() => validateOwnedProductRecord(altered, owned));
});

test('a lost create response can only be recovered through a record with this exact run marker', () => {
  const owned = { identifier: 'CP123456789012', names: ['CP-exact-owned-name'] };
  const eligible = { id: 'server-issued-id', identifier: owned.identifier, name: owned.names[0] };
  assert.equal(validateOwnedProductRecord(eligible, owned), eligible);
  assert.throws(() => validateOwnedProductRecord({ ...eligible, name: 'prefix CP-exact-owned-name suffix' }, owned));
  assert.throws(() => validateOwnedProductRecord({ ...eligible, identifier: 'CP123456789013' }, owned));
});

test('only a correlated unauthenticated pre-login resource 401 explains its raw browser console error', () => {
  const error = { phase: 'pre-auth', path: '/api/ibizplm__plmweb/appdata',
    message: 'Failed to load resource: the server responded with a status of 401 ()' };
  const response = { phase: 'pre-auth', requestPhase: 'pre-auth', method: 'GET',
    authenticated: false, path: error.path, status: 401 };
  const classify = (item, observed = response) => classifyProductConsole({
    consoleErrors: [item], expectedPreAuthResponses: [observed],
  });
  assert.equal(classify(error).expected.length, 1);
  for (const item of [
    { ...error, phase: 'authenticated' }, { ...error, path: '/api/ibizplm__plmweb/products' },
    { ...error, message: 'Unhandled promise rejection' }, { ...error, path: null },
  ]) assert.equal(classify(item).unexpected.length, 1);
  assert.equal(classify(error, { ...response, authenticated: true }).unexpected.length, 1);
  assert.equal(classify(error, { ...response, phase: 'login-submitted' }).unexpected.length, 1);
});

test('a pending evidence callback has a finite deadline while prompt failures retain their original cause', async () => {
  await assert.rejects(productDeadline(new Promise(() => {}), 10, 'bounded evidence wait'), /bounded evidence wait/);
  const failure = new Error('original resource failure');
  await assert.rejects(productDeadline(Promise.reject(failure), 1000, 'late timeout'), error => error === failure);
  assert.equal(await productDeadline(Promise.resolve('observed'), 1000, 'late timeout'), 'observed');
});

test('cross-application, cross-organization and foreign actor appdata cannot authorize product writes', () => {
  const context = { srfuserid: 'normal-user', srfpersonid: 'normal-user',
    srfsystemid: 'ibizplm', srforgid: 'own-org' };
  const headers = { srfsystemid: 'ibizplm', srforgid: 'own-org' };
  const credentials = { username: 'normal-user' };
  assert.equal(validateProductIdentity(context, headers, credentials), true);
  assert.equal(validateProductIdentity({ ...context, srfuserid: 'issued-person-id',
    srfpersonid: 'issued-person-id', srfloginname: 'normal-user' }, headers, credentials), true);
  for (const changed of [
    { ...context, srfsystemid: 'ibizmodeling' }, { ...context, srforgid: 'foreign-org' },
    { ...context, srfloginname: 'foreign-user' },
    { ...context, srfuserid: 'foreign-user', srfpersonid: 'foreign-user' },
    undefined,
  ]) assert.throws(() => validateProductIdentity(changed, headers, credentials));
});

test('membership cleanup cannot use a different product, an unsafe row ID or an absent user identity', () => {
  const member = { id: 'owned-relation-id', product_id: 'owned-product', user_id: 'issued-user-id' };
  assert.equal(validateOwnedProductMember(member, 'owned-product'), member);
  for (const row of [
    { ...member, product_id: 'another-product' }, { ...member, id: '../other-membership' },
    { ...member, user_id: '' }, null, [],
  ]) assert.throws(() => validateOwnedProductMember(row, 'owned-product'));
});

test('runtime evidence retains raw mount changes while accepting only an order change of complete mount records', () => {
  const mounts = [
    { Type: 'bind', Source: '/owned/file', Destination: '/app/file', RW: true, Propagation: 'rprivate' },
    { Type: 'bind', Source: '/owned/start.sh', Destination: '/start.sh', RW: false, Propagation: 'rprivate' },
  ];
  const before = [{ name: 'owned-runtime', containerId: 'exact-id', imageId: 'exact-image',
    startedAt: 'exact-time', restartCount: 0, configurationSha256: 'exact-config',
    mounts, mountsSha256: 'raw-order-one' }];
  const reordered = [{ ...before[0], mounts: [...mounts].reverse(), mountsSha256: 'raw-order-two' }];
  const comparison = assertProductRuntimeUnchanged(before, reordered);
  assert.equal(comparison.status, 'PASS');
  assert.equal(comparison.completeMountContentCompared, true);
  assert.equal(comparison.rawMountHashChanges[0], 'owned-runtime');
  for (const change of [
    { Source: '/other/source' }, { Destination: '/other/destination' }, { Type: 'volume' },
    { RW: false }, { Propagation: 'rshared' },
  ]) {
    const altered = structuredClone(reordered);
    Object.assign(altered[0].mounts[1], change);
    assert.throws(() => assertProductRuntimeUnchanged(before, altered));
  }
  assert.throws(() => assertProductRuntimeUnchanged(before, [{ ...before[0], restartCount: 1 }]));
});

test('a private browser entry remains an explicit unauthenticated loopback PLM origin', () => {
  assert.equal(validateProductEntry('http://127.0.0.1:54321/ibizplm-plmweb/'), 'http://127.0.0.1:54321/ibizplm-plmweb/');
  for (const value of ['https://outside.example/ibizplm-plmweb/', 'http://127.0.0.1/other-app/',
    'http://user:secret@127.0.0.1/ibizplm-plmweb/', 'http://127.0.0.1/ibizplm-plmweb/?token=x',
    'http://127.0.0.1/ibizplm-plmweb/#/login']) assert.throws(() => validateProductEntry(value));
});

test('notification eligibility binds receiver, owner, native system, rendered product identity, source time and event semantics', () => {
  const owned = { marker: 'CP-12345678-1234-4234-8234-123456789abc', productId: 'own-product-id',
    names: ['CP-12345678-1234-4234-8234-123456789abc 产品🙂'], identifier: 'CP123456789012',
    startedAt: '2026-11-23T04:01:30.000Z', finishedAt: '2026-11-23T04:01:55.000Z' };
  const identity = { srfuserid: 'server-user-id', srfpersonid: 'server-person-id', srfdcsystemid: 'server-native-system' };
  const message = { id: 'owned-notification-id', receiver: identity.srfuserid, owner_id: identity.srfpersonid,
    owner_type: 'PERSONAL', content_type: 'HTML', message_type: 'product_member_create',
    system_tag: identity.srfdcsystemid, status: 'RECEIVED', create_time: '2026-11-23 12:01:43',
    content: `<div><span class="notice-card__event-desc">把你加入了产品</span>` +
      `<span class="notice-card__object-id">${owned.identifier}</span>` +
      `<span class="notice-card__object-name">${owned.names[0]}</span></div>`,
    url: `route://-/index/product=${owned.productId}/product_index_view/-`,
    mobile_url: `route://-/home/product=${owned.productId}/product_mob_product_tree/-` };
  const before = structuredClone(message);
  assert.equal(validateOwnedProductNotification(message, owned, identity), message);
  assert.deepEqual(message, before);
  assert.equal(validateOwnedProductNotification({ ...message, status: 'READ', owner_id: identity.srfuserid }, owned, identity).status, 'READ');
  for (const changed of [
    { ...message, receiver: 'other-user' }, { ...message, owner_id: 'other-owner' },
    { ...message, owner_id: '' }, { ...message, system_tag: 'ibizplm' },
    { ...message, owner_type: 'SYSTEM' }, { ...message, content_type: 'JSON' },
    { ...message, message_type: 'other-template' }, { ...message, create_time: '2025-11-23 12:01:43' },
    { ...message, id: '../foreign' }, { ...message, status: 'DELETED' },
    { ...message, content: owned.marker }, { ...message, content: owned.names[0].replace(owned.marker, 'another-marker') },
    { ...message, content: message.content.replace(owned.identifier, 'CP999999999999') },
    { ...message, content: message.content.replace(owned.names[0], `${owned.names[0]} foreign suffix`) },
    { ...message, content: `${message.content}<script>alert("not executed")</script>` },
    { ...message, url: undefined }, { ...message, mobile_url: undefined },
    { ...message, url: message.url.replace('own-product-id', 'another-product-id') },
    { ...message, mobile_url: message.mobile_url.replace('own-product-id', 'another-product-id') },
    { ...message, url: 'https://outside.example/#/-/index/product=own-product-id/product_index_view/-' },
    null, [],
  ]) assert.throws(() => validateOwnedProductNotification(changed, owned, identity));
  assert.throws(() => validateOwnedProductNotification(message, owned, { ...identity, srfuserid: '' }));
  assert.throws(() => validateOwnedProductNotification(message, owned, { ...identity, srfdcsystemid: undefined }));
  for (const event of productNotificationEvents) {
    const content = message.content.replace('把你加入了产品', event.text);
    const row = { ...message, message_type: event.template, content,
      url: event.link ? message.url : null, mobile_url: event.link ? message.mobile_url : null };
    assert.equal(validateOwnedProductNotification(row, owned, identity), row);
    assert.equal(productNotificationText(content).event, event.text);
  }
});

test('only a passed and precisely cleaned current project product receipt can authorize later notification cleanup', () => {
  const marker = 'CP-12345678-1234-4234-8234-123456789abc';
  const project = 'current-product-zh-desktop';
  const receipt = { contract: 'current-owned-product-lifecycle-v1', status: 'PASS', project, entry: productEntry,
    startedAt: '2026-11-23T04:01:30.000Z', finishedAt: '2026-11-23T04:01:55.000Z',
    marker, account: { usernameSha256: 'actual-user-hash' },
    stages: { ownedInput: { marker, identifier: 'CP123456789012', name: `${marker} 产品🙂`,
      editedName: `${marker} 产品🙂 e\u0301` }, create: { status: 'PASS', productId: 'own-product-id' },
      initialMembership: { status: 'PASS' }, editReload: { status: 'PASS' }, freshSessionReadback: { status: 'PASS' },
      archiveActivate: { status: 'PASS' }, deleteRecover: { status: 'PASS' } },
    cleanup: { status: 'PASS', productId: 'own-product-id', activeArchivedDeletedRemain: 0, membershipReadbackEmpty: true } };
  const before = structuredClone(receipt);
  const owned = validateProductNotificationReceipt(receipt, project, 'actual-user-hash');
  assert.equal(owned.marker, marker);
  assert.equal(owned.productId, 'own-product-id');
  assert.deepEqual(receipt, before);
  for (const mutate of [
    value => { value.status = 'FAILED'; },
    value => { value.project = 'current-product-en-mobile'; },
    value => { value.entry = 'http://127.0.0.1:30250/other/'; },
    value => { value.account.usernameSha256 = 'another-account'; },
    value => { value.stages.ownedInput.name = `${marker} other name`; },
    value => { value.stages.ownedInput.marker = 'another-marker'; },
    value => { value.cleanup.productId = 'other-product'; },
    value => { value.cleanup.activeArchivedDeletedRemain = 1; },
    value => { value.cleanup.membershipReadbackEmpty = false; },
    value => { value.startedAt = 'invalid-time'; },
    value => { value.finishedAt = '2026-11-23T03:01:55.000Z'; },
    value => { value.stages.archiveActivate.status = 'FAILED'; },
  ]) {
    const changed = structuredClone(receipt);
    mutate(changed);
    assert.throws(() => validateProductNotificationReceipt(changed, project, 'actual-user-hash'));
  }
});

test('platform route links keep exact product identity and reject cross-product or external routing', () => {
  assert.doesNotThrow(() => validateProductNotificationLink('route://-/index/product=own-product/product_index_view/-', 'own-product'));
  assert.doesNotThrow(() => validateProductNotificationLink('\nroute://-/home/product=own-product/product_mob_product_tree/-\n', 'own-product', true));
  for (const link of ['route://foreign/index/product=own-product/product_index_view/-',
    'route://-/index/product=foreign/product_index_view/-', 'route://-/index/product=own-product/foreign_view/-',
    'route://-/index/product=own-product/product_index_view/product=another/-',
    'javascript:alert(1)', 'https://outside.example/#/product=own-product']) {
    assert.throws(() => validateProductNotificationLink(link, 'own-product'));
  }
});

test('an isolated realtime failure can authorize exact notification display cleanup without rewriting its failed status', () => {
  const marker = 'CP-12345678-1234-4234-8234-123456789abc';
  const project = 'current-product-zh-desktop';
  const receipt = { contract: 'current-owned-product-lifecycle-v1', status: 'FAILED', project, entry: productEntry,
    startedAt: '2026-11-23T04:01:30.000Z', finishedAt: '2026-11-23T04:01:55.000Z',
    marker, account: { usernameSha256: 'actual-user-hash' },
    stages: { ownedInput: { marker, identifier: 'CP123456789012', name: `${marker} 产品🙂`,
      editedName: `${marker} 产品🙂 e\u0301` }, create: { status: 'PASS', productId: 'own-product-id' },
      initialMembership: { status: 'PASS' }, editReload: { status: 'PASS' }, freshSessionReadback: { status: 'PASS' },
      archiveActivate: { status: 'PASS' }, deleteRecover: { status: 'PASS' },
      realtimeBusinessDelivery: { status: 'FAILED' } },
    cleanup: { status: 'PASS', productId: 'own-product-id', activeArchivedDeletedRemain: 0, membershipReadbackEmpty: true },
    unexpectedConsoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], captureErrors: [], mqttPackets: [] };
  const before = structuredClone(receipt);
  const owned = validateFailedRealtimeNotificationCleanupReceipt(receipt, project, 'actual-user-hash');
  assert.equal(owned.productId, 'own-product-id');
  assert.deepEqual(receipt, before);
  assert.throws(() => validateProductNotificationReceipt(receipt, project, 'actual-user-hash'));
  for (const mutate of [
    value => { value.status = 'PASS'; },
    value => { value.stages.failure = 'Business creation failed'; },
    value => { value.stages.deleteRecover.status = 'FAILED'; },
    value => { value.cleanup.status = 'FAILED'; },
    value => { value.captureErrors.push('a real capture failure'); },
    value => { value.mqttPackets.push({ command: 'publish', matchesOwnedMarker: true, portalSubtype: 'INTERNALMESSAGE' }); },
  ]) {
    const changed = structuredClone(receipt);
    mutate(changed);
    assert.throws(() => validateFailedRealtimeNotificationCleanupReceipt(changed, project, 'actual-user-hash'));
  }
});

test('authoritative product templates deliberately leave removed, deleted and archived event links absent', () => {
  const system = JSON.parse(readFileSync(new URL('../../plm/model/PSSYSTEM.json', import.meta.url), 'utf8'));
  const templates = new Map(system.getAllPSSysMsgTempls.filter(template => template.codeName?.startsWith('product_'))
    .map(template => [template.codeName, template]));
  assert.equal(templates.size, 4);
  const memberRemove = templates.get('product_member_remove');
  assert.equal(memberRemove.taskUrl, undefined);
  assert.equal(memberRemove.mobTaskUrl, undefined);
  for (const [name, condition] of [['product_remove_or_recover', 'data.is_deleted==0'],
    ['product_archived_or_activate', 'data.is_archived==0']]) {
    const template = templates.get(name);
    assert.ok(template.taskUrl.startsWith(`<#if ${condition}>route://`));
    assert.ok(template.mobTaskUrl.startsWith(`<#if ${condition}>`));
    assert.ok(template.content.includes('notice-card__object-id'));
    assert.ok(template.content.includes('notice-card__object-name'));
  }
  assert.ok(templates.get('product_member_create').taskUrl.startsWith('route://'));
  const entity = JSON.parse(readFileSync(new URL('../../ibiz-service-hub/libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension/PSMODULES/Notify/PSDATAENTITIES/internal_message.json', import.meta.url), 'utf8'));
  for (const name of ['URL', 'MOBILE_URL']) {
    assert.ok(entity.getAllPSDEFields.some(field => field.name === name && field.allowEmpty !== false));
    assert.ok(entity.getAllPSDEMethodDTOs.find(dto => dto.name === 'internal_messageDTO')
      .getPSDEMethodDTOFields.some(field => field.name === name.toLowerCase()));
  }
});

test('notification pagination requires an explicit native total and rejects malformed or excessive totals', () => {
  assert.equal(productNotificationTotal('0'), 0);
  assert.equal(productNotificationTotal('24'), 24);
  assert.equal(productNotificationTotal('10000'), 10_000);
  for (const value of [undefined, '', ' 0', '0 ', '01', '-1', '2.5', 'NaN', '10001', '9007199254740992']) {
    assert.throws(() => productNotificationTotal(value));
  }
});
