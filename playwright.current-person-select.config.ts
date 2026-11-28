import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const artifacts = path.resolve(__dirname, '../.artifacts');
const artifactDir = path.resolve(process.env.PLM_CURRENT_PERSON_SELECT_ARTIFACT_DIR ||
  path.join(artifacts, `current-person-select-${randomUUID()}`));
if (path.dirname(artifactDir) !== artifacts ||
    !/^current-person-select-[a-z0-9][a-z0-9-]{0,100}$/.test(path.basename(artifactDir))) {
  throw new Error('A direct private current-person-select artifact directory is required');
}
for (let current = artifacts; ; current = path.dirname(current)) {
  const stat = fs.lstatSync(current);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Artifact ancestry must contain real directories');
  if (current === path.dirname(current)) break;
}
fs.mkdirSync(artifactDir, { mode: 0o700 });
process.env.PLM_CURRENT_PERSON_SELECT_ARTIFACT_DIR = artifactDir;

export default defineConfig({
  testDir: './tests',
  testMatch: /current-person-select\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 420_000,
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
    { name: 'person-select-zh-desktop', use: { locale: 'zh-CN', viewport: { width: 1440, height: 900 } } },
    { name: 'person-select-en-desktop', use: { locale: 'en-US', viewport: { width: 1440, height: 900 } } },
    { name: 'person-select-zh-mobile', use: {
      locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    } },
    { name: 'person-select-en-mobile', use: {
      locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    } },
  ],
});
