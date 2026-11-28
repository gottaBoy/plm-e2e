import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
  classifyPersonSelectFault, pagePersonSelectRows, personSelectEditorRequest, personSelectIdeaProjection,
  readPersonSelectPrivateJson, samePersonSelectRequest, validatePersonSelectIdea,
  validatePersonSelectNotification, validatePersonSelectScope,
} from '../tests/current-person-select-contract.mjs';

const marker = 'PS-12345678-1234-4234-8234-123456789abc';
const title = `${marker} 需求🙂 e\u0301 ' " \\`;
const scope = { marker, title, productId: 'owned-product', actorIds: ['native-ordinary'],
  ideaId: 'owned-idea', startedAt: new Date().toISOString(), showIdentifier: 'OWN-17' };
const idea = { id: scope.ideaId, product_id: scope.productId, title, create_man: 'native-ordinary',
  assignee_id: 'native-objectadmin', assignee_name: '实际成员🙂 e\u0301' };
const prefix = '/api/ibizplm__plmweb';
const request = { url: `http://127.0.0.1:30250${prefix}/products/owned-product/product_members/fetch_default`,
  method: 'POST', body: { page: 0, size: 20, query: '实际成员🙂 e\u0301', n_status_eq: '1' } };
const descriptor = () => personSelectEditorRequest(structuredClone(request), scope.productId, prefix);

test('owned idea cleanup requires exact nonce, full Unicode title, retained product, creator and recorded ID', () => {
  const before = structuredClone(idea);
  assert.equal(validatePersonSelectIdea(idea, scope), idea);
  assert.deepEqual(idea, before);
  for (const altered of [
    { ...idea, id: 'foreign-id' }, { ...idea, title: `${title} suffix` },
    { ...idea, title: title.normalize('NFC') }, { ...idea, title: marker },
    { ...idea, product_id: 'another-product' }, { ...idea, create_man: 'other-actor' },
    { ...idea, id: '../foreign' }, [], null,
  ]) assert.throws(() => validatePersonSelectIdea(altered, scope));
  assert.throws(() => validatePersonSelectScope({ ...scope, marker: `${marker}-suffix` }));
  assert.throws(() => validatePersonSelectScope({ ...scope, actorIds: [] }));
  const { ideaId, ...unconfirmed } = scope;
  assert.equal(validatePersonSelectIdea(idea, unconfirmed).id, ideaId);
});

test('a private fixture must be a real owned file with no group/world access', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aibiz-person-private-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'fixture.json');
  fs.writeFileSync(file, '{"retained":true}', { mode: 0o600 });
  assert.deepEqual(readPersonSelectPrivateJson(file), { retained: true });
  fs.symlinkSync(file, path.join(root, 'link.json'));
  assert.throws(() => readPersonSelectPrivateJson(path.join(root, 'link.json')));
  fs.chmodSync(file, 0o644);
  assert.throws(() => readPersonSelectPrivateJson(file));
});

test('editor request identity binds real loopback origin, exact product route, method, query and page', () => {
  const actual = descriptor();
  assert.equal(actual.body.query, request.body.query);
  assert.equal(samePersonSelectRequest(actual, { ...actual, body: { query: actual.body.query,
    n_status_eq: '1', size: 20, page: 0 } }), true);
  for (const altered of [
    { ...request, url: request.url.replace('127.0.0.1', 'outside.example') },
    { ...request, url: request.url.replace('owned-product', 'foreign') },
    { ...request, method: 'GET' }, { ...request, url: `${request.url}?query=other` },
    { ...request, body: { page: -1, size: 20 } }, { ...request, body: { page: 0, size: 0 } },
    { ...request, body: { page: 0, size: 20, query: ['invalid'] } },
  ]) assert.throws(() => personSelectEditorRequest(altered, scope.productId, prefix));
  assert.equal(samePersonSelectRequest(actual, { ...actual, body: { ...actual.body, page: 1 } }), false);
  assert.equal(samePersonSelectRequest(actual, { ...actual, body: { ...actual.body, query: 'other' } }), false);
});

