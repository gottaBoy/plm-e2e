import { expect, Page, test } from '@playwright/test';
import { appPath } from './helpers';

function collectPluginLoading(page: Page) {
  const pluginRequests = new Map<string, number>();
  const consoleErrors: string[] = [];

  page.on('response', response => {
    const url = response.url();
    if (
      url.includes('/plugins/@ibiz-template-plm/person-select@0.0.3-alpha.434/')
    ) {
      pluginRequests.set(url, response.status());
    }
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  return { pluginRequests, consoleErrors };
}

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', 'Plugin loading is covered on desktop');
});

test('person select plugin loads its config and assets', async ({ page }) => {
  const { pluginRequests, consoleErrors } = collectPluginLoading(page);

  await page.goto(appPath('/#/-/index/-/ticket_allocate_person_view/-'), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(8_000);

  const requiredAssets = [
    'package.json',
    'dist/index.legacy.js',
    'dist/style.css',
  ];

  for (const asset of requiredAssets) {
    const request = [...pluginRequests.entries()].find(([url]) =>
      url.includes(asset),
    );
    expect(request, `${asset} should be requested`).toBeTruthy();
    expect(request?.[1], `${asset} should return 200`).toBe(200);
  }

  expect(
    consoleErrors.some(error => error.includes('配置加载失败')),
    'Person select plugin should not report a config loading failure',
  ).toBe(false);
});
