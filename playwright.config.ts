import { defineConfig, devices } from '@playwright/test';

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
  grepInvert: excluded.length ? new RegExp(excluded.join('|')) : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/test-results.json' }],
  ],
  use: {
    baseURL: process.env.PLM_E2E_BASE_URL || 'http://127.0.0.1:4173/',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    channel: process.env.PLM_E2E_CHANNEL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results',
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
        storageState: 'playwright/.auth/user.json',
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
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
