import assert from 'node:assert/strict';
import { documentationNotificationSnapshot } from './current-api-documentation-notifications.mjs';

export function assertRoleIdea(response, scope, title) {
  assert.equal(response.status, 200);
  const row = response.value;
  assert.ok(row && typeof row === 'object' && !Array.isArray(row));
  assert.equal(row.id, scope.id);
  assert.equal(row.product_id, scope.productId);
  assert.equal(row.title, title);
  assert.ok(title.startsWith(scope.marker));
  return row;
}

export function assertRoleMessagesUnchanged(before, after, marker) {
  const containsMarker = row => ['content', 'title', 'short_content'].some(field =>
    typeof row[field] === 'string' && row[field].includes(marker));
  assert.equal(before.filter(containsMarker).length, 0, 'The fresh marker must not exist before creation');
  assert.equal(after.filter(containsMarker).length, 0,
    'Unexpected messages must be retained for a separately reviewed exact-template cleanup');
  const original = new Set(before.map(row => row.id));
  assert.deepEqual(documentationNotificationSnapshot(after.filter(row => original.has(row.id))),
    documentationNotificationSnapshot(before), 'Original receiver messages changed');
  return { status: 'PASS', originalCount: before.length, observedCount: after.length,
    ownedMessages: 0, actualDeletes: 0, actualKeyed404s: 0,
    messageDeliveryAcceptance: false, sendAuditDeleted: false, recentRecordsDeleted: false };
}

export function roleIdeaEffectSql({ productId, actorId, id, marker, title }) {
  for (const value of [productId, id]) assert.match(value, /^[a-f0-9]{32}$/);
  assert.match(actorId, /^nat_[a-f0-9]{12}_(?:ordinary|readonly|nonmember|crossorg)$/);
  assert.match(marker, /^CD-[a-f0-9-]{36}$/);
  assert.ok(typeof title === 'string' && title.startsWith(marker) && title.length <= 200);
  const literal = value => `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
  const product = literal(productId), actor = literal(actorId), key = literal(id);
  const prefix = literal(marker), name = literal(title);
  const sequence = ` FROM plm.SEQUENCE_GENERATOR WHERE NAME='seq_idea_id' AND GROUP_TAG=${product}`;
  const fields = [
    `'sequenceRows',(SELECT COUNT(*)${sequence})`,
    `'sequenceMin',(SELECT MIN(CURRENT_VALUE)${sequence})`,
    `'sequenceMax',(SELECT MAX(CURRENT_VALUE)${sequence})`,
    `'ownProductIdeaRows',(SELECT COUNT(*) FROM plm.IDEA WHERE PRODUCT_ID=${product})`,
    `'ownPrefixIdeaRows',(SELECT COUNT(*) FROM plm.IDEA WHERE PRODUCT_ID=${product} AND LOCATE(${prefix},TITLE)>0)`,
    `'plannedIdeaRows',(SELECT COUNT(*) FROM plm.IDEA WHERE ID=${key})`,
    `'actorIdeaRows',(SELECT COUNT(*) FROM plm.IDEA WHERE PRODUCT_ID=${product} AND CREATE_MAN=${actor})`,
    `'actorVersionRows',(SELECT COUNT(*) FROM plm.VERSION WHERE CREATE_MAN=${actor})`,
    `'plannedVersionRows',(SELECT COUNT(*) FROM plm.VERSION WHERE OWNER_ID=${key})`,
    `'actorRecentRows',(SELECT COUNT(*) FROM plm.RECENT WHERE CREATE_MAN=${actor} AND RECENT_PARENT=${product})`,
    `'plannedRecentRows',(SELECT COUNT(*) FROM plm.RECENT WHERE OWNER_ID=${key})`,
    `'plannedInternalMessageRows',(SELECT COUNT(*) FROM a_lab01_3f9ebc219.INTERNAL_MESSAGE WHERE OWNER_ID=${key})`,
    `'actorInternalMessageRows',(SELECT COUNT(*) FROM a_lab01_3f9ebc219.INTERNAL_MESSAGE WHERE CREATE_MAN=${actor})`,
    `'titleInternalMessageRows',(SELECT COUNT(*) FROM a_lab01_3f9ebc219.INTERNAL_MESSAGE WHERE LOCATE(${name},TITLE)>0 OR LOCATE(${name},SHORT_CONTENT)>0 OR LOCATE(${name},CONTENT)>0)`,
  ];
  return `START TRANSACTION READ ONLY;\nSELECT JSON_OBJECT(${fields.join(',')});\nCOMMIT;\n`;
}

export async function cleanupRoleIdea({ request, scope, titles, journal, physical }) {
  const suffix = `/products/${scope.productId}/ideas/${scope.id}`;
  const current = await request('GET', suffix);
  assert.ok([200, 404].includes(current.status), 'Only a definite GET or absence can drive cleanup');
  let deleted = false;
  if (current.status === 200) {
    assert.ok(titles.includes(current.value?.title), 'An unrecognized title must be retained');
    assertRoleIdea(current, scope, current.value.title);
    await journal('before-exact-owned-idea-delete', { id: scope.id, productId: scope.productId,
      marker: scope.marker, title: current.value.title });
    const removed = await request('DELETE', suffix);
    assert.equal(removed.status, 200);
    deleted = true;
  }
  assert.equal((await request('GET', suffix)).status, 404, 'Admin GET after cleanup must be a real 404');
  for (const dataset of ['normal', 'archived', 'deleted']) {
    const response = await request('POST', `/products/${scope.productId}/ideas/fetch_${dataset}`,
      { page: 0, size: 1000, n_title_like: scope.marker });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.value));
    const total = response.headers['x-total'];
    assert.ok(typeof total === 'string' && /^\d+$/.test(total));
    assert.equal(Number(total), response.value.length, 'Cleanup readback must not be truncated');
    assert.equal(response.value.filter(row => row.id === scope.id ||
      typeof row.title === 'string' && row.title.includes(scope.marker)).length, 0);
  }
  const physicalAfter = await physical();
  if (physicalAfter.status === 'PASS_READ_ONLY') {
    assert.equal(physicalAfter.value.plannedIdeaRows, 0);
    assert.equal(physicalAfter.value.ownPrefixIdeaRows, 0);
  }
  return { status: 'PASS', id: scope.id, deleted, getAfterDelete: 404,
    normalArchivedDeletedMarkerRows: 0, physicalAfter };
}
