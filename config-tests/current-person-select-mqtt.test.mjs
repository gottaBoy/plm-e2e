import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const file = new URL('../tests/current-owned-product-helper.ts', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true }, reportDiagnostics: true, fileName: file.pathname,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);
const exports = {};
vm.runInNewContext(compiled.outputText, {
  exports, module: { exports }, require, process, Buffer, setTimeout, clearTimeout,
  __dirname: path.resolve(new URL('.', file).pathname),
}, { filename: file.pathname });

const marker = 'PS-12345678-1234-4234-8234-123456789abc';
const message = event => ({ subtype: 'INTERNALMESSAGE', content:
  `<div><span class="notice-card__event-desc">${event}</span>` +
  `<span class="notice-card__object-name">${marker} idea</span>` +
  '<span class="notice-card__object-id">PS123</span></div>' });
const classify = exports.classifyOwnedMqttBusinessEvent;
const payload = value => Buffer.from(JSON.stringify(value));

test('omitting MQTT mode retains the existing declared six product event semantics', () => {
  for (const event of exports.productNotificationEvents) {
    const input = message(event.text);
    const actual = classify(input, payload(input), marker);
    assert.equal(actual.businessEvent, event.text);
    assert.equal(actual.businessEventMode, 'product');
    assert.equal(actual.businessEventSemanticsValidated, true);
  }
  const idea = message('把需求分配给了你');
  assert.throws(() => classify(idea, payload(idea), marker), /unknown product event/);
});

test('explicit observe mode records the same real nonce event without claiming validated product semantics', () => {
  const idea = message('把需求分配给了你');
  const before = structuredClone(idea);
  const raw = payload(idea);
  const actual = classify(idea, raw, marker, 'observe');
  assert.equal(actual.businessEvent, '把需求分配给了你');
  assert.equal(actual.businessEventMode, 'observe');
  assert.equal(actual.businessEventSemanticsValidated, false);
  assert.deepEqual(idea, before);
  assert.deepEqual(raw, payload(before));
  assert.equal(Object.keys(classify(idea, raw, 'different-nonce', 'observe')).length, 0);
});

test('observation still rejects malformed owned content and invalid mode instead of suppressing capture errors', () => {
  const broken = { subtype: 'INTERNALMESSAGE', content: `${marker} no declared template fields` };
  assert.throws(() => classify(broken, payload(broken), marker, 'observe'));
  const active = message('把需求分配给了你');
  active.content += '<script>not executed</script>';
  assert.throws(() => classify(active, payload(active), marker, 'observe'), /active/);
  assert.throws(() => classify(message('加入'), payload(message('加入')), marker, 'unknown'));
  assert.ok(source.includes('evidence.captureErrors.push(`Owned MQTT notification content:'));
  assert.ok(source.includes("options.businessEventMode ?? 'product'"));
});

function languageInitializer(sourceText) {
  const parsed = ts.createSourceFile(file.pathname, sourceText, ts.ScriptTarget.Latest, true);
  let callback;
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.getText(parsed) === 'context.addInitScript') {
      assert.equal(callback, undefined);
      callback = node.arguments[0].getText(parsed);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(callback);
  return callback;
}

function runLanguageInitializer(callback, selected, initial) {
  const data = new Map(initial === null ? [] : [['language', initial]]);
  const initialize = vm.runInNewContext(`(${callback})`, {
    location: { protocol: 'http:' },
    localStorage: { getItem: key => data.has(key) ? data.get(key) : null,
      setItem: (key, value) => data.set(key, value) },
  });
  initialize(selected);
  return data.get('language');
}

test('the actual login initializer selects zh/en only for a fresh context and preserves real UI changes on reload', () => {
  const initialize = languageInitializer(source);
  for (const selected of ['zh-CN', 'en']) {
    assert.equal(runLanguageInitializer(initialize, selected, null), selected);
    const switched = selected === 'en' ? 'zh-CN' : 'en';
    assert.equal(runLanguageInitializer(initialize, selected, switched), switched);
    assert.equal(runLanguageInitializer(initialize, selected, ''), '');
  }
});

test('the previous unconditional initializer is a negative control for persistent UI language switching', () => {
  const current = languageInitializer(source);
  const previous = current.replace(/\s*&& localStorage\.getItem\('language'\) === null/, '');
  assert.notEqual(previous, current);
  assert.equal(runLanguageInitializer(previous, 'zh-CN', 'en'), 'zh-CN');
  assert.equal(runLanguageInitializer(current, 'zh-CN', 'en'), 'en');
});
