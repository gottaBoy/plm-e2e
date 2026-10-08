import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const file = fileURLToPath(new URL('../tests/modeling-ide-contract.ts', import.meta.url));
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
// The contract parses URLs, so the sandbox needs the host URL constructor.
runInNewContext(code, { exports, URL });
const { modelingCounterValue, modelingAppIdentity } = exports;
const {
  isExpectedExtensionManifestConsole,
  isExpectedExtensionManifestMiss,
} = exports;

test('counter accepts the observed decimal-string DTO and safe nonnegative numeric counts', () => {
  for (const [raw, expected] of [['0', 0], ['123', 123], [0, 0], [123, 123]]) {
    assert.equal(modelingCounterValue({ my_todo_count: raw }), expected);
  }
});

test('counter rejects error bodies, absent counts, coercion, fractions and overflow', () => {
  for (const body of [null, [], 'html', {}, { code: 500 }, { other_count: 0 }]) {
    assert.throws(() => modelingCounterValue(body), /DTO with my_todo_count/);
  }
  for (const value of ['', ' ', '-1', '+1', '1.2', '1e2', 'Infinity', true, null,
    {}, [], NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    assert.throws(() => modelingCounterValue({ my_todo_count: value }), /integer/);
  }
});

test('ModelDesign namespace identity rejects the observed PLM fallback and renamed system', () => {
  const identity = modelingAppIdentity({ codeName: 'ModelDesign', sysCodeName: 'ibizmodeling' });
  assert.equal(identity.codeName, 'ModelDesign');
  for (const body of [
    { codeName: 'plmweb', sysCodeName: 'ibizplm' },
    { codeName: 'ModelDesign', sysCodeName: 'ibizplm' },
    { codeName: 'plmweb', sysCodeName: 'ibizmodeling' },
    { caption: 'Modeling建模平台' }, null, [],
  ]) assert.throws(() => modelingAppIdentity(body), /application model|PLM fallback/);
});

const manifest404 = {
  status: 404,
  url: 'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/remotemodel/ext/package.json',
};

test('the documented no-extension-plugin miss stays the only expected diagnostic', () => {
  assert.equal(isExpectedExtensionManifestMiss(manifest404), true);
  assert.equal(
    isExpectedExtensionManifestMiss({ ...manifest404, status: 500 }), false);
  assert.equal(
    isExpectedExtensionManifestMiss({ ...manifest404, status: 403 }), false);
  for (const url of [
    'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.hub.json',
    'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/remotemodel/ext/index.js',
    'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/remotemodel/ext/package.json/extra',
    'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/work_items/count_my_todo',
    'http://127.0.0.1:32009/modeldesign/plugins//api/ibizmodeling__modeldesign/remotemodel/ext/package.json',
    'not a url',
  ]) assert.equal(isExpectedExtensionManifestMiss({ status: 404, url }), false, url);
});

test('console classification follows the response classification', () => {
  const message = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
  assert.equal(
    isExpectedExtensionManifestConsole({ message, source: manifest404.url }), true);
  assert.equal(isExpectedExtensionManifestConsole({
    message: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
    source: manifest404.url,
  }), false);
  assert.equal(isExpectedExtensionManifestConsole({
    message, source: 'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.hub.json',
  }), false);
  assert.equal(
    isExpectedExtensionManifestConsole({ message: 'TypeError: Ue is not a function', source: '' }), false);
});

test('the E2E classifier cannot drift from the modelingweb candidate checker', async () => {
  const canonical = await import('../../modelingweb/app/scripts/check-source-candidate.mjs');
  const inputs = [
    manifest404,
    { status: 500, url: manifest404.url },
    { status: 404, url: 'http://127.0.0.1:32009/api/ibizplm__plmweb/remotemodel/ext/package.json' },
    { status: 404, url: 'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.hub.json' },
    { status: 404, url: 'http://127.0.0.1:32009/modeldesign/plugins//api/ibizmodeling__modeldesign/remotemodel/ext/package.json' },
    { status: 200, url: manifest404.url },
  ];
  for (const item of inputs) {
    assert.equal(isExpectedExtensionManifestMiss(item), canonical.isExpectedExtensionManifestMiss(item), item.url);
  }
});
