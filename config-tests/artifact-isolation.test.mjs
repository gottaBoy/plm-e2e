import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const mobileGate = path.join(repoRoot, 'scripts/mobile-skip-gate.mjs');

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

function createTest({ projectName, status, title, file = 'interactions.spec.ts' }) {
  const resultStatus =
    status === 'skipped' ? 'skipped' : status === 'expected' ? 'passed' : 'failed';
  const results =
    status === 'flaky'
      ? [{ status: 'failed' }, { status: 'passed' }]
      : [{ status: resultStatus }];
  return {
    file,
    spec: {
      title,
      tests: [{ projectName, expectedStatus: 'passed', status, results }],
    },
  };
}

function createReport({ mobileTests = [], setupTests = [], desktopTests = [] } = {}) {
  const testsByFile = new Map();
  for (const item of [...setupTests, ...desktopTests, ...mobileTests]) {
    if (!testsByFile.has(item.file)) testsByFile.set(item.file, []);
    testsByFile.get(item.file).push(item.spec);
  }

  return {
    suites: [...testsByFile].map(([file, specs]) => ({ file, specs })),
    stats: {
      expected: 0,
      skipped: 0,
      unexpected: 99,
      flaky: 99,
    },
  };
}

function writeReport(artifactDir, report) {
  const reportFile = path.join(artifactDir, 'reports', 'test-results.json');
  mkdirSync(path.dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report));
  return reportFile;
}

function runMobileGate({ artifactDir, reportFile } = {}) {
  const env = { ...process.env };
  delete env.PLM_E2E_ARTIFACT_DIR;
  delete env.PLM_E2E_REPORT_FILE;
  if (artifactDir) env.PLM_E2E_ARTIFACT_DIR = artifactDir;
  if (reportFile) env.PLM_E2E_REPORT_FILE = reportFile;
  return spawnSync(process.execPath, [mobileGate], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
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

test('mobile skip gate reads the selected artifact instead of a stale report', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'plm-mobile-gate-'));
  try {
    const oldArtifact = path.join(tempRoot, 'old-run');
    const currentArtifact = path.join(tempRoot, 'current-run');
    const oldReport = writeReport(
      oldArtifact,
      createReport({
        mobileTests: [
          createTest({
            projectName: 'mobile',
            status: 'skipped',
            title: 'unapproved mobile test',
            file: 'navigation.spec.ts',
          }),
        ],
      }),
    );
    const currentReport = writeReport(
      currentArtifact,
      createReport({
        mobileTests: [
          createTest({
            projectName: 'mobile',
            status: 'expected',
            title: 'mobile navigation smoke',
            file: 'navigation.spec.ts',
          }),
        ],
        setupTests: [
          createTest({
            projectName: 'setup',
            status: 'expected',
            title: 'authenticate local PLM',
            file: 'auth.setup.ts',
          }),
        ],
        desktopTests: [
          createTest({
            projectName: 'desktop',
            status: 'unexpected',
            title: 'desktop-only failure',
          }),
          createTest({
            projectName: 'desktop',
            status: 'skipped',
            title: 'desktop-only skipped test',
          }),
        ],
      }),
    );

    const result = runMobileGate({
      artifactDir: currentArtifact,
      reportFile: oldReport,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(
        `PASS mobile skip capability gate: skipped=0 allowed=0 unexpected=0 flaky=0 report=${currentReport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    );
    assert.doesNotMatch(result.stdout, /unapproved mobile test/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mobile skip gate counts mobile unexpected and flaky tests and rejects them', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'plm-mobile-gate-'));
  try {
    const reportFile = writeReport(
      tempRoot,
      createReport({
        mobileTests: [
          createTest({
            projectName: 'mobile',
            status: 'expected',
            title: 'mobile navigation smoke',
            file: 'navigation.spec.ts',
          }),
          createTest({
            projectName: 'mobile',
            status: 'unexpected',
            title: 'mobile unexpected test',
            file: 'navigation.spec.ts',
          }),
          createTest({
            projectName: 'mobile',
            status: 'flaky',
            title: 'mobile flaky test',
            file: 'navigation.spec.ts',
          }),
        ],
      }),
    );
    const result = runMobileGate({ reportFile });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /FAIL mobile skip capability gate: skipped=0 unexpected=1 flaky=1 .*unexpected=1; flaky=1/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mobile skip gate rejects unapproved skips from a directly selected report', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'plm-mobile-gate-'));
  try {
    const reportFile = writeReport(
      tempRoot,
      createReport({
        mobileTests: [
          createTest({
            projectName: 'mobile',
            status: 'expected',
            title: 'mobile navigation smoke',
            file: 'navigation.spec.ts',
          }),
          createTest({
            projectName: 'mobile',
            status: 'skipped',
            title: 'unapproved mobile test',
            file: 'navigation.spec.ts',
          }),
        ],
      }),
    );
    const result = runMobileGate({ reportFile });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unapproved skip: navigation\.spec\.ts :: unapproved mobile test/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mobile gate rejects contradictory labels, missing executions, timeouts and expected failures', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'plm-mobile-fail-closed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cases = [
    { status: 'expected', results: [{ status: 'failed' }] },
    { status: 'expected', results: [{ status: 'timedOut' }] },
    { status: 'expected', results: [{ status: 'interrupted' }] },
    { status: 'expected', results: [] },
    { status: 'expected', results: undefined },
    { status: undefined, results: [{ status: 'passed' }] },
    { expectedStatus: 'failed', results: [{ status: 'passed' }] },
    { expectedStatus: undefined, results: [{ status: 'passed' }] },
    { results: [{ status: 'passed', errors: [{ message: 'late error' }] }] },
    { results: [{ status: 'passed', error: { message: 'late error' } }] },
    { results: [{ status: 'passed', retry: 1 }] },
    { results: [{ status: 'failed' }, { status: 'passed' }] },
    { results: [{ status: 'passed' }, { status: 'passed' }] },
  ];
  for (const [index, overrides] of cases.entries()) {
    const entry = createTest({ projectName: 'mobile', status: 'expected', title: 'strict mobile' });
    Object.assign(entry.spec.tests[0], overrides);
    const reportFile = writeReport(path.join(root, String(index)), createReport({ mobileTests: [entry] }));
    const result = runMobileGate({ reportFile });
    assert.equal(result.status, 1, `case ${index}: ${result.stdout} ${result.stderr}`);
    assert.match(result.stderr, /FAIL mobile skip capability gate/);
  }
});

test('mobile gate rejects runner errors and failed or skipped authentication even with passing mobile rows', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'plm-mobile-runner-errors-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [index, setupStatus] of ['expected', 'unexpected', 'skipped'].entries()) {
    const report = createReport({
      mobileTests: [createTest({ projectName: 'mobile', status: 'expected', title: 'mobile' })],
      setupTests: [createTest({
        projectName: 'setup', status: setupStatus, title: 'authenticate', file: 'auth.setup.ts',
      })],
    });
    if (setupStatus === 'expected') report.errors = [{ message: 'global teardown failed' }];
    const result = runMobileGate({ reportFile: writeReport(path.join(root, String(index)), report) });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /report-level errors|setup did not pass/);
  }
});
