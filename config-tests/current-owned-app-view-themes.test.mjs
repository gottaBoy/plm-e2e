import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const filename = new URL('../tests/current-owned-app-view-themes.spec.ts', import.meta.url);
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true }, fileName: filename.pathname, reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);
const exports = {};
let browserTestRegistrations = 0;
vm.runInNewContext(compiled.outputText, {
  exports, module: { exports }, require: id => id === '@playwright/test'
    ? { test: () => { browserTestRegistrations++; }, expect: () => { throw new Error('No browser assertion may execute'); } }
    : require(id), process, Buffer, URL, setTimeout, clearTimeout,
  __dirname: path.dirname(filename.pathname),
}, { filename: filename.pathname });
const { ViewThemeDirectoryGate, validateOwnedViewTheme, decodeViewThemeResponse, stateProduct } = exports;
assert.equal(browserTestRegistrations, 1);
const endpoint = '/api/ibizplm__plmweb/extension/app_view_themes/fetch_cur_user_all';
const matchingQuery = { searchconds: [{ condop: 'EQ', condtype: 'DEFIELD',
  fieldname: 'app_view_tag', value: 'idea_all_grid_view' }] };

test('directory gate waits for and parses the exact authenticated current-view response', async () => {
  const gate = new ViewThemeDirectoryGate();
  const page = {};
  const pending = gate.wait(page, 0, 1000);
  assert.equal(gate.observeRequest({}, page, endpoint.replace('user_all', 'user'), 'POST', true, matchingQuery), false);
  assert.equal(gate.observeRequest({}, page, endpoint, 'GET', true, {}), false);
  assert.equal(gate.observeRequest({}, page, endpoint, 'POST', false, matchingQuery), false);
  assert.equal(gate.publish({}, []), false);
  const request = {};
  assert.equal(gate.observeRequest(request, page, endpoint, 'POST', true, matchingQuery), true);
  assert.equal(gate.publish(request, [{ id: 'system-1', app_view_tag: 'idea_all_grid_view' }]), true);
  const receipt = await pending;
  assert.equal(receipt.sequence, 1);
  assert.equal(receipt.rows[0].id, 'system-1');
  await assert.rejects(gate.wait({}, 0, 5), /directory deadline/);
});

test('directory gate rejects foreign view records and preserves HTTP error failures', () => {
  const gate = new ViewThemeDirectoryGate();
  const page = {};
  const request = {};
  gate.observeRequest(request, page, endpoint, 'POST', true, matchingQuery);
  assert.throws(() => gate.publish(request, [{ id: 'foreign', app_view_tag: 'other_view' }]));
  gate.fail(page, new Error('native HTTP 500'));
  return assert.rejects(gate.wait(page, 0, 100), /native HTTP 500/);
});

test('refresh waits for a newer parsed receipt from the same page rather than a cached list or another popup', async () => {
  const gate = new ViewThemeDirectoryGate();
  const page = {};
  const otherPage = {};
  const oldRequest = {};
  gate.observeRequest(oldRequest, page, endpoint, 'POST', true, matchingQuery);
  const beforeRefresh = gate.mark();
  const waiting = gate.wait(page, beforeRefresh, 1000);
  gate.publish(oldRequest, [{ id: 'old-response-arrived-after-refresh', app_view_tag: 'idea_all_grid_view' }]);
  const otherRequest = {};
  gate.observeRequest(otherRequest, otherPage, endpoint, 'POST', true, matchingQuery);
  gate.publish(otherRequest, [{ id: 'other-popup', app_view_tag: 'idea_all_grid_view' }]);
  assert.equal(gate.observeRequest({}, page, endpoint, 'POST', true, {
    searchconds: [{ ...matchingQuery.searchconds[0], value: 'foreign_view' }],
  }), false);
  await Promise.resolve();
  const refreshedRequest = {};
  gate.observeRequest(refreshedRequest, page, endpoint, 'POST', true, matchingQuery);
  gate.publish(refreshedRequest, [{ id: 'refreshed', app_view_tag: 'idea_all_grid_view' }]);
  const receipt = await waiting;
  assert.ok(receipt.sequence > beforeRefresh);
  assert.equal(receipt.rows[0].id, 'refreshed');
});

test('owned record validation rejects shared rows, wrong system, foreign user and unsafe IDs', () => {
  const actor = { srfuserid: 'person-1', srfdcsystemid: 'deploy-1' };
  const valid = { id: 'own-1', name: 'idea_all_grid_view___marker',
    caption: 'marker', owner_type: 'PERSONAL', app_view_tag: 'idea_all_grid_view',
    system_tag: 'deploy-1', create_man: 'person-1' };
  assert.equal(validateOwnedViewTheme(valid, actor, 'marker').id, 'own-1');
  for (const row of [
    { ...valid, owner_type: 'SYSTEM' }, { ...valid, app_view_tag: 'other' },
    { ...valid, system_tag: 'foreign' }, { ...valid, create_man: 'foreign' },
    { ...valid, id: '../foreign' }, { ...valid, name: 'marker' },
  ]) assert.throws(() => validateOwnedViewTheme(row, actor, 'marker'));
});

test('owned Unicode content remains verbatim and the recorded native ID is mandatory for later cleanup', () => {
  const marker = 'VT-owned 中文🙂 e\u0301 \' " \\\n';
  const actor = { srfuserid: 'issued-user', srfdcsystemid: 'issued-deployment' };
  const record = { id: 'native-owned-id', name: `idea_all_grid_view___${marker}`, caption: marker,
    owner_type: 'PERSONAL', app_view_tag: 'idea_all_grid_view',
    system_tag: actor.srfdcsystemid, create_man: actor.srfuserid };
  const before = JSON.stringify(record);
  assert.equal(validateOwnedViewTheme(record, actor, marker, record.id), record);
  assert.equal(JSON.stringify(record), before);
  assert.throws(() => validateOwnedViewTheme(record, actor, marker, 'another-native-id'));
  assert.throws(() => validateOwnedViewTheme({ ...record, create_man: undefined }, actor, marker, record.id));
});

test('only a native DELETE may return an empty success body; reads and saves require actual JSON', () => {
  assert.equal(decodeViewThemeResponse('DELETE', ''), null);
  assert.deepEqual(JSON.parse(JSON.stringify(decodeViewThemeResponse('POST', '[{"id":"native-id"}]'))),
    [{ id: 'native-id' }]);
  for (const method of ['GET', 'POST', 'PUT']) {
    assert.throws(() => decodeViewThemeResponse(method, ''));
    assert.throws(() => decodeViewThemeResponse(method, '  '));
    assert.throws(() => decodeViewThemeResponse(method, '{broken'));
  }
});

test('role UI navigation selects only the configured product returned by the actual directory', () => {
  const rows = [{ id: 'foreign', name: 'Other product' }, { id: 'owned', name: '产品🙂' }];
  assert.equal(stateProduct(rows, 'owned').name, '产品🙂');
  assert.throws(() => stateProduct(rows, 'missing'));
  assert.throws(() => stateProduct([...rows, rows[1]], 'owned'));
  assert.throws(() => stateProduct([{ id: 'owned', name: '' }], 'owned'));
});
