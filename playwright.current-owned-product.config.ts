import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const artifactDir = path.resolve(process.env.PLM_CURRENT_PRODUCT_ARTIFACT_DIR ||
  path.join(__dirname, '../.artifacts/current-owned-product-lifecycle', randomUUID()));
process.env.PLM_CURRENT_PRODUCT_ARTIFACT_DIR = artifactDir;

export default defineConfig({
  testDir: './tests',
  testMatch: process.env.PLM_CURRENT_PRODUCT_NOTIFICATION_SOURCES
    ? /current-owned-product-notification\.spec\.ts$/
    : process.env.PLM_CURRENT_PRODUCT_CLEANUP_SOURCE
      ? /current-owned-product-cleanup\.spec\.ts$/ : /current-owned-product-lifecycle\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: path.join(artifactDir, 'playwright-results.private.json') }]],
  outputDir: path.join(artifactDir, 'test-results'),
  metadata: { artifactDir },
  use: {
    baseURL: process.env.PLM_CURRENT_PRODUCT_BASE_URL || 'http://127.0.0.1:30250/ibizplm-plmweb/',
    serviceWorkers: 'block',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    channel: process.env.PLM_E2E_CHANNEL,
    launchOptions: { executablePath: process.env.PLM_E2E_CHROMIUM || '/usr/bin/google-chrome' },
  },
  projects: [
    { name: 'current-product-zh-desktop', use: { locale: 'zh-CN', viewport: { width: 1440, height: 900 } } },
    { name: 'current-product-en-desktop', use: { locale: 'en-US', viewport: { width: 1440, height: 900 } } },
    { name: 'current-product-zh-mobile', use: { locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'current-product-en-mobile', use: { locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
