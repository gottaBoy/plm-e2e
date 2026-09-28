import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const artifactDir = path.resolve(
  process.env.PLM_E2E_ARTIFACT_DIR ||
    process.env.PLM_E2E_RUN_ARTIFACT_DIR ||
    path.join(
      __dirname,
      'test-results/runs',
      `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`,
    ),
);
// Workers reload this config and must inherit the coordinator's run directory.
process.env.PLM_E2E_RUN_ARTIFACT_DIR = artifactDir;
const artifactPath = (relativePath: string) => path.join(artifactDir, relativePath);
const storageState = artifactPath('playwright/.auth/user.json');
const outputDir = process.env.PLM_E2E_OUTPUT_DIR
  ? path.resolve(process.env.PLM_E2E_OUTPUT_DIR)
  : artifactPath('test-results');
const reportDir = process.env.PLM_E2E_REPORT_DIR
  ? path.resolve(process.env.PLM_E2E_REPORT_DIR)
  : artifactPath('reports');
const htmlReportDir = path.join(reportDir, 'playwright-report');
const jsonReportFile = path.join(reportDir, 'test-results.json');

if (process.env.TEST_WORKER_INDEX === undefined) {
  console.log(`[plm-e2e] Artifacts: ${artifactDir}`);
  console.log(`[plm-e2e] Output: ${outputDir}`);
  console.log(`[plm-e2e] HTML report: ${htmlReportDir}`);
  console.log(`[plm-e2e] JSON report: ${jsonReportFile}`);
}

// Two suites are opt-in because both are slow or known-failing: the regression
// probes tagged @known-issue, and the deep sweep tagged @deep-sweep, which walks
// every tree node and tab and takes about twelve minutes per base URL.
const excluded = [
  [process.env.PLM_E2E_INCLUDE_KNOWN, '@known-issue'],
  [process.env.PLM_E2E_INCLUDE_SWEEP, '@deep-sweep'],
]
  .filter(([included]) => !included)
  .map(([, tag]) => tag);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  metadata: { artifactDir, storageState, reportDir },
  grepInvert: excluded.length ? new RegExp(excluded.join('|')) : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: htmlReportDir, open: 'never' }],
    ['json', { outputFile: jsonReportFile }],
  ],
  use: {
    baseURL: process.env.PLM_E2E_BASE_URL || 'http://127.0.0.1:4173/',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    channel: process.env.PLM_E2E_CHANNEL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir,
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.PLM_E2E_CHANNEL,
        storageState,
      },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        browserName: 'chromium',
        channel: process.env.PLM_E2E_CHANNEL,
        storageState,
      },
      dependencies: ['setup'],
    },
  ],
});