test('one precise aborted request can be classified only after the same observed request recovers', () => {
  const observed = descriptor();
  const failure = { phase: 'authenticated', path: observed.path, method: 'POST', error: 'net::ERR_FAILED' };
  const otherFailure = { ...failure, path: '/unrelated' };
  const console = { phase: 'authenticated', path: observed.path,
    message: 'Failed to load resource: net::ERR_FAILED' };
  const fault = { abortedCount: 1, observedBeforeAbort: observed, injectedRequest: descriptor(),
    recoveredRequest: descriptor(), failureEvents: [{ rawIndex: 0, requestIsExactAbortedObject: true }],
    consoleEvents: [{ rawIndex: 0, exactAbortedUrl: observed.url }] };
  const actual = classifyPersonSelectFault([failure, otherFailure], [console], fault);
  assert.deepEqual(actual.expectedFailed, [failure]);
  assert.deepEqual(actual.unexpectedFailed, [otherFailure]);
  assert.deepEqual(actual.expectedConsole, [console]);
  for (const altered of [
    { ...fault, recoveredRequest: { ...observed, body: { ...observed.body, page: 1 } } },
    { ...fault, recoveredRequest: undefined },
    { ...fault, failureEvents: [{ rawIndex: 0, requestIsExactAbortedObject: false }] },
    { ...fault, failureEvents: [...fault.failureEvents, ...fault.failureEvents] },
    { ...fault, consoleEvents: [{ rawIndex: 0, exactAbortedUrl: `${observed.url}?foreign` }] },
  ]) assert.throws(() => classifyPersonSelectFault([failure], [console], altered));
  assert.throws(() => classifyPersonSelectFault([{ ...failure, error: 'net::ERR_CONNECTION_RESET' }], [console], fault));
  assert.equal(classifyPersonSelectFault([failure], [console], { abortedCount: 0 }).unexpectedFailed.length, 1);
});

test('raw business projection detects ID, display value, title, state, version and modification side effects', () => {
  const projection = personSelectIdeaProjection(idea);
  for (const [key, value] of Object.entries({ assignee_id: 'different', assignee_name: 'Another name',
    title: 'changed', state: '20', cur_version_id: 'new-version', update_time: 'later', product_id: 'foreign' })) {
    assert.notDeepEqual(personSelectIdeaProjection({ ...idea, [key]: value }), projection);
  }
});

test('native pagination requires totals and rejects empty HTTP 200, hidden pages and changing collections', async () => {
  const entries = Array.from({ length: 103 }, (_, index) => ({ id: `own-${index}` }));
  const requestRows = async (_method, _suffix, body) => ({ status: 200,
    value: entries.slice(body.page * 100, (body.page + 1) * 100), headers: { 'x-total': '103' } });
  assert.deepEqual(await pagePersonSelectRows(requestRows, '/versions/fetch_default', { n_owner_id_eq: scope.ideaId }), entries);
  await assert.rejects(pagePersonSelectRows(async () => ({ status: 200, value: [], headers: {} }), '/empty'));
  await assert.rejects(pagePersonSelectRows(async () => ({ status: 200, value: [], headers: { 'x-total': '1' } }), '/hidden'));
  await assert.rejects(pagePersonSelectRows(async (_method, _suffix, body) => ({
    ...(await requestRows(_method, _suffix, body)), headers: { 'x-total': body.page ? '104' : '103' },
  }), '/changing'));
  assert.deepEqual(await pagePersonSelectRows(async () => ({ status: 200, value: [],
    headers: { 'x-total': '0' } }), '/genuine-empty'), []);
});

