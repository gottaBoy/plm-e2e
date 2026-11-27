import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const workspace = [process.cwd(), path.resolve(process.cwd(), '..')].find(directory =>
  fs.existsSync(path.join(directory, 'plm-e2e/package.json')) && fs.existsSync(path.join(directory, 'plm/model/PSSYSTEM.json')));
assert.ok(workspace, 'Run the documentation notification contract within the workspace or plm-e2e');
const projectRequire = createRequire(path.join(workspace, 'plm-web/package.json'));
const compilerRequire = createRequire(projectRequire.resolve('vue'));
const parseHtml = compilerRequire('@vue/compiler-dom').parse;
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const markerPattern = /^CD-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const rules = [
  { codeName: 'product_member_create', event: '把你加入了产品', linked: true, timeField: 'create_time' },
  { codeName: 'product_member_remove', event: '把你移除了产品', linked: false, timeField: 'update_time' },
];
export const documentationNotificationDigest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const documentationStableValue = value => canonical(value);

function typedField(row, key) {
  if (!Object.hasOwn(row, key)) return { type: 'missing' };
  const value = row[key];
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null' };
  return { type: typeof value, sha256: documentationNotificationDigest(JSON.stringify(canonical(value))) };
}

export function documentationNotificationSnapshot(rows) {
  assert.ok(Array.isArray(rows));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows.map(row => {
    assert.ok(typeof row.id === 'string' && row.id);
    const fields = ['status', 'content', 'receiver', 'owner_id', 'owner_type', 'system_tag',
      'content_type', 'message_type', 'create_time', 'url', 'mobile_url'];
    return { id: row.id, ...Object.fromEntries(fields.map(key => [key, typedField(row, key)])) };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export async function pageDocumentationNotifications(request, identity) {
  assert.ok(typeof identity.srfuserid === 'string' && identity.srfuserid);
  assert.ok(typeof identity.srfdcsystemid === 'string' && identity.srfdcsystemid);
  const rows = [];
  let total;
  for (let page = 0; page < 100; page += 1) {
    const response = await request('POST', '/extension/internal_messages/fetch_cur_receiver',
      { page, size: 100, sort: 'timestamp,desc' });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.value) && response.value.length <= 100);
    const raw = response.headers['x-total'];
    assert.ok(typeof raw === 'string' && /^(?:0|[1-9]\d*)$/.test(raw));
    const count = Number(raw);
    assert.ok(Number.isSafeInteger(count) && count <= 10000);
    total ??= count;
    assert.equal(count, total, 'The current receiver collection changed during pagination');
    rows.push(...response.value);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.ok(rows.length <= total);
    if (rows.length === total) break;
    assert.equal(response.value.length, 100, 'A partial page cannot conceal remaining receiver messages');
  }
  assert.equal(rows.length, total);
  rows.forEach(row => {
    assert.equal(row.receiver, identity.srfuserid);
    assert.equal(row.system_tag, identity.srfdcsystemid);
  });
  return rows;
}

export function validateDocumentationNotificationTemplates(system) {
  const result = {};
  for (const rule of rules) {
    const found = system.getAllPSSysMsgTempls.filter(row => row.codeName === rule.codeName);
    assert.equal(found.length, 1);
    const template = found[0];
    assert.equal(template.contentType, 'HTML');
    assert.equal(template.dynaModelFilePath, `PSMODULES/ProdMgmt/PSSYSMSGTEMPLS/${rule.codeName}.json`);
    for (const text of [rule.event, '${data.product_name}', '${data.product_identifier}',
      `\${data.${rule.timeField}?string("yyyy-MM-dd HH:mm:ss")}`]) assert.ok(template.content.includes(text));
    for (const field of ['taskUrl', 'mobTaskUrl']) {
      if (rule.linked) {
        assert.ok(typeof template[field] === 'string' && template[field].startsWith('route://-/'));
        assert.ok(template[field].includes('product=${data.product_id}'));
      } else assert.ok(template[field] === undefined || template[field] === null || template[field] === '');
    }
    result[rule.codeName] = { ...template, ...rule };
  }
  return result;
}

function renderedProductMessage(html) {
  assert.ok(typeof html === 'string');
  const tree = parseHtml(html);
  const selected = new Map();
  const text = node => node.type === 2 ? node.content : (node.children || []).map(text).join('');
  const visit = node => {
    if (node.type === 1) {
      assert.ok(['div', 'span'].includes(node.tag.toLowerCase()), 'Unexpected active or non-template message HTML');
      for (const attribute of node.props) {
        assert.equal(attribute.type, 6, 'Dynamic HTML attributes cannot authorize deletion');
        assert.ok(!/^on/i.test(attribute.name));
      }
      const attributes = Object.fromEntries(node.props.map(attribute => [attribute.name, attribute.value?.content]));
      for (const name of (attributes.class || '').split(/\s+/)) {
        if (['notice-card__event-desc', 'notice-card__object-name', 'notice-card__object-id',
          'notice-pilot-time', 'notice-pilot-info'].includes(name)) {
          const entries = selected.get(name) || [];
          entries.push({ text: text(node).trim(), title: attributes.title });
          selected.set(name, entries);
        }
      }
    }
    (node.children || []).forEach(visit);
  };
  visit(tree);
  const one = name => {
    assert.equal(selected.get(name)?.length, 1, `Exactly one source-template field is required: ${name}`);
    return selected.get(name)[0];
  };
  return { event: one('notice-card__event-desc').text, name: one('notice-card__object-name').text,
    nameTitle: one('notice-card__object-name').title, identifier: one('notice-card__object-id').text,
    time: one('notice-pilot-time').text, pilot: one('notice-pilot-info').text };
}

function serverTime(value) {
  assert.ok(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value));
  const timestamp = Date.parse(`${value.replace(' ', 'T')}+08:00`);
  assert.ok(Number.isFinite(timestamp));
  return timestamp;
}

