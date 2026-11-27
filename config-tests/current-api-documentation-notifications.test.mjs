import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupDocumentationNotifications, documentationNotificationSnapshot, documentationStableValue,
  pageDocumentationNotifications, validateDocumentationNotification,
  validateDocumentationNotificationScope, validateDocumentationNotificationTemplates,
} from '../tests/current-api-documentation-notifications.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const system = JSON.parse(fs.readFileSync(path.join(workspace, 'plm/model/PSSYSTEM.json')));
const templates = validateDocumentationNotificationTemplates(system);
const identity = { srfuserid: 'owned-user', srfpersonid: 'owned-person', srfdcsystemid: 'owned-system' };
const marker = 'CD-12345678-1234-4234-8234-123456789abc';
const name = `${marker} 产品🙂`;
const scope = {
  contract: 'native-api-documentation-owned-product-messages-v1', marker, identifier: 'CD123456789012',
  productId: 'owned-product', names: [name, `${name} e\u0301`],
  created: { status: 'PASS', productId: 'owned-product', identifier: 'CD123456789012', name,
    method: 'POST', path: '/products', source: 'normal-native-ui' },
  updated: { status: 'PASS', productId: 'owned-product', name: `${name} e\u0301`,
    method: 'PUT', path: '/products/owned-product' },
  memberRemovals: [{ memberId: 'owned-membership', productId: 'owned-product', status: 200,
    method: 'DELETE', path: '/product_members/owned-membership' }],
  startedAt: '2026-11-26T17:00:00.000Z', finishedAt: '2026-11-26T17:01:00.000Z',
};
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('🙂', '&#128578;');
function record(template = 'product_member_create', id = 'owned-message') {
  const rule = templates[template];
  const linked = template === 'product_member_create';
  const renderedName = linked ? scope.names[0] : scope.names[1];
  return { id, receiver: identity.srfuserid, owner_id: identity.srfpersonid,
    owner_type: 'PERSONAL', system_tag: identity.srfdcsystemid, content_type: 'HTML',
    message_type: template, status: 'RECEIVED', create_time: '2026-11-27 01:00:30',
    content: `<div class="notice-card">
      <span class="notice-card__event-desc">${rule.event}</span>
      <span class="notice-card__object-id">${scope.identifier}</span>
      <span class="notice-card__object-name" title="${escape(renderedName)}">${escape(renderedName)}</span>
      <span class="notice-pilot-time">2026-11-27 01:00:30</span>
      <span class="notice-pilot-info"> · 产品管理 · ${escape(renderedName)}</span></div>`,
    url: linked ? rule.taskUrl.replaceAll('${data.product_id}', scope.productId) : null,
    mobile_url: linked ? rule.mobTaskUrl.replaceAll('${data.product_id}', scope.productId) : null };
}

test('the CD source contract is independent of CP receipts and binds exact observed create/update/member actions', () => {
  validateDocumentationNotificationScope(scope);
  for (const mutate of [
    row => { row.contract = 'current-owned-product-lifecycle-v1'; },
    row => { row.marker = row.marker.replace('CD-', 'CP-'); },
    row => { row.created.productId = 'foreign-product'; },
    row => { row.created.source = 'controller-injection'; },
    row => { row.updated = undefined; },
    row => { row.names[1] = `${marker} arbitrary product`; },
    row => { row.memberRemovals[0].productId = 'foreign'; },
    row => { row.finishedAt = '2026-11-26T18:00:00.000Z'; },
  ]) {
    const changed = structuredClone(scope);
    mutate(changed);
    assert.throws(() => validateDocumentationNotificationScope(changed));
  }
});

test('only the two actual authoritative member templates and exact source routes authorize CD messages', () => {
  assert.deepEqual(Object.keys(templates).sort(), ['product_member_create', 'product_member_remove']);
  validateDocumentationNotification(record(), scope, identity, templates);
  validateDocumentationNotification(record('product_member_remove'), scope, identity, templates);
  const changed = structuredClone(system);
  changed.getAllPSSysMsgTempls.find(row => row.codeName === 'product_member_remove').taskUrl = 'route://-/foreign';
  assert.throws(() => validateDocumentationNotificationTemplates(changed));
});

test('nonce, product identity, rendered text, source template, sender scope and time all agree before deletion', () => {
  for (const mutate of [
    row => { row.receiver = 'foreign'; },
    row => { row.owner_id = 'foreign'; },
    row => { row.owner_type = 'SYSTEM'; },
    row => { row.system_tag = 'foreign'; },
    row => { row.message_type = 'unknown-template'; },
    row => { row.status = 'UNKNOWN'; },
    row => { row.content = row.content.replaceAll(scope.identifier, 'CD999999999999'); },
    row => { row.content = row.content.replaceAll(escape(name), `${marker} arbitrary name`); },
    row => { row.content = row.content.replace('title="', 'onclick="unsafe()" title="'); },
    row => { row.content += '<script>unsafe()</script>'; },
    row => { row.content = row.content.replace('</div>', '<span class="notice-card__object-name">duplicate</span></div>'); },
    row => { row.content = row.content.replace('2026-11-27 01:00:30', '2026-11-25 01:00:30'); },
    row => { row.create_time = '2026-11-25 01:00:30'; },
    row => { row.url = row.url.replace(scope.productId, 'foreign-product'); },
    row => { row.mobile_url += '/foreign'; },
  ]) {
    const changed = record();
    mutate(changed);
    assert.throws(() => validateDocumentationNotification(changed, scope, identity, templates));
  }
  const removal = record('product_member_remove');
  assert.throws(() => validateDocumentationNotification(removal, { ...scope, memberRemovals: [] }, identity, templates));
});

