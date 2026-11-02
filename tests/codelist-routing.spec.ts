import { expect, test } from '@playwright/test';
import { authHeaders } from './helpers';

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
