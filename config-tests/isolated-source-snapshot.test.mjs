import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  captureSourceSnapshot, declaredPluginOutputs, snapshotExclusions,
} from '../scripts/isolated-source-snapshot.mjs';

test('snapshot exclusions are anchored at the frontend root', () => {
  assert(snapshotExclusions.every(relative => relative.startsWith('/')));
});

test('actual rsync preserves nested plugin dist and node_modules, excluding only workspace roots', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plm-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const paths = [
    'src/main.ts', 'public/plugins/native/dist/index.es.js',
    'public/plugins/native/es/node_modules/dependency/dist/index.mjs',
    'plugin-src/native/dist/index.es.js', 'node_modules/ignore.js',
    'dist/ignore.js', '.git/ignore', '.artifacts/ignore', 'test-results/ignore',
  ];
  for (const relative of paths) {
    const target = path.join(source, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, relative);
  }
  const snapshot = path.join(root, 'snapshot');
  captureSourceSnapshot(source, snapshot);
  for (const relative of paths.slice(0, 4)) {
    assert.equal(fs.readFileSync(path.join(snapshot, relative), 'utf8'), relative);
  }
  for (const relative of paths.slice(4)) assert(!fs.existsSync(path.join(snapshot, relative)));
  assert.throws(() => captureSourceSnapshot(source, snapshot), /new directory/);
});

test('plugin inventory checks all unique manifest outputs and rejects missing bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plm-plugin-outputs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, 'plugins/native');
  fs.mkdirSync(path.join(base, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({
    main: 'dist/index.es.js', module: 'dist/index.es.js',
    system: 'dist/index.legacy.js', styles: ['dist/style.css'],
  }));
  for (const file of ['index.es.js', 'index.legacy.js', 'style.css']) {
    fs.writeFileSync(path.join(base, 'dist', file), file);
  }
  const result = declaredPluginOutputs(root, ['native']);
  assert.equal(result.pluginCount, 1);
  assert.equal(result.fileCount, 4);
  assert(result.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  fs.unlinkSync(path.join(base, 'dist/index.es.js'));
  assert.throws(() => declaredPluginOutputs(root, ['native']), /declared outputs must exist/);
  assert.throws(() => declaredPluginOutputs(root, ['absent']), /declared outputs must exist/);
});
