import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { appPath, authHeaders } from './helpers';

test('late product tree responses cannot replace the active settings route', async ({ page }) => {
  const response = await page.request.post('/api/ibizplm__plmweb/products/fetch_main', {
    headers: await authHeaders(page),
    data: { page: 0, size: 100 },
  });
  expect(response.status()).toBe(200);
  const products = await response.json();
  expect(products.length, 'a real product is required').toBeGreaterThan(0);
  const product = products[0];
  const evidence = {
    productId: product.id,
    held: 0,
    delivered: 0,
    routes: [] as string[],
    pageErrors: [] as string[],
    settingsUrl: '',
    finalUrl: '',
  };
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) evidence.routes.push(frame.url());
  });
  page.on('pageerror', error => evidence.pageErrors.push(String(error)));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const treeRequests = /\/api\/ibizplm__plmweb\/(?:categories\/fetch_no_section|sections\/fetch_default)(?:\?|$)/;
  await page.route(treeRequests, async route => {
    const actual = await route.fetch();
    evidence.held += 1;
    await pending;
    await route.fulfill({ response: actual });
    evidence.delivered += 1;
  });
  try {
    const root = `/#/-/index/product=${encodeURIComponent(product.id)}/product_index_view`;
    await page.goto(appPath(`${root}/srfnav=usrdrgroup1228809432/idea_tree_exp_view/-`),
      { waitUntil: 'domcontentloaded' });
    await expect.poll(() => evidence.held, {
      message: 'the previous product tree must have real responses in flight',
    }).toBeGreaterThan(0);
    await page.goto(appPath(`${root}/srfnav=usrdrgroup1228809432/product_setting_view/srfnav=base/product_base_information_edit_view/-`),
      { waitUntil: 'domcontentloaded' });
    const name = page.locator('.ibiz-view--product_base_information_edit_view .ibiz-form-item')
      .filter({ hasText: '产品名称' }).locator('input').first();
    await expect(name).toHaveValue(product.name);
    evidence.settingsUrl = page.url();
    release();
    await expect.poll(() => evidence.delivered).toBe(evidence.held);
    // Let the released responses finish their async default-selection navigation.
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(evidence.settingsUrl);
    await expect(name).toHaveValue(product.name);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(evidence.settingsUrl);
    await expect(name).toHaveValue(product.name);
    expect(evidence.pageErrors).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    evidence.finalUrl = page.url();
    const file = test.info().outputPath('stale-tree-navigation.json');
    await writeFile(file, JSON.stringify(evidence, null, 2));
    await test.info().attach('stale-tree-navigation', { path: file, contentType: 'application/json' });
  }
});

test('product settings preserve the active form across repeated real page reloads', async ({ page }) => {
  const response = await page.request.post('/api/ibizplm__plmweb/products/fetch_main', {
    headers: await authHeaders(page), data: { page: 0, size: 100 },
  });
  expect(response.status()).toBe(200);
  const products = await response.json();
  expect(products.length, 'a real product is required').toBeGreaterThan(0);
  const product = products[0];
  const url = appPath(`/#/-/index/product=${encodeURIComponent(product.id)}/product_index_view/srfnav=usrdrgroup1228809432/product_setting_view/srfnav=base/product_base_information_edit_view/-`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const expectedUrl = page.url();
  const name = page.locator('.ibiz-view--product_base_information_edit_view .ibiz-form-item')
    .filter({ hasText: '产品名称' }).locator('input').first();
  const reloads: string[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(name).toHaveValue(product.name);
    await expect(page.locator('#app-loading-x')).toBeHidden();
    await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
    await expect(page).toHaveURL(expectedUrl);
    reloads.push(page.url());
    if (attempt < 4) await page.reload({ waitUntil: 'domcontentloaded' });
  }
  expect(errors).toEqual([]);
  await test.info().attach('settings-repeated-reload', {
    body: Buffer.from(JSON.stringify({ productId: product.id, reloads, errors }, null, 2)),
    contentType: 'application/json',
  });
});
