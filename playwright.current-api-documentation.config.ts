import { defineConfig } from '@playwright/test';
import path from 'node:path';

const artifactDir = process.env.PLM_CURRENT_API_DOCUMENTATION_ARTIFACT_DIR;
if (!artifactDir || !path.isAbsolute(artifactDir)) {
  throw new Error('An absolute private API documentation artifact directory is required');
}

export default defineConfig({
  testDir: './tests',
  testMatch: /current-api-documentation\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(artifactDir, 'test-results'),
  reporter: [['list'], ['json', { outputFile: path.join(artifactDir, 'playwright-results.private.json') }]],
  use: {
    serviceWorkers: 'block',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLM_E2E_CHROMIUM || '/usr/bin/google-chrome' },
  },
  projects: [
    { name: 'api-documentation-zh-desktop', use: { locale: 'zh-CN', viewport: { width: 1440, height: 900 } } },
    { name: 'api-documentation-en-desktop', use: { locale: 'en-US', viewport: { width: 1440, height: 900 } } },
    { name: 'api-documentation-zh-mobile', use: { locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'api-documentation-en-mobile', use: { locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
