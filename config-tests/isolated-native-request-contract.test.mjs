import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'tests/isolated-plugin-functional.spec.ts');
const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
assert.equal(ast.parseDiagnostics.length, 0);
const declaration = ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'isPersistentBusinessRequest');
assert(declaration, 'test the actual browser request classifier');
const compiled = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length || 0, 0);
const sandbox = { exports: {}, URL };
vm.runInNewContext(compiled.outputText, sandbox, { filename: file });
const classify = (method, pathname) => sandbox.exports.isPersistentBusinessRequest({
  method, url: new URL(pathname, 'http://127.0.0.1:30252').href,
});

test('only POST datasets and the exact native product counter are treated as read-only', () => {
  assert.equal(classify('POST', '/api/ibizplm__plmweb/products/fetch_main?page=0'), false);
  assert.equal(classify('POST', '/api/ibizplm__plmweb/products/id/ideas/fetch_common'), false);
  assert.equal(classify('POST', '/api/ibizplm__plmweb/products/id/product_index_addon_counter'), false);
  assert.equal(classify('GET', '/api/ibizplm__plmweb/products/id'), false);
});

test('product CRUD and unknown POST actions still fail the navigation write boundary', () => {
  for (const pathname of [
    '/api/ibizplm__plmweb/products',
    '/api/ibizplm__plmweb/products/id/delete',
    '/api/ibizplm__plmweb/products/id/product_counters',
    '/api/ibizplm__plmweb/products/id/product_index_addon_counter_extra',
    '/api/ibizplm__plmweb/products/id/product_index_addon_counter/delete',
    '/api/ibizplm__other/products/id/product_index_addon_counter',
  ]) assert.equal(classify('POST', pathname), true, pathname);
});

test('PUT PATCH and DELETE cannot be hidden by a dataset or counter URL', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    for (const pathname of [
      '/api/ibizplm__plmweb/products/id',
      '/api/ibizplm__plmweb/products/fetch_main',
      '/api/ibizplm__plmweb/products/id/product_index_addon_counter',
    ]) assert.equal(classify(method, pathname), true, `${method} ${pathname}`);
  }
});

test('counter allowance is backed by the real READ action and dataset-only logic', () => {
  const entity = path.join(root, '../plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/product');
  const action = JSON.parse(fs.readFileSync(
    path.join(entity, 'PSDEACTIONS/product_index_addon_counter.json'), 'utf8'));
  assert.equal(action.codeName, 'product_index_addon_counter');
  assert.equal(action.dataAccessAction, 'READ');
  const logicPath = path.join(root, '../plm/model', action.getPSDELogic.path);
  const logic = JSON.parse(fs.readFileSync(logicPath, 'utf8'));
  assert(logic.getPSDELogicNodes.some(node => node.logicNodeType === 'DEDATASET'));
  assert(logic.getPSDELogicNodes.every(node =>
    ['BEGIN', 'PREPAREPARAM', 'DEDATASET', 'RAWSFCODE', 'END'].includes(node.logicNodeType)));
});
