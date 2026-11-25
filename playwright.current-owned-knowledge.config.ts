import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.resolve(process.env.PLM_CURRENT_KNOWLEDGE_ARTIFACT_DIR ||
  path.join(__dirname, '../.artifacts/current-owned-knowledge-lifecycle', randomUUID()));
process.env.PLM_CURRENT_KNOWLEDGE_ARTIFACT_DIR = artifactDir;
fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
fs.chmodSync(artifactDir, 0o700);

export default defineConfig({
  testDir: './tests',
  testMatch: /current-owned-knowledge-lifecycle\.spec\.ts$/,
  workers: 1, retries: 0, fullyParallel: false, timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: path.join(artifactDir, 'playwright-results.private.json') }]],
  outputDir: path.join(artifactDir, 'test-results'), metadata: { artifactDir },
  use: { baseURL: 'http://127.0.0.1:30250/ibizplm-plmweb/',
    screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'knowledge-zh-desktop', use: { locale: 'zh-CN', viewport: { width: 1440, height: 900 } } },
    { name: 'knowledge-en-desktop', use: { locale: 'en-US', viewport: { width: 1440, height: 900 } } },
    { name: 'knowledge-zh-mobile', use: { locale: 'zh-CN', viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true } },
    { name: 'knowledge-en-mobile', use: { locale: 'en-US', viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true } },
  ],
});
