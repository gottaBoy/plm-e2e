import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const artifactDir = process.env.PLM_E2E_ARTIFACT_DIR?.trim();
const reportFile = artifactDir
  ? path.join(path.resolve(artifactDir), 'reports', 'test-results.json')
  : process.env.PLM_E2E_REPORT_FILE?.trim()
    ? path.resolve(process.env.PLM_E2E_REPORT_FILE)
    : undefined;

if (!reportFile) {
  console.error(
    'PLM_E2E_REPORT_FILE or PLM_E2E_ARTIFACT_DIR is required; run the mobile Playwright suite first',
  );
  process.exit(2);
}

const rules = [
  {
    file: 'interactions.spec.ts',
    title: /^[\s\S]+ common navigation controls$/,
    count: 12,
    reason: 'desktop-only interaction coverage',
  },
  {
    file: 'person-select.spec.ts',
    title: /^person select plugin loads its config and assets$/,
    count: 1,
    reason: 'plugin loading coverage is desktop-only',
  },
];

function getTestStatus(test) {
  const resultStatuses = (test.results || []).map(result => result.status);

  if (test.status === 'skipped' || resultStatuses.includes('skipped')) return 'skipped';
  if (test.status === 'flaky') return 'flaky';
  if (test.status === 'unexpected') return 'unexpected';
  if (test.status === 'expected') return 'expected';
  if (resultStatuses.includes('failed')) {
    return resultStatuses.includes('passed') ? 'flaky' : 'unexpected';
  }
  return 'expected';
}

function collectMobileTests(suites, inheritedFile = '') {
  const tests = [];
  for (const suite of suites || []) {
    const file = suite.file || (suite.title?.endsWith('.spec.ts') ? suite.title : inheritedFile);
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        if (test.projectName !== 'mobile') continue;
        tests.push({
          file,
          title: spec.title,
          status: getTestStatus(test),
        });
      }
    }
    tests.push(...collectMobileTests(suite.suites, file));
  }
  return tests;
}

let report;
try {
  report = JSON.parse(readFileSync(path.resolve(reportFile), 'utf8'));
} catch (error) {
  console.error(`Cannot read Playwright report ${reportFile}: ${error.message}`);
  process.exit(2);
}

const mobileTests = collectMobileTests(report.suites);
const mobileStats = mobileTests.reduce(
  (stats, test) => {
    stats[test.status] += 1;
    return stats;
  },
  { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
);
const skipped = mobileTests.filter(test => test.status === 'skipped');
const failures = [];

if (mobileTests.length === 0) {
  failures.push('no mobile tests found');
}
if (mobileStats.unexpected !== 0) {
  failures.push(`unexpected=${mobileStats.unexpected}`);
}
if (mobileStats.flaky !== 0) {
  failures.push(`flaky=${mobileStats.flaky}`);
}

for (const item of skipped) {
  const rule = rules.find(candidate => candidate.file === item.file && candidate.title.test(item.title));
  if (!rule) failures.push(`unapproved skip: ${item.file} :: ${item.title}`);
}

for (const rule of rules) {
  const actual = skipped.filter(
    item => item.file === rule.file && rule.title.test(item.title),
  ).length;
  if (actual !== rule.count) {
    failures.push(
      `${rule.file} expected ${rule.count} skip(s) for ${rule.reason}, found ${actual}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `FAIL mobile skip capability gate: skipped=${mobileStats.skipped} ` +
      `unexpected=${mobileStats.unexpected} flaky=${mobileStats.flaky} ` +
      `${failures.join('; ')} report=${path.resolve(reportFile)}`,
  );
  process.exit(1);
}

console.log(
  `PASS mobile skip capability gate: skipped=${mobileStats.skipped} ` +
    `allowed=${rules.reduce((total, rule) => total + rule.count, 0)} ` +
    `unexpected=${mobileStats.unexpected} flaky=${mobileStats.flaky} ` +
    `report=${path.resolve(reportFile)}`,
);
