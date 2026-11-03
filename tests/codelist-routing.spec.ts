import { expect, test } from '@playwright/test';
import { authHeaders, gotoApp } from './helpers';

test('dynamic work item states use the real model and keep state transition restrictions', async ({ page, request }) => {
  const headers = await authHeaders(page);
  const endpoint = '/api/ibizplm__plmweb/dictionaries/codelist/ProjMgmt__scrum_state';
  const query = { work_item_type_id: 'scrum_task', state: '10', size: '1000' };
  const response = await request.get(endpoint, { headers, params: query });
  expect(response.status()).toBe(200);
  const list = await response.json();
  expect(list.code).toBe('ProjMgmt__scrum_state');
  expect(list.items.length).toBeGreaterThan(0);
  expect(list.items.some((item: { disabled: boolean }) => item.disabled === false)).toBe(true);
  expect(list.items.some((item: { disabled: boolean }) => item.disabled === true)).toBe(true);
  for (const item of list.items) {
    expect(typeof item.value).toBe('string');
    expect(typeof item.text).toBe('string');
    expect(typeof item.disabled).toBe('boolean');
  }
  const operator = await request.get('/api/ibizplm__plmweb/dictionaries/codelist/SysOperator',
    { headers, params: { size: '1000' } });
  expect(operator.status()).toBe(200);
  expect(await operator.json()).toMatchObject({ code: 'SysOperator' });
  const anonymous = await request.get(endpoint, {
    headers: { authorization: '', cookie: '' }, params: query,
  });
  expect([401, 403]).toContain(anonymous.status());
});

test('English runtime state options keep server values and disabled transitions unchanged', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => localStorage.setItem('language', 'en'));
  await gotoApp(page);
  await expect(page.locator('#app-loading-x')).toBeHidden();
  const result = await page.evaluate(async () => {
    const { IBizContext } = await System.import('@ibiz-template/core');
    const app = ibiz.hub.getApp(ibiz.env.appId);
    const context = IBizContext.create(ibiz.appData.context);
    const items = await app.codeList.get('plmweb.projmgmt__scrum_state', context,
      { work_item_type_id: 'scrum_task', state: '10', size: 1000 });
    return items.map(item => ({ value: item.value, text: item.text, disabled: item.disableSelect }));
  });
  const response = await page.request.get('/api/ibizplm__plmweb/dictionaries/codelist/ProjMgmt__scrum_state', {
    headers: await authHeaders(page), params: { work_item_type_id: 'scrum_task', state: '10', size: 1000 },
  });
  expect(response.status()).toBe(200);
  const original = (await response.json()).items;
  expect(result.map(({ value, disabled }) => ({ value, disabled })))
    .toEqual(original.map(({ value, disabled }) => ({ value, disabled })));
  expect(result.find(item => item.value === '10')?.text).toBe('Open');
  expect(original.find(item => item.value === '10')?.text).toBe('打开');
});