export function validateDocumentationNotificationScope(scope) {
  assert.equal(scope.contract, 'native-api-documentation-owned-product-messages-v1');
  assert.match(scope.marker ?? '', markerPattern);
  assert.match(scope.identifier ?? '', /^CD\d{12}$/);
  assert.match(scope.productId ?? '', idPattern);
  assert.ok(Array.isArray(scope.names) && scope.names.length >= 1 && scope.names.length <= 2);
  const expectedName = `${scope.marker} 产品🙂`;
  assert.equal(scope.names[0], expectedName);
  assert.ok(scope.names.every(name => name === expectedName || name === `${expectedName} e\u0301`));
  assert.equal(scope.created?.status, 'PASS');
  assert.equal(scope.created.productId, scope.productId);
  assert.equal(scope.created.identifier, scope.identifier);
  assert.equal(scope.created.name, expectedName);
  assert.equal(scope.created.method, 'POST');
  assert.equal(scope.created.path, '/products');
  assert.equal(scope.created.source, 'normal-native-ui');
  if (scope.names.length === 2) {
    assert.equal(scope.updated?.status, 'PASS');
    assert.equal(scope.updated.productId, scope.productId);
    assert.equal(scope.updated.name, scope.names[1]);
    assert.equal(scope.updated.method, 'PUT');
    assert.equal(scope.updated.path, `/products/${scope.productId}`);
  }
  assert.ok(Array.isArray(scope.memberRemovals));
  assert.equal(new Set(scope.memberRemovals.map(removal => removal.memberId)).size, scope.memberRemovals.length);
  scope.memberRemovals.forEach(removal => {
    assert.match(removal.memberId ?? '', idPattern);
    assert.equal(removal.productId, scope.productId);
    assert.equal(removal.status, 200);
    assert.equal(removal.method, 'DELETE');
    assert.equal(removal.path, `/product_members/${removal.memberId}`);
  });
  const started = Date.parse(scope.startedAt), finished = Date.parse(scope.finishedAt);
  assert.ok(Number.isFinite(started) && Number.isFinite(finished) && finished >= started && finished - started <= 180000);
  return scope;
}

export function validateDocumentationNotification(record, scope, identity, templates) {
  validateDocumentationNotificationScope(scope);
  assert.match(record.id ?? '', idPattern);
  assert.equal(record.receiver, identity.srfuserid);
  assert.ok([identity.srfuserid, identity.srfpersonid].filter(Boolean).includes(record.owner_id));
  assert.equal(record.owner_type, 'PERSONAL');
  assert.equal(record.system_tag, identity.srfdcsystemid);
  assert.equal(record.content_type, 'HTML');
  assert.ok(['RECEIVED', 'READ'].includes(record.status));
  const template = templates[record.message_type];
  assert.ok(template && rules.some(rule => rule.codeName === record.message_type));
  if (record.message_type === 'product_member_remove') assert.ok(scope.memberRemovals.length > 0);
  const rendered = renderedProductMessage(record.content);
  assert.equal(rendered.event, template.event);
  assert.ok(scope.names.includes(rendered.name));
  assert.equal(rendered.nameTitle, rendered.name);
  assert.ok(rendered.name.includes(scope.marker));
  assert.equal(rendered.identifier, scope.identifier);
  assert.equal(rendered.pilot, `· 产品管理 · ${rendered.name}`);
  for (const value of [record.create_time, rendered.time]) {
    const timestamp = serverTime(value);
    assert.ok(timestamp >= Date.parse(scope.startedAt) - 120000 && timestamp <= Date.parse(scope.finishedAt) + 120000);
  }
  for (const [field, sourceField] of [['url', 'taskUrl'], ['mobile_url', 'mobTaskUrl']]) {
    if (template.linked) {
      const expected = template[sourceField].replaceAll('${data.product_id}', scope.productId);
      assert.ok(!expected.includes('${'));
      assert.equal(record[field], expected, 'Only the exact source-template route with this product ID is eligible');
    } else assert.ok(record[field] === undefined || record[field] === null || record[field] === '');
  }
  return record;
}

