import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { appPath, authHeaders, gotoApp, menus } from './helpers';

const plmRoot = path.resolve(__dirname, '../../plm-web');
const plmRequire = createRequire(path.join(plmRoot, 'package.json'));
const ts = plmRequire('typescript');
const localeSource = readFileSync(path.join(plmRoot, 'src/locale/model-locale.ts'), 'utf8');
const localeCode = ts.transpileModule(localeSource, {
  fileName: 'model-locale.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const dictionary = JSON.parse(readFileSync(
  path.join(plmRoot, 'src/locale/en.json'), 'utf8',
));

test('static HTML localization preserves links, attributes, code and unknown authored text', async ({ page }) => {
  const proof = await page.evaluate(({ code, dictionary }) => {
    const exports: Record<string, Function> = {};
    new Function('exports', 'require', code)(exports, () => dictionary);
    const original = {
      contentType: 'HTML',
      content: '<section data-original="产品"><a href="/原始链接?q=产品">产品</a>' +
        '<p> 用户自定义正文 </p><code>产品</code><pre>产品</pre>' +
        '<script>window.unexpectedExecution = true;</script><style>.产品{color:red}</style></section>',
    };
    const translated = exports.localizePlmModel(original, 'en');
    const doc = new DOMParser().parseFromString(translated.content, 'text/html');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">' +
      '<path id="原始路径" d="M0 0L10 10"/><text x="10">产品</text>' +
      '<text x="50">用户自定义</text></svg>';
    const image = exports.localizePlmModel({ rawContent: svg }, 'en');
    const svgDocument = new DOMParser().parseFromString(image.rawContent, 'image/svg+xml');
    return {
      anchor: doc.querySelector('a')?.textContent,
      href: doc.querySelector('a')?.getAttribute('href'),
      attribute: doc.querySelector('section')?.getAttribute('data-original'),
      authored: doc.querySelector('p')?.textContent,
      code: doc.querySelector('code')?.textContent,
      pre: doc.querySelector('pre')?.textContent,
      script: doc.querySelector('script')?.textContent,
      style: doc.querySelector('style')?.textContent,
      originalUnchanged: original.content.includes('>产品</a>'),
      chineseUnchanged: exports.localizePlmModel(original, 'zh-CN').content === original.content,
      noExecution: !(window as unknown as Record<string, unknown>).unexpectedExecution,
      svgText: svgDocument.querySelector('text')?.textContent,
      svgCustom: svgDocument.querySelectorAll('text')[1]?.textContent,
      svgId: svgDocument.querySelector('path')?.id,
      svgPath: svgDocument.querySelector('path')?.getAttribute('d'),
      svgChineseUnchanged: exports.localizePlmModel({ rawContent: svg }, 'zh-CN').rawContent === svg,
    };
  }, { code: localeCode, dictionary });
  expect(proof).toEqual({
    anchor: 'Product', href: '/原始链接?q=产品', attribute: '产品',
    authored: ' 用户自定义正文 ', code: '产品', pre: '产品',
    script: 'window.unexpectedExecution = true;', style: '.产品{color:red}',
    originalUnchanged: true, chineseUnchanged: true, noExecution: true,
    svgText: 'Product', svgCustom: '用户自定义', svgId: '原始路径',
    svgPath: 'M0 0L10 10', svgChineseUnchanged: true,
  });
});

async function fixedChinese(scope: Locator) {
  return scope.evaluateAll(elements => {
    const values = elements.map(element =>
      (element.getAttribute('placeholder') || (element as HTMLElement).innerText || '').trim(),
    ).filter(value => /[\u3400-\u9fff]/u.test(value));
    return [...new Set(values)];
  });
}