test('notification cleanup binds native receiver, source event, full idea name, source links and creation window', () => {
  const identity = { srfuserid: 'native-objectadmin', srfpersonid: 'native-person',
    srfdcsystemid: 'native-system' };
  const template = { contentType: 'HTML', expectedEvent: '给你分配了需求',
    taskUrl: 'view://idea_main_view?srfnavctx={"idea":"${data.id}","product":"${data.product_id}"}',
    mobTaskUrl: 'view://idea_mob_edit_view?srfnavctx={"idea":"${data.id}","product":"${data.product_id}"}' };
  const fill = value => value.replaceAll('${data.id}', scope.ideaId).replaceAll('${data.product_id}', scope.productId);
  const row = { id: 'own-message', receiver: identity.srfuserid, owner_id: identity.srfpersonid,
    system_tag: identity.srfdcsystemid, owner_type: 'PERSONAL', content_type: 'HTML', status: 'RECEIVED',
    message_type: 'idea_assignee', content: `<div>${title}</div>`,
    url: fill(template.taskUrl), mobile_url: fill(template.mobTaskUrl),
    create_time: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) };
  const rendered = { name: title, identifier: scope.showIdentifier, event: template.expectedEvent };
  const templates = { idea_assignee: template };
  assert.equal(validatePersonSelectNotification(row, scope, identity, templates, rendered), row);
  for (const altered of [
    { ...row, receiver: 'foreign' }, { ...row, owner_id: 'foreign' }, { ...row, system_tag: 'foreign' },
    { ...row, message_type: 'idea_review_complete' }, { ...row, create_time: '2025-01-01 00:00:00' },
    { ...row, url: row.url.replace(scope.ideaId, 'foreign') }, { ...row, mobile_url: '' },
    { ...row, id: '../foreign' },
  ]) assert.throws(() => validatePersonSelectNotification(altered, scope, identity, templates, rendered));
  assert.throws(() => validatePersonSelectNotification(row, scope, identity, templates, { ...rendered, name: `${title} suffix` }));
  assert.throws(() => validatePersonSelectNotification(row, scope, identity, templates, { ...rendered, event: '了' }));
});

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const configFile = new URL('../playwright.current-person-select.config.ts', import.meta.url);
const specFile = new URL('../tests/current-person-select.spec.ts', import.meta.url);

function transpile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { fileName: file.pathname, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  return { source, compiled: result.outputText };
}

test('the native runner has four isolated language/viewport projects and no service startup or automatic retry', () => {
  const { compiled } = transpile(configFile);
  const exports = {}, directories = [];
  const testProcess = { env: { PLM_CURRENT_PERSON_SELECT_ARTIFACT_DIR: undefined } };
  const localRequire = name => name === '@playwright/test' ? { defineConfig: value => value }
    : name === 'node:fs' ? { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      mkdirSync: (directory, options) => directories.push({ directory, options }) } : require(name);
  vm.runInNewContext(compiled, { exports, module: { exports }, require: localRequire, process: testProcess,
    __dirname: path.dirname(configFile.pathname) });
  const config = exports.default;
  assert.equal(config.workers, 1);
  assert.equal(config.fullyParallel, false);
  assert.equal(config.retries, 0);
  assert.equal(config.maxFailures, 1);
  assert.equal(config.use.serviceWorkers, 'block');
  assert.equal(config.webServer, undefined);
  assert.equal(config.projects.length, 4);
  assert.equal(new Set(config.projects.map(project => `${project.use.locale}/${project.use.viewport.width}`)).size, 4);
  assert.equal(config.projects.filter(project => project.use.isMobile && project.use.hasTouch).length, 2);
  assert.equal(directories.length, 1);
  assert.equal(directories[0].options.mode, 0o700);
  assert.equal(directories[0].options.recursive, undefined);
});

test('native spec compiles without invoking a browser and never injects a controller, forced click or success response', () => {
  const { source } = transpile(specFile);
  const parsed = ts.createSourceFile(specFile.pathname, source, ts.ScriptTarget.Latest, true);
  const forbidden = [];
  let finallyBody;
  const walk = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (['evaluate', 'evaluateHandle', 'fulfill', 'dispatchEvent'].includes(node.expression.name.text)) {
        forbidden.push(node.expression.getText(parsed));
      }
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === 'force') forbidden.push('force');
    if (ts.isTryStatement(node) && node.finallyBlock?.getText(parsed).includes('before-exact-owned-idea-remove')) {
      finallyBody = node.finallyBlock.getText(parsed);
    }
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  assert.deepEqual(forbidden, []);
  assert.ok(finallyBody?.includes("admin('DELETE'"));
  assert.ok(finallyBody?.includes('validatePersonSelectIdea(current.value, scope)'));
  assert.ok(finallyBody?.includes('normalArchivedDeletedMarkerRows: 0'));
  assert.ok(source.includes("businessEventMode: 'observe'"));
  assert.ok(source.includes('createProductEvidence(testInfo, marker, credentials.ordinary)'));
  assert.ok(!source.includes('storageState') && !source.includes('request.newContext'));
});
