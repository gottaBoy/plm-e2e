import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { authHeaders, gotoApp } from './helpers';

const dashboard =
  '/#/-/index/-/workspace_tab_exp_view/srfnav=dashboard/recent_custom_dashboard_view/-';

for (const language of ['zh-CN', 'en']) {
  test(`reported dashboard/space errors do not recur in ${language}`, async ({ page }, testInfo) => {
    const evidence = {
      scope: 'Original shared PLM dashboard deep link and read-only space GET; not business lifecycle acceptance',
      language,
      viewport: testInfo.project.use.viewport,
      pageErrors: [] as string[],
      consoleErrors: [] as string[],
      failedRequests: [] as Array<{ path: string; reason: string | null }>,
      httpErrors: [] as Array<{ path: string; status: number; method: string }>,
      spaces: { status: null as number | null, contentType: '' },
    };
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('requestfailed', request => evidence.failedRequests.push({
      path: new URL(request.url()).pathname,
      reason: request.failure()?.errorText ?? null,
    }));
    page.on('response', response => {
      if (response.status() >= 400) evidence.httpErrors.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
        method: response.request().method(),
      });
    });
    try {
      await gotoApp(page);
      await expect(page.locator('#app-loading-x')).toBeHidden();
      await page.evaluate(value => localStorage.setItem('language', value), language);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app-loading-x')).toBeHidden();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await gotoApp(page, dashboard);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('.ibiz-view--recent_custom_dashboard_view')).toBeVisible();
      await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
      const spaces = await page.request.get(
        '/api/ibizplm__plmweb/spaces/plm_space?id=aibizhi',
        { headers: await authHeaders(page), maxRedirects: 0 },
      );
      evidence.spaces = {
        status: spaces.status(), contentType: spaces.headers()['content-type'] ?? '',
      };
      expect(spaces.status(), 'the originally failing space route must return HTTP 200').toBe(200);
      expect(evidence.spaces.contentType).toMatch(/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i);
      const space = await spaces.json();
      expect(space.id).toBe('plm_space');
      await page.waitForTimeout(500);
      expect(evidence.pageErrors, 'all uncaught errors are retained').toEqual([]);
      expect(evidence.consoleErrors, 'all console errors are retained without string suppression').toEqual([]);
      expect(evidence.httpErrors, 'all browser HTTP errors are retained').toEqual([]);
      expect(evidence.failedRequests, 'all failed requests are retained').toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${language}.png`), fullPage: true });
    } finally {
      const path = testInfo.outputPath('reported-errors-evidence.json');
      await writeFile(path, JSON.stringify(evidence, null, 2));
      await testInfo.attach('reported-errors-evidence', { path, contentType: 'application/json' });
    }
  });
}