for (const entry of [
  { menu: '产品管理', command: 'New Product', title: 'Product', view: 'product_create_wizard_view' },
  { menu: '项目管理', command: 'New Project', title: 'Scrum Project', view: 'project_create_wizard_view' },
  { menu: '测试管理', command: 'New Test Library', title: 'Agile Testing', view: 'library_create_wizard_view' },
  { menu: '知识管理', command: 'New Space', title: 'Space', view: 'space_create_wizard_view' },
] as const) {
  test(`English ${entry.view} translates the complete static template and fixed controls`, async ({ page }) => {
    const creates: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
      if (request.method() === 'POST' &&
          /\/(?:products|projects|libraries|spaces)\/?$/.test(new URL(request.url()).pathname)) {
        creates.push(request.url());
      }
    });
    await gotoApp(page);
    await page.evaluate(() => localStorage.setItem('language', 'en'));
    await gotoApp(page);
    await page.locator('.el-menu-item').nth(menus.indexOf(entry.menu)).click();
    await page.locator(`button[title="${entry.command}"]`).click();
    const dialog = page.locator('.ibiz-modal:visible').last();
    await expect(dialog.locator(`.ibiz-view--${entry.view}`)).toBeVisible();
    await expect(dialog.locator('.template-name:visible').first()).toHaveText(entry.title);
    await expect(dialog.locator('.template-desc:visible').first()).not.toBeEmpty();
    if (entry.menu === '项目管理') {
      const cards = dialog.locator('.ibiz-panel-field--name');
      await expect(cards).toHaveCount(4);
      for (const name of ['Scrum Project', 'Kanban Project', 'Waterfall Project', 'Hybrid Project']) {
        await expect(cards.getByText(name, { exact: true })).toBeVisible();
      }
    } else {
      await expect(dialog.locator('.ibiz-team-picker__item--type').first()).toHaveText('Organization');
    }
    const labels = dialog.locator(
      '.template-name:visible, .template-desc:visible, .template-tips:visible, ' +
      '.el-step__title:visible, .ibiz-form-item-container__label:visible, ' +
      '.ibiz-panel-field:visible, ' +
      '.ibiz-team-picker__item--type:visible, svg text:visible, ' +
      'button:visible, input[placeholder]:visible',
    );
    const untranslated = await fixedChinese(labels);
    await test.info().attach('untranslated-wizard-content', {
      body: Buffer.from(JSON.stringify({ view: entry.view, untranslated }, null, 2)),
      contentType: 'application/json',
    });
    await expect.poll(() => fixedChinese(labels), {
      message: 'template, built-in type cards, ownership types and fixed controls must be English',
    }).toEqual([]);
    const viewport = page.viewportSize()!;
    const wizard = dialog.locator('.ibiz-control-wizardpanel');
    const bounds = (await wizard.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(await wizard.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const closeBounds = (await dialog.locator('.el-dialog__headerbtn').boundingBox())!;
    expect(closeBounds.x).toBeGreaterThanOrEqual(0);
    expect(closeBounds.x + closeBounds.width).toBeLessThanOrEqual(viewport.width + 1);
    if (test.info().project.name === 'mobile') {
      await expect(dialog.locator('.el-dialog__headerbtn .el-dialog__close'))
        .not.toHaveCSS('color', 'rgb(255, 255, 255)');
    }
    await test.info().attach('wizard-layout-bounds', {
      body: Buffer.from(JSON.stringify({ view: entry.view, viewport, bounds, closeBounds }, null, 2)),
      contentType: 'application/json',
    });
    await page.screenshot({
      path: test.info().outputPath(`${entry.view}-english.png`), fullPage: true, animations: 'disabled',
    });
    await dialog.locator('.el-dialog__headerbtn').click();
    await expect(dialog).toBeHidden();
    expect(creates).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('English marketplace translates known catalog cards and preserves remote repository identities', async ({ page }) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    if (/\/pscoreprdfuncs\/[^/]+\/(?:install|installspecver|uninstall|reload)$/i
      .test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  await gotoApp(page);
  await page.evaluate(() => localStorage.setItem('language', 'en'));
  await gotoApp(page);
  const dataset = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith('/pscoreprdfuncs/fetchdefault') &&
    response.request().method() === 'POST');
  await page.locator('.el-menu-item').nth(menus.indexOf('应用市场')).click();
  const response = await dataset;
  expect(response.status()).toBe(200);
  const rows = await response.json();
  expect(Array.isArray(rows) && rows.length > 0).toBe(true);
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0, { timeout: 30_000 });
  const market = page.locator('.ibiz-view--ps_core_prd_func_market_application_view');
  await expect(market).toContainText('Standard Logic Designer');
  await expect(market).toContainText('View Creation Wizard');
  await expect(market).toContainText('Model Inspector');
  const chinese = await fixedChinese(market.locator(
    '.ibiz-panel-field--title, .ibiz-panel-field--memo, ' +
    '.ibiz-control-dataview-group-content__item-title, button:visible',
  ));
  expect(chinese).toEqual([]);
  const catalog = rows.map((row: Record<string, string>) => ({
    id: row.pscoreprdfuncid, name: row.pscoreprdfuncname,
    repository: row.httpurltorepo, icon: row.avatarurl, state: row.funcstate,
    repositoryOrigin: row.httpurltorepo ? new URL(row.httpurltorepo).origin : null,
  }));
  await test.info().attach('marketplace-provenance', {
    body: Buffer.from(JSON.stringify({
      scope: 'Catalog reference inventory only; not installed-source, package or offline acceptance',
      entries: catalog, allPluginsLocalized: false,
    }, null, 2)), contentType: 'application/json',
  });
  await page.screenshot({ path: test.info().outputPath('marketplace-english.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('language', 'zh-CN'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(market).toContainText('标准逻辑设计器');
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('English resource dimension and declared dynamic project states translate without renaming records', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => localStorage.setItem('language', 'en'));
  await gotoApp(page);
  await page.locator('.el-menu-item').nth(menus.indexOf('资源管理')).click();
  await expect(page.locator('.ibiz-tab-exp-select-content__caption')).toHaveText('Dimension');
  await expect(page.locator('.ibiz-search-groups-quick-group-item').first()).toHaveText('All People');
  await page.locator('.el-menu-item').nth(menus.indexOf('项目管理')).click();
  await expect(page.locator('.ibiz-view--project_all_grid_view')).toBeVisible();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  const states = page.locator('.ibiz-view--project_all_grid_view .ibiz-code-list__item');
  await expect(states.first()).toBeVisible();
  await expect.poll(() => fixedChinese(states), {
    message: 'dynamic state lookup must settle with English system labels',
  }).toEqual([]);
});

test('English product deletion confirmation can be canceled without changing the product', async ({ page }) => {
  const headers = await authHeaders(page);
  const response = await page.request.post('/api/ibizplm__plmweb/products/fetch_main', {
    headers, data: { page: 0, size: 100 },
  });
  expect(response.status()).toBe(200);
  const [product] = await response.json();
  expect(product?.id).toBeTruthy();
  await gotoApp(page);
  await page.evaluate(() => localStorage.setItem('language', 'en'));
  const root = `/#/-/index/product=${encodeURIComponent(product.id)}/product_index_view`;
  await page.goto(appPath(`${root}/srfnav=usrdrgroup1228809432/product_setting_view/srfnav=adv/product_advanced_setting_edit_view/-`),
    { waitUntil: 'domcontentloaded' });
  const advanced = page.locator('.ibiz-view--product_advanced_setting_edit_view');
  await expect(advanced).toBeVisible();
  const mutations: string[] = [];
  page.on('request', request => {
    if (/\/products\/[^/]+\/delete$/.test(new URL(request.url()).pathname)) mutations.push(request.url());
  });
  await advanced.getByRole('button', { name: 'Delete Product', exact: true }).click();
  const confirmation = page.locator('.el-message-box:visible');
  await expect(confirmation).toContainText('Delete this product?');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toBeHidden();
  const after = await page.request.get(`/api/ibizplm__plmweb/products/${encodeURIComponent(product.id)}`, { headers });
  expect(after.status()).toBe(200);
  expect((await after.json()).name).toBe(product.name);
  expect(mutations).toEqual([]);
});
