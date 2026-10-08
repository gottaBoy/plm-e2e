import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { clickTab, gotoApp, openMenu } from './helpers';
import {
  isExpectedExtensionManifestConsole,
  isExpectedExtensionManifestMiss,
  modelingAppIdentity,
  modelingCounterValue,
} from './modeling-ide-contract';

test('Modeling IDE loads its work item counter from the local backend', async ({ page }) => {
  const evidence = {
    baseUrl: test.info().project.use.baseURL,
    distRoot: process.env.PLM_E2E_DIST_ROOT,
    fixtureAcceptance: false, nativeAcceptance: false,
    scope: 'embedded Modeling IDE identity, rendering and read-only counter; not native acceptance',
    pageErrors: [] as string[], consoleErrors: [] as string[],
    // Diagnostics the platform itself documents as expected, kept with their
    // URL, status and reason so the run stays auditable. Anything unexpected
    // remains in consoleErrors/requests and still fails the test.
    expectedDiagnostics: [] as Array<{ kind: string; url: string; status?: number; reason: string }>,
    requests: [] as Array<{ path: string; status: number; method: string }>,
    modelResponses: [] as Array<{ url: string; htmlUrl?: string }>,
    counter: {} as Record<string, unknown>,
    iframe: {} as Record<string, unknown>,
    appIdentity: {} as Record<string, unknown>,
  };
  page.on('pageerror', error => evidence.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const source = message.location().url || '';
    if (isExpectedExtensionManifestConsole({ message: text, source })) {
      evidence.expectedDiagnostics.push({ kind: 'console', url: source, reason: 'extension-manifest-404' });
      return;
    }
    evidence.consoleErrors.push(text);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (/\/(?:api|plugins)\//.test(url.pathname) || response.request().resourceType() === 'document') {
      const request = { url: response.url(), path: url.pathname, status: response.status(), method: response.request().method() };
      if (isExpectedExtensionManifestMiss({ status: request.status, url: request.url })) {
        evidence.expectedDiagnostics.push({
          kind: 'request', url: request.url, status: request.status, reason: 'extension-manifest-404',
        });
      }
      evidence.requests.push(request);
    }
  });
  page.on('response', async response => {
    const url = new URL(response.url());
    if (/ps_core_prd_func_modeling_ide_html_view/i.test(url.pathname)) {
      const entry: { url: string; htmlUrl?: string } = { url: response.url() };
      try {
        entry.htmlUrl = (await response.json())?.htmlUrl;
      } catch {
        // Keep URL evidence when the model response is not JSON.
      }
      evidence.modelResponses.push(entry);
    }
  });
  try {
    await gotoApp(page);
    await openMenu(page, '二次开发');
    const [response, hub] = await Promise.all([
      page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/ibizmodeling__modeldesign/work_items/count_my_todo' &&
        response.request().method() === 'POST', { timeout: 30_000 }),
      page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.hub.json' &&
        response.request().method() === 'GET', { timeout: 30_000 }),
      clickTab(page.getByRole('tab', { name: 'Modeling IDE', exact: true })),
    ]);
    evidence.counter.status = response.status();
    expect(response.status(), 'Modeling IDE counter must succeed').toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/(?:[\w.-]+\+)?json(?:;|$)/i);
    evidence.counter.value = modelingCounterValue(await response.json());

    expect(hub.status(), 'embedded IDE must load its actual application model').toBe(200);
    expect(hub.headers()['content-type']).toMatch(/^application\/(?:[\w.-]+\+)?json(?:;|$)/i);
    const model = await hub.json();
    // Capture observed identity before asserting it so a wrong deployment remains diagnosable.
    evidence.appIdentity = { codeName: model?.codeName, sysCodeName: model?.sysCodeName };
    modelingAppIdentity(model);
    const iframe = page.locator('.ibiz-view--ps_core_prd_func_modeling_ide_html_view iframe');
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toBeVisible();
    const src = new URL((await iframe.getAttribute('src')) || '', page.url());
    evidence.iframe = { href: src.href, origin: src.origin, path: src.pathname, rendered: false };
    expect(src.pathname).toBe('/modeldesign/');
    expect(new URL(response.url()).origin, 'counter must come from the embedded IDE origin').toBe(src.origin);
    expect(new URL(hub.url()).origin, 'model must come from the embedded IDE origin').toBe(src.origin);
    const app = iframe.contentFrame().locator('#app');
    await expect(app).toBeVisible();
    await expect(app, 'Modeling IDE must render application content').not.toBeEmpty();
    await expect(iframe.contentFrame().locator('body')).not.toContainText('产品生命周期管理系统');
    evidence.iframe.rendered = true;
    expect(evidence.pageErrors, 'embedded IDE must not hide uncaught errors').toEqual([]);
    expect(evidence.consoleErrors, 'embedded IDE must not hide console errors').toEqual([]);
    expect(
      evidence.requests.filter(request =>
        request.status >= 400 &&
        !isExpectedExtensionManifestMiss({ status: request.status, url: request.url })),
      'embedded IDE must not hide HTTP errors beyond the documented extension manifest miss',
    ).toEqual([]);
    expect(
      evidence.expectedDiagnostics.every(item => item.reason === 'extension-manifest-404'),
      'only the platform extension manifest miss may be classified as expected',
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath('modeling-ide.png'), fullPage: true });
  } finally {
    const file = test.info().outputPath('modeling-ide-evidence.json');
    await writeFile(file, JSON.stringify(evidence, null, 2));
    await test.info().attach('modeling-ide-evidence', { path: file, contentType: 'application/json' });
  }
});
