import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const filename = new URL('../tests/current-owned-knowledge-helper.ts', import.meta.url);
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
const { validateKnowledgeIdentity, validateOwnedKnowledgePage,
  validateOwnedKnowledgeHome, assertKnowledgeRuntimeUnchanged, performKnowledgeAction } = exports;

test('knowledge writes require the normal login actor, real organization and PLM application', () => {
  const context = { srfuserid: 'actual-id', srfloginname: 'actual-login',
    srfsystemid: 'ibizplm', srforgid: 'actual-org' };
  const headers = { srfsystemid: 'ibizplm', srforgid: 'actual-org' };
  const credentials = { username: 'actual-login' };
  assert.equal(validateKnowledgeIdentity(context, headers, credentials), true);
  for (const changed of [
    { ...context, srfsystemid: 'another-app' }, { ...context, srforgid: '' },
    { ...context, srforgid: 'another-org' }, { ...context, srfloginname: 'another-login' },
    { ...context, srfuserid: '' }, undefined, [],
  ]) assert.throws(() => validateKnowledgeIdentity(changed, headers, credentials));
});

test('page cleanup requires exact current-run title and space, and recorded ID when available', () => {
  const row = { id: 'owned-page', space_id: 'owned-space', name: 'CK-exact 页面🙂' };
  const owned = { spaceId: row.space_id, title: row.name, pageId: row.id };
  assert.equal(validateOwnedKnowledgePage(row, owned), row);
  assert.equal(validateOwnedKnowledgePage(row, { spaceId: owned.spaceId, title: owned.title }), row);
  for (const changed of [
    { ...row, id: 'another-page' }, { ...row, space_id: 'another-space' },
    { ...row, name: `${row.name} suffix` }, { ...row, id: '../another-page' },
    { ...row, id: '' }, undefined, [],
  ]) assert.throws(() => validateOwnedKnowledgePage(changed, owned));
});

test('runtime checks retain complete raw mounts while rejecting byte and lifecycle drift', () => {
  const mounts = [
    { Type: 'bind', Source: '/model', Destination: '/app/model', RW: false, Propagation: 'rprivate' },
    { Type: 'bind', Source: '/health', Destination: '/health', RW: false, Propagation: 'rprivate' },
  ];
  const before = [{ name: 'plmservice', id: 'exact-container', imageId: 'exact-image',
    startedAt: 'exact-start', restartCount: 0, configurationSha256: 'exact-config',
    mounts, mountsSha256: 'raw-one', provider: { sha256: 'exact-jar', metadata: 'exact-inode' } }];
  const reordered = [{ ...before[0], mounts: [...mounts].reverse(), mountsSha256: 'raw-two' }];
  assert.equal(assertKnowledgeRuntimeUnchanged(before, reordered).status, 'PASS');
  for (const mutation of [
    row => { row.provider.sha256 = 'another-jar'; },
    row => { row.provider.metadata = 'another-inode'; },
    row => { row.startedAt = 'another-start'; },
    row => { row.restartCount = 1; },
    row => { row.mounts[0].Propagation = 'rshared'; },
    row => { row.mounts[0].RW = true; },
    row => { row.mounts[0].UnknownFutureField = true; },
  ]) {
    const changed = structuredClone(reordered);
    mutation(changed[0]);
    assert.throws(() => assertKnowledgeRuntimeUnchanged(before, changed));
  }
});

test('an automatically created home is eligible only under the source-defined parent ID and actual creator', () => {
  const model = JSON.parse(readFileSync(new URL(
    '../../plm/model/PSMODULES/Wiki/PSDATAENTITIES/space/PSDELOGICS/auto_create_home_page.json', import.meta.url)));
  const params = model.getPSDELogicNodes.find(node => node.codeName === 'PREPAREPARAM1').getPSDELogicNodeParams;
  for (const field of ['ID', 'SPACE_ID']) {
    const parameter = params.find(item => item.dstFieldName === field);
    assert.equal(parameter.srcValueType, 'SRCDLPARAM');
    assert.equal(parameter.srcFieldName, 'ID');
    assert.equal(parameter.getSrcPSDELogicParam.id, 'Default');
  }
  assert.equal(params.find(item => item.dstFieldName === 'NAME').srcValue, '主页');
  const row = { id: 'owned-space', space_id: 'owned-space', name: '主页',
    type: '1', format_type: 'HTML', create_man: 'actual-user' };
  const owned = { spaceId: 'owned-space', actorId: 'actual-user' };
  assert.equal(validateOwnedKnowledgeHome(row, owned), row);
  for (const changed of [
    { ...row, id: 'another-page' }, { ...row, space_id: 'another-space' },
    { ...row, name: 'another-title' }, { ...row, type: '2' },
    { ...row, format_type: 'MD' }, { ...row, create_man: 'another-user' },
  ]) assert.throws(() => validateOwnedKnowledgeHome(changed, owned));
});

test('an action failure retains its cause while a late response-wait rejection is handled during cleanup', async () => {
  let rejectResponse;
  const response = new Promise((resolve, reject) => { rejectResponse = reject; });
  const failure = new Error('the normal close control was unavailable');
  await assert.rejects(performKnowledgeAction({ waitForResponse: () => response },
    () => true, async () => { throw failure; }), error => error === failure);
  rejectResponse(new Error('the context closed after cleanup'));
  await new Promise(resolve => setTimeout(resolve, 0));
  const observed = { status: () => 200 };
  assert.equal(await performKnowledgeAction({ waitForResponse: () => Promise.resolve(observed) },
    () => true, async () => {}), observed);
});
