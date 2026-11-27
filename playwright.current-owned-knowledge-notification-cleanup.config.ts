import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.resolve(process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_ARTIFACT_DIR ||
  path.join(__dirname, '../.artifacts/knowledge-notification-cleanup', randomUUID()));
process.env.PLM_CURRENT_KNOWLEDGE_NOTIFICATION_ARTIFACT_DIR = artifactDir;
fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
fs.chmodSync(artifactDir, 0o700);

export default defineConfig({
  testDir: './tests',
  testMatch: /current-owned-knowledge-notification-cleanup\.spec\.ts$/,
  workers: 1, retries: 0, fullyParallel: false, timeout: 240000,
  expect: { timeout: 20000 },
  reporter: [['list'], ['json', { outputFile: path.join(artifactDir, 'playwright-results.private.json') }]],
  outputDir: path.join(artifactDir, 'test-results'),
  metadata: { artifactDir, sourceBusiness: 'three-exact-failed-knowledge-receipts', defaultMode: 'prepare' },
  use: { baseURL: 'http://127.0.0.1:30250/ibizplm-plmweb/',
    screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'knowledge-notification-zh-desktop', use: { locale: 'zh-CN', viewport: { width: 1440, height: 900 } } },
  ],
});
