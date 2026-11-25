import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const workspace = path.resolve(__dirname, '..');
const artifactDir = path.resolve(process.env.PLM_CURRENT_VIEW_THEMES_ARTIFACT_DIR ||
  path.join(workspace, '.artifacts/current-owned-app-view-themes', randomUUID()));
const child = path.relative(path.join(workspace, '.artifacts'), artifactDir);
if (!child || child.startsWith('..') || path.isAbsolute(child)) {
  throw new Error('View theme browser evidence must remain in the private workspace artifact directory');
}
fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
fs.chmodSync(artifactDir, 0o700);
process.env.PLM_CURRENT_VIEW_THEMES_ARTIFACT_DIR = artifactDir;

export default defineConfig({
  testDir: './tests',
  testMatch: /current-owned-app-view-themes\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: path.join(artifactDir, 'playwright-results.private.json') }]],
  outputDir: path.join(artifactDir, 'test-results'),
  use: {
    baseURL: 'http://127.0.0.1:30250/ibizplm-plmweb/',
    serviceWorkers: 'block',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLM_E2E_CHROMIUM || '/usr/bin/google-chrome' },
  },
  projects: [
    { name: 'view-themes-zh-desktop', use: { locale: 'zh-CN', viewport: { width: 1440, height: 900 } } },
    { name: 'view-themes-en-desktop', use: { locale: 'en-US', viewport: { width: 1440, height: 900 } } },
    { name: 'view-themes-zh-mobile', use: { locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'view-themes-en-mobile', use: { locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
