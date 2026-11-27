import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.resolve(process.env.PLM_CURRENT_API_DOCUMENTATION_ROLES_ARTIFACT_DIR ||
  path.join(__dirname, '../.artifacts/current-api-documentation-roles', randomUUID()));
fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
fs.chmodSync(artifactDir, 0o700);
process.env.PLM_CURRENT_API_DOCUMENTATION_ROLES_ARTIFACT_DIR = artifactDir;

export default defineConfig({
  testDir: './tests',
  testMatch: /current-api-documentation-roles\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: path.join(artifactDir, 'playwright-results.private.json') }]],
  outputDir: path.join(artifactDir, 'test-results'),
  use: {
    serviceWorkers: 'block',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLM_E2E_CHROMIUM || '/usr/bin/google-chrome' },
  },
  projects: [
    { name: 'api-documentation-roles-zh-desktop', use: { locale: 'zh-CN', viewport: { width: 1440, height: 900 } } },
  ],
});
