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

function getTestStatus(test) {
  const resultStatuses = (test.results || []).map(result => result.status);

  if (test.status === 'skipped' || resultStatuses.includes('skipped')) return 'skipped';
  if (test.status === 'flaky') return 'flaky';
  if (resultStatuses.includes('passed') && resultStatuses.some(status => status !== 'passed')) return 'flaky';
  if (test.status !== 'expected' || test.expectedStatus !== 'passed') return 'unexpected';
  if (test.results?.length !== 1 || resultStatuses[0] !== 'passed') return 'unexpected';
  if (test.results[0].error || (test.results[0].errors || []).length > 0) return 'unexpected';
  if (test.results[0].retry !== undefined && test.results[0].retry !== 0) return 'unexpected';
  return 'expected';
}

function collectTests(suites, projectName, inheritedFile = '') {
  const tests = [];
  for (const suite of suites || []) {
    const file = suite.file || (suite.title?.endsWith('.spec.ts') ? suite.title : inheritedFile);
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        if (test.projectName !== projectName) continue;
        tests.push({
          file: spec.file || file,
          title: spec.title,
          status: getTestStatus(test),
        });
      }
    }
    tests.push(...collectTests(suite.suites, projectName, file));
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

const mobileTests = collectTests(report.suites, 'mobile');
const mobileStats = mobileTests.reduce(
  (stats, test) => {
    stats[test.status] += 1;
    return stats;
  },
  { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
);
const skipped = mobileTests.filter(test => test.status === 'skipped');
const failures = [];

if (!Array.isArray(report.suites)) failures.push('invalid report suites');
if (report.errors !== undefined && (!Array.isArray(report.errors) || report.errors.length !== 0)) {
  failures.push('report-level errors');
}
for (const item of collectTests(report.suites, 'setup')) {
  if (item.status !== 'expected') failures.push(`setup did not pass: ${item.file} :: ${item.title}`);
}
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
  failures.push(`unapproved skip: ${item.file} :: ${item.title}`);
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
    `allowed=0 ` +
    `unexpected=${mobileStats.unexpected} flaky=${mobileStats.flaky} ` +
    `report=${path.resolve(reportFile)}`,
);
