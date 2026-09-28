import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function evaluate(relativePath, { env = {}, dependencies = {} } = {}) {
  const filename = path.join(repoRoot, relativePath);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  const logs = [];
  runInNewContext(code, {
    exports,
    __dirname: repoRoot,
    process: { env },
    console: { log: message => logs.push(message) },
    require: name => dependencies[name] ?? require(name),
  }, { filename });
  return { value: exports.default, env, logs };
}

function loadConfig(env = {}) {
  return evaluate('playwright.config.ts', { env });
}

function artifactPaths(config) {
  return [
    config.outputDir,
    config.reporter.find(([name]) => name === 'html')[1].outputFolder,
    config.reporter.find(([name]) => name === 'json')[1].outputFile,
    config.metadata.storageState,
  ];
}

test('independent invocations isolate output, both reports and authentication', () => {
  const first = loadConfig();
  const second = loadConfig();
  artifactPaths(first.value).forEach((value, index) => {
    assert.ok(path.isAbsolute(value));
    assert.notEqual(value, artifactPaths(second.value)[index]);
    assert.ok(value.startsWith(`${first.value.metadata.artifactDir}${path.sep}`));
  });
  assert.equal(first.value.projects[1].use.storageState, first.value.metadata.storageState);
  assert.equal(first.value.projects[2].use.storageState, first.value.metadata.storageState);
  assert.ok(first.logs.some(line => line.includes(artifactPaths(first.value)[1])));
  assert.ok(first.logs.some(line => line.includes(artifactPaths(first.value)[2])));
});

test('worker config reloads reuse the coordinator paths without logging again', () => {
  const coordinator = loadConfig();
  const worker = loadConfig({ ...coordinator.env, TEST_WORKER_INDEX: '0' });
  assert.deepEqual(artifactPaths(worker.value), artifactPaths(coordinator.value));
  assert.equal(worker.logs.length, 0);
});

test('artifact directory override remains exact and takes precedence over inherited run paths', () => {
  const config = loadConfig({
    PLM_E2E_ARTIFACT_DIR: 'test-results/custom-run',
    PLM_E2E_RUN_ARTIFACT_DIR: '/tmp/previous-run',
  }).value;
  assert.equal(config.metadata.artifactDir, path.resolve('test-results/custom-run'));
  artifactPaths(config).forEach(value => {
    assert.ok(value.startsWith(`${config.metadata.artifactDir}${path.sep}`));
  });
});

test('output and report directory overrides do not move shared authentication into outputDir', () => {
  const config = loadConfig({
    PLM_E2E_OUTPUT_DIR: 'test-results/custom-output',
    PLM_E2E_REPORT_DIR: 'test-results/custom-reports',
  }).value;
  const paths = artifactPaths(config);
  assert.equal(paths[0], path.resolve('test-results/custom-output'));
  assert.equal(paths[1], path.resolve('test-results/custom-reports/playwright-report'));
  assert.equal(paths[2], path.resolve('test-results/custom-reports/test-results.json'));
  assert.equal(paths[3], path.join(config.metadata.artifactDir, 'playwright/.auth/user.json'));
  assert.ok(!paths[3].startsWith(`${paths[0]}${path.sep}`));
});

test('authentication setup writes only the storageState supplied by its invocation config', async () => {
  let authenticate;
  const calls = [];
  const storageState = path.join(repoRoot, 'test-results/runs/setup-test/playwright/.auth/user.json');
  evaluate('tests/auth.setup.ts', {
    env: { PLM_E2E_ARTIFACT_DIR: '/tmp/another-invocation' },
    dependencies: {
      '@playwright/test': {
        test: (_name, callback) => { authenticate = callback; },
        expect: () => ({
          toHaveTitle: async () => {},
          toBeVisible: async () => {},
        }),
      },
      './helpers': { login: async () => {} },
      'node:fs/promises': {
        mkdir: async (directory, options) => {
          calls.push(['mkdir', directory, options.recursive]);
        },
      },
    },
  });
  const page = {
    getByText: () => ({ first: () => ({}) }),
    context: () => ({ storageState: async options => calls.push(['save', options.path]) }),
  };
  await authenticate({ page }, { config: { metadata: { storageState } } });
  assert.deepEqual(calls, [
    ['mkdir', path.dirname(storageState), true],
    ['save', storageState],
  ]);
  await assert.rejects(
    authenticate({ page }, { config: { metadata: {} } }),
    /Missing invocation-specific storageState/,
  );
});
