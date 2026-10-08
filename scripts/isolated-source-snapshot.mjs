import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Exclude only build/workspace roots; plugin outputs and dependencies are inputs.
export const snapshotExclusions = [
  '/node_modules', '/dist', '/.git', '/.artifacts', '/test-results',
];

export function captureSourceSnapshot(source, destination) {
  assert(!fs.existsSync(destination), 'candidate snapshot must be a new directory');
  fs.mkdirSync(destination, { recursive: true });
  execFileSync('rsync', [
    '-a', ...snapshotExclusions.map(relative => `--exclude=${relative}`),
    `${source}/`, `${destination}/`,
  ], { stdio: 'inherit' });
}

export function declaredPluginOutputs(root, refs) {
  const files = [];
  const failures = [];
  for (const ref of refs) {
    const base = path.join(root, 'plugins', ref);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
    } catch (error) {
      failures.push({ ref, path: 'package.json', error: String(error) });
      continue;
    }
    const outputs = new Set([
      'package.json',
      ...['main', 'module', 'system'].flatMap(field => manifest[field] ? [manifest[field]] : []),
      ...(manifest.styles || []),
    ]);
    for (const output of outputs) {
      const relative = path.posix.join('plugins', ref, output);
      try {
        const bytes = fs.readFileSync(path.join(root, relative));
        files.push({
          ref, path: relative, bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } catch (error) {
        failures.push({ ref, path: output, error: String(error) });
      }
    }
  }
  assert.deepEqual(failures, [], 'all runtime plugin manifests and declared outputs must exist');
  return { pluginCount: refs.length, fileCount: files.length, files };
}