function oldRowsUnchanged(before, after) {
  const ids = new Set(before.map(row => row.id));
  const selected = after.filter(row => ids.has(row.id));
  assert.deepEqual(documentationNotificationSnapshot(selected), documentationNotificationSnapshot(before));
}

export async function cleanupDocumentationNotifications({ request, identity, templates, scope, baseline, journal }) {
  validateDocumentationNotificationScope(scope);
  assert.ok(!baseline.some(row => typeof row.content === 'string' && row.content.includes(scope.marker)),
    'The new CD nonce must be absent from the pre-create receiver baseline');
  const all = await pageDocumentationNotifications(request, identity);
  oldRowsUnchanged(baseline, all);
  const owned = all.filter(row => typeof row.content === 'string' && row.content.includes(scope.marker));
  owned.forEach(row => validateDocumentationNotification(row, scope, identity, templates));
  const unrelated = all.filter(row => !owned.includes(row));
  journal('before-all-owned-notification-preflight', {
    owned: documentationNotificationSnapshot(owned), baseline: documentationNotificationSnapshot(baseline), scope,
  });
  for (const row of owned) {
    const response = await request('GET', `/extension/internal_messages/${row.id}`);
    assert.equal(response.status, 200);
    validateDocumentationNotification(response.value, scope, identity, templates);
    assert.deepEqual(documentationNotificationSnapshot([response.value]), documentationNotificationSnapshot([row]));
  }
  const refreshed = await pageDocumentationNotifications(request, identity);
  oldRowsUnchanged(unrelated, refreshed);
  const refreshedOwned = refreshed.filter(row => typeof row.content === 'string' && row.content.includes(scope.marker));
  refreshedOwned.forEach(row => validateDocumentationNotification(row, scope, identity, templates));
  assert.deepEqual(documentationNotificationSnapshot(refreshedOwned), documentationNotificationSnapshot(owned),
    'A late or changed owned message requires a fresh cleanup plan before any delete');
  journal('all-owned-notification-preflight-passed', { ids: owned.map(row => row.id), zeroCollection: owned.length === 0 });
  for (const row of owned) {
    journal('before-exact-owned-notification-delete', { id: row.id, snapshot: documentationNotificationSnapshot([row]) });
    const removed = await request('DELETE', `/extension/internal_messages/${row.id}`);
    assert.equal(removed.status, 200);
    const absent = await request('GET', `/extension/internal_messages/${row.id}`);
    assert.equal(absent.status, 404, 'Deleted message must return an actual keyed 404');
  }
  const after = await pageDocumentationNotifications(request, identity);
  assert.deepEqual(after.filter(row => typeof row.content === 'string' && row.content.includes(scope.marker)), []);
  oldRowsUnchanged(unrelated, after);
  oldRowsUnchanged(baseline, after);
  return { status: 'PASS', ids: owned.map(row => row.id), deleted: owned.length, ownedRemaining: 0,
    realZeroOwnedCollection: owned.length === 0, originalReceiverMessagesUnchanged: baseline.length,
    receiverCounts: { first: all.length, preDelete: refreshed.length, after: after.length },
    preCleanupUnrelatedMessagesUnchanged: unrelated.length, allGetsPreflightBeforeAnyDelete: true,
    actualPreflightGets: owned.length, actualDeletes: owned.length, actualKeyed404s: owned.length,
    eachDeletedKeyReturned404: owned.length ? true : null,
    messageDeliveryAcceptance: false, sendAuditDeleted: false, recentRecordsDeleted: false,
    physicalDatabaseTotalInvarianceClaimed: false };
}
