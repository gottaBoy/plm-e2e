import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const personSelectPlugin = '@ibiz-template-plm/person-select@0.0.3-alpha.434';
const safeId = /^[A-Za-z0-9_-]{1,100}$/;
const nonce = /^PS-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const personSelectDigest = value => createHash('sha256').update(value).digest('hex');
export const personSelectCanonical = value => Array.isArray(value) ? value.map(personSelectCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, personSelectCanonical(value[key])])) : value;
export const personSelectSnapshot = value => personSelectDigest(JSON.stringify(personSelectCanonical(value)));

export function readPersonSelectPrivateJson(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0,
    'An owned, private, regular fixture or credential file is required');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

export function validatePersonSelectScope(scope) {
  assert.match(scope.marker ?? '', nonce);
  assert.match(scope.productId ?? '', safeId);
  assert.equal(scope.title, `${scope.marker} 需求🙂 e\u0301 ' " \\`);
  assert.ok(Array.isArray(scope.actorIds) && scope.actorIds.length > 0);
  scope.actorIds.forEach(id => assert.match(id, safeId));
  assert.ok(Number.isFinite(Date.parse(scope.startedAt)));
  if (scope.ideaId !== undefined) assert.match(scope.ideaId, safeId);
  return scope;
}

export function validatePersonSelectIdea(row, scope) {
  validatePersonSelectScope(scope);
  assert.ok(row && typeof row === 'object' && !Array.isArray(row));
  assert.match(row.id ?? '', safeId);
  if (scope.ideaId) assert.equal(row.id, scope.ideaId, 'The exact created idea ID is required');
  assert.equal(row.product_id, scope.productId);
  assert.equal(row.title, scope.title, 'A prefix or partial nonce cannot authorize deletion');
  assert.ok(scope.actorIds.includes(row.create_man), 'The idea must have the normal creating actor');
  return row;
}

export function personSelectIdeaProjection(row) {
  return Object.fromEntries(['id', 'product_id', 'title', 'assignee_id', 'assignee_name', 'state',
    'cur_version_id', 'create_man', 'update_man', 'update_time', 'is_archived', 'is_deleted']
    .map(key => [key, row[key] ?? null]));
}

export function personSelectEditorRequest({ url, method, body }, productId, apiPrefix) {
  assert.match(productId, safeId);
  const parsed = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.protocol === 'http:');
  assert.ok(!parsed.username && !parsed.password && !parsed.hash && !parsed.search);
  assert.equal(parsed.pathname, `${apiPrefix}/products/${productId}/product_members/fetch_default`);
  assert.equal(method, 'POST');
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.ok(Number.isSafeInteger(body.page) && body.page >= 0 && body.page <= 100);
  assert.ok(Number.isSafeInteger(body.size) && body.size > 0 && body.size <= 100);
  if (Object.hasOwn(body, 'query')) assert.equal(typeof body.query, 'string');
  return { url: parsed.href, path: parsed.pathname, method, body: personSelectCanonical(body) };
}

export function samePersonSelectRequest(left, right) {
  return JSON.stringify(personSelectCanonical(left)) === JSON.stringify(personSelectCanonical(right));
}

export async function pagePersonSelectRows(request, suffix, filters = {}) {
  const rows = [];
  let total;
  for (let page = 0; page < 100; page += 1) {
    const result = await request('POST', suffix, { ...filters, page, size: 100 });
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.value) && result.value.length <= 100);
    const count = result.headers['x-total'];
    assert.match(count ?? '', /^(?:0|[1-9]\d*)$/);
    const observed = Number(count);
    assert.ok(Number.isSafeInteger(observed) && observed <= 10000);
    total ??= observed;
    assert.equal(observed, total, 'The native collection changed while paging');
    rows.push(...result.value);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.ok(rows.length <= total);
    if (rows.length === total) break;
    assert.equal(result.value.length, 100, 'A partial page cannot conceal more rows');
  }
  assert.equal(rows.length, total);
  return rows;
}

export function classifyPersonSelectFault(failedRequests, consoleErrors, fault) {
  const expectedFailed = [], expectedConsole = [];
  if (fault?.abortedCount === 1) {
    assert.ok(fault.observedBeforeAbort && fault.injectedRequest && fault.recoveredRequest);
    assert.equal(samePersonSelectRequest(fault.observedBeforeAbort, fault.injectedRequest), true);
    assert.equal(samePersonSelectRequest(fault.injectedRequest, fault.recoveredRequest), true);
    assert.equal(fault.failureEvents.length, 1);
    const observed = fault.failureEvents[0];
    assert.equal(observed.requestIsExactAbortedObject, true);
    const row = failedRequests[observed.rawIndex];
    assert.ok(row);
    assert.equal(row.path, fault.injectedRequest.path);
    assert.equal(row.method, fault.injectedRequest.method);
    assert.equal(row.error, 'net::ERR_FAILED');
    expectedFailed.push(row);
    assert.ok(fault.consoleEvents.length <= 1);
    for (const item of fault.consoleEvents) {
      assert.equal(item.exactAbortedUrl, fault.injectedRequest.url);
      const raw = consoleErrors[item.rawIndex];
      assert.equal(raw?.path, fault.injectedRequest.path);
      assert.equal(raw?.message, 'Failed to load resource: net::ERR_FAILED');
      expectedConsole.push(raw);
    }
  }
  return { expectedFailed, expectedConsole,
    unexpectedFailed: failedRequests.filter(row => !expectedFailed.includes(row)),
    unexpectedConsole: consoleErrors.filter(row => !expectedConsole.includes(row)) };
}

export function validatePersonSelectNotification(row, scope, identity, templates, rendered) {
  validatePersonSelectScope(scope);
  assert.match(row.id ?? '', safeId);
  assert.equal(row.receiver, identity.srfuserid);
  assert.ok([identity.srfuserid, identity.srfpersonid].includes(row.owner_id));
  assert.equal(row.system_tag, identity.srfdcsystemid);
  assert.equal(row.owner_type, 'PERSONAL');
  assert.equal(row.content_type, 'HTML');
  assert.ok(['READ', 'RECEIVED'].includes(row.status));
  assert.ok(typeof row.content === 'string' && row.content.includes(scope.marker));
  assert.ok(['idea_assignee', 'idea_assignee_onchange', 'idea_assignee_cancel'].includes(row.message_type));
  const template = templates[row.message_type];
  assert.ok(template && template.contentType === 'HTML');
  assert.equal(rendered.name, scope.title);
  if (scope.showIdentifier) assert.equal(rendered.identifier, scope.showIdentifier);
  assert.equal(typeof template.expectedEvent, 'string');
  assert.equal(rendered.event, template.expectedEvent);
  const fill = source => source.replaceAll('${data.id}', scope.ideaId).replaceAll('${data.product_id}', scope.productId);
  for (const [field, templateField] of [['url', 'taskUrl'], ['mobile_url', 'mobTaskUrl']]) {
    assert.equal(typeof template[templateField], 'string');
    assert.equal(row[field], fill(template[templateField]), 'Only this exact source-declared idea link is eligible');
  }
  assert.match(row.create_time ?? '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const created = Date.parse(`${row.create_time.replace(' ', 'T')}+08:00`);
  assert.ok(created >= Date.parse(scope.startedAt) - 120000 && created <= Date.now() + 120000);
  return row;
}
