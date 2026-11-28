import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRoleIdea, assertRoleMessagesUnchanged, cleanupRoleIdea, roleIdeaEffectSql,
} from '../tests/current-api-documentation-role-contract.mjs';

const scope = { productId: 'a'.repeat(32), id: 'b'.repeat(32),
  marker: 'CD-00000000-0000-4000-8000-000000000000' };
const title = `${scope.marker} 中文🙂 e\u0301 '"\\\n`;
const row = { id: scope.id, product_id: scope.productId, title };

test('role readback rejects empty 200, foreign resources and unchanged stale titles', () => {
  assertRoleIdea({ status: 200, value: row }, scope, title);
  for (const value of [[], {}, { ...row, id: 'foreign' }, { ...row, product_id: 'foreign' },
    { ...row, title: `${scope.marker} stale` }]) {
    assert.throws(() => assertRoleIdea({ status: 200, value }, scope, title));
  }
});

test('read-only SQL binds the actual Unicode marker/title and never interpolates raw business text', () => {
  const sql = roleIdeaEffectSql({ ...scope, title, actorId: 'nat_0123456789ab_readonly' });
  assert.ok(sql.startsWith('START TRANSACTION READ ONLY;\nSELECT JSON_OBJECT('));
  assert.ok(sql.endsWith(');\nCOMMIT;\n'));
  assert.ok(sql.includes(Buffer.from(scope.marker).toString('hex')));
  assert.ok(sql.includes(Buffer.from(title).toString('hex')));
  assert.ok(!sql.includes(title));
  assert.equal((sql.match(/AS |COUNT\(\*\)|MIN\(|MAX\(/g) ?? []).length, 14);
  assert.throws(() => roleIdeaEffectSql({ ...scope, marker: 'synthetic-marker', title,
    actorId: 'nat_0123456789ab_readonly' }));
});

test('messages with the actual marker remain untouched rather than being deleted from weak ownership guesses', () => {
  const before = [{ id: 'old', status: 'RECEIVED', content: 'unrelated' }];
  assertRoleMessagesUnchanged(before, before, scope.marker);
  assert.throws(() => assertRoleMessagesUnchanged(before,
    [...before, { id: 'new', content: title, receiver: 'any' }], scope.marker));
  assert.throws(() => assertRoleMessagesUnchanged(before, [{ ...before[0], status: 'READ' }], scope.marker));
});

function cleanupFixture({ failDelete = false, foreign = false } = {}) {
  let present = true;
  const calls = [];
  return {
    calls,
    run: () => cleanupRoleIdea({ scope, titles: [title], journal: async () => {},
      physical: async () => ({ status: 'PASS_READ_ONLY',
        value: { plannedIdeaRows: 0, ownPrefixIdeaRows: 0 } }),
      async request(method, suffix) {
        calls.push({ method, suffix });
        if (method === 'DELETE') {
          if (failDelete) return { status: 500 };
          present = false;
          return { status: 200 };
        }
        if (method === 'GET') return present
          ? { status: 200, value: { ...row, ...(foreign ? { product_id: 'foreign' } : {}) } }
          : { status: 404 };
        return { status: 200, value: [], headers: { 'x-total': '0' } };
      } }),
  };
}

test('cleanup proves exact ownership, durable intent, keyed absence and three complete native datasets', async () => {
  const f = cleanupFixture();
  const result = await f.run();
  assert.equal(result.status, 'PASS');
  assert.equal(f.calls.filter(row => row.method === 'DELETE').length, 1);
  assert.equal(f.calls.filter(row => row.method === 'POST').length, 3);
  const foreign = cleanupFixture({ foreign: true });
  await assert.rejects(foreign.run());
  assert.equal(foreign.calls.some(row => row.method === 'DELETE'), false);
  await assert.rejects(cleanupFixture({ failDelete: true }).run());
});