test('typed message snapshots retain missing/null/empty distinctions and all original status/content values', () => {
  const baseline = record();
  for (const value of [null, undefined, '']) {
    assert.notDeepEqual(documentationNotificationSnapshot([baseline]),
      documentationNotificationSnapshot([{ ...baseline, content: value }]));
  }
  const missing = { ...baseline };
  delete missing.content;
  assert.notDeepEqual(documentationNotificationSnapshot([missing]),
    documentationNotificationSnapshot([{ ...baseline, content: undefined }]));
  assert.notDeepEqual(documentationNotificationSnapshot([baseline]),
    documentationNotificationSnapshot([{ ...baseline, status: 'READ' }]));
  assert.deepEqual(documentationStableValue({ b: 1, a: { d: 2, c: 3 } }),
    { a: { c: 3, d: 2 }, b: 1 });
});

test('native pagination requires complete typed arrays, stable totals and current receiver/system on every row', async () => {
  const rows = Array.from({ length: 203 }, (_, index) => record('product_member_create', `message-${index}`));
  const pages = [];
  const result = await pageDocumentationNotifications(async (method, suffix, data) => {
    assert.equal(method, 'POST');
    assert.equal(suffix, '/extension/internal_messages/fetch_cur_receiver');
    pages.push(data.page);
    return { status: 200, value: rows.slice(data.page * 100, (data.page + 1) * 100), headers: { 'x-total': '203' } };
  }, identity);
  assert.deepEqual(result, rows);
  assert.deepEqual(pages, [0, 1, 2]);
  for (const response of [
    { value: [], headers: {} },
    { value: { content: [] }, headers: { 'x-total': '0' } },
    { value: [record(), record()], headers: { 'x-total': '2' } },
    { value: [record()], headers: { 'x-total': '101' } },
    { value: [{ ...record(), receiver: 'foreign' }], headers: { 'x-total': '1' } },
  ]) await assert.rejects(pageDocumentationNotifications(async () => ({ status: 200, ...response }), identity));
});

function cleanupFixture(owned = [record(), record('product_member_remove', 'owned-removal')]) {
  const unrelated = { ...record('product_member_create', 'original-message'), content: null, status: 'READ' };
  const rows = new Map([unrelated, ...owned].map(row => [row.id, structuredClone(row)]));
  const events = [], requests = [], hooks = {};
  const request = async (method, suffix) => {
    requests.push({ method, suffix });
    await hooks.before?.(method, suffix);
    if (method === 'POST') return { status: 200, value: structuredClone([...rows.values()]), headers: { 'x-total': String(rows.size) } };
    const id = suffix.split('/').at(-1);
    if (method === 'GET') return { status: rows.has(id) ? 200 : 404, value: structuredClone(rows.get(id)) };
    assert.equal(method, 'DELETE');
    assert.equal(rows.delete(id), true);
    return { status: 200 };
  };
  return { rows, unrelated, requests, hooks, events,
    execute: () => cleanupDocumentationNotifications({ request, identity, templates, scope,
      baseline: [unrelated], journal: (stage, data) => events.push({ stage, data }) }) };
}

test('every owned GET preflight succeeds before any DELETE and each deletion has a real keyed 404', async () => {
  const f = cleanupFixture();
  const result = await f.execute();
  assert.equal(result.deleted, 2);
  assert.equal(result.eachDeletedKeyReturned404, true);
  assert.equal(result.originalReceiverMessagesUnchanged, 1);
  const firstDelete = f.requests.findIndex(row => row.method === 'DELETE');
  for (const id of ['owned-message', 'owned-removal']) {
    assert.ok(f.requests.slice(0, firstDelete).some(row => row.method === 'GET' && row.suffix.endsWith(`/${id}`)));
  }
  assert.deepEqual([...f.rows.keys()], ['original-message']);
});

test('a foreign or changed second GET prevents the whole batch from deleting the first owned message', async () => {
  const f = cleanupFixture();
  f.hooks.before = (method, suffix) => {
    if (method === 'GET' && suffix.endsWith('/owned-removal')) f.rows.get('owned-removal').owner_id = 'foreign';
  };
  await assert.rejects(f.execute());
  assert.equal(f.requests.some(row => row.method === 'DELETE'), false);
  assert.equal(f.rows.size, 3);
});

test('a late matching message or changed original state refuses all deletes until a new plan is made', async () => {
  for (const kind of ['late-owned', 'original-status', 'original-content']) {
    const f = cleanupFixture();
    let pages = 0;
    f.hooks.before = method => {
      if (method !== 'POST') return;
      pages += 1;
      if (pages !== 2) return;
      if (kind === 'late-owned') f.rows.set('late-owned', record('product_member_create', 'late-owned'));
      if (kind === 'original-status') f.rows.get('original-message').status = 'RECEIVED';
      if (kind === 'original-content') f.rows.get('original-message').content = '';
    };
    await assert.rejects(f.execute());
    assert.equal(f.requests.some(row => row.method === 'DELETE'), false);
  }
});

test('a true zero owned set records full native zero sets and still checks every original message unchanged', async () => {
  const f = cleanupFixture([]);
  const result = await f.execute();
  assert.equal(result.realZeroOwnedCollection, true);
  assert.equal(result.deleted, 0);
  assert.equal(result.actualKeyed404s, 0);
  assert.equal(result.eachDeletedKeyReturned404, null);
  assert.deepEqual(result.receiverCounts, { first: 1, preDelete: 1, after: 1 });
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 3);
  assert.equal(f.requests.some(row => row.method === 'GET' || row.method === 'DELETE'), false);
  assert.equal(result.sendAuditDeleted, false);
  assert.equal(result.recentRecordsDeleted, false);
});
