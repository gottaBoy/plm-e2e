import { expect, test } from '@playwright/test';
import { authHeaders } from './helpers';

test('core model APIs are routed correctly', async ({ page }) => {
  const request = page.request;
  const headers = await authHeaders(page);
  const jsonSchema = await request.get(
    '/api/ibizplm__plmweb/jsonschema/TICKET?product_id=ab8f7ceb-631b-7b96-53ee-257b0c032619&id=c7bfe5b37a91dfa7da3e4d0cf026bbf2&product=ab8f7ceb-631b-7b96-53ee-257b0c032619',
    { headers },
  );
  expect(jsonSchema.status()).toBe(200);
  const contentType = (await jsonSchema.headers())['content-type'] || '';
  expect(contentType).toContain('application/json');

  const operators = await request.get(
    '/api/ibizplm__plmweb/dictionaries/codelist/SysOperator?size=10000',
    { headers },
  );
  expect(operators.status()).toBe(200);
  expect(await operators.json()).toMatchObject({ code: 'SysOperator' });
});
