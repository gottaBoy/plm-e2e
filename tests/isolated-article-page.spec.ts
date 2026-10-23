import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { gotoApp, openMenu } from './helpers';

type PageRequest = {
  method: string;
  url: string;
  status: number;
  body?: string;
};

function readArticlePage() {
  const stdout = execFileSync(
    'docker',
    [
      'exec',
      process.env.PLM_E2E_MYSQL_CONTAINER || 'mysql',
      'mysql',
      '-h127.0.0.1',
      '-uroot',
      '-pMysql@2022',
      '--batch',
      '--raw',
      '-e',
      "SELECT ID,IDENTIFIER,NAME,IS_PUBLISHED,PUBLISHED,IS_DELETED,SPACE_ID FROM plm.page WHERE ID='plm_e2e_article_page'",
    ],
    { encoding: 'utf8' },
  ).trim();
  const lines = stdout.split('\n');
  expect(lines, 'fixed article page row must exist').toHaveLength(2);
  const headers = lines[0].split('\t');
  return Object.fromEntries(lines[1].split('\t').map((value, index) => [headers[index], value]));
}

test('article page loads, edits, and republishes from the wiki UI', async ({ page }) => {
  test.setTimeout(150_000);
  await gotoApp(page);
  await expect(page.getByText('工作台', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const pageRequests: PageRequest[] = [];
  page.on('response', response => {
    const request = response.request();
    const articleUrl = new URL(request.url());
    if (!articleUrl.pathname.includes('/article_pages/')) return;
    pageRequests.push({
      method: request.method(),
      url: request.url(),
      status: response.status(),
      body: request.postData() || undefined,
    });
  });

  await openMenu(page, '知识管理');
  await expect(page.getByText('产品生命周期管理系统', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByText('产品生命周期管理系统', { exact: true }).first().click();
  await expect(page.getByText('更新日志', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByText('更新日志', { exact: true }).first().dblclick();

  const article = page.getByText('E2E回归文档', { exact: true }).first();
  await expect(article).toBeVisible({ timeout: 30_000 });
  await article.click();

  await expect(page.getByText('加载失败', { exact: true })).toHaveCount(0);

  const detailEdit = page.getByRole('button', { name: '编辑', exact: true }).first();
  await expect(detailEdit).toBeVisible({ timeout: 30_000 });
  await expect(detailEdit).toBeEnabled({ timeout: 30_000 });
  await detailEdit.click();

  await expect(page.locator('.vditor')).toBeVisible({ timeout: 30_000 });
  const editor = page.locator('.vditor-ir > pre.vditor-reset[contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toContainText('E2E regression content', { timeout: 30_000 });
  await expect(page.locator('.el-loading-mask').first()).toBeHidden({ timeout: 30_000 });

  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nE2E publish regression');

  const publish = page.locator('button[title="发布"]');
  await expect(publish).toBeVisible({ timeout: 30_000 });
  await expect(publish).toBeEnabled({ timeout: 30_000 });
  await publish.click();

  await expect
    .poll(
      async () =>
        pageRequests.some(
          request =>
            request.method === 'POST' &&
            new URL(request.url).pathname.endsWith('/article_pages/publish_page') &&
            request.status === 200,
        ),
      { timeout: 30_000, message: 'publish action must issue a successful publish_page request' },
    )
    .toBe(true);
  await page.waitForTimeout(2_000);

  const failed = pageRequests.filter(request => request.status >= 400);
  const row = readArticlePage();
  const output = { requests: pageRequests, database: row };
  await test.info().attach('article page requests', {
    body: JSON.stringify(output, null, 2),
    contentType: 'application/json',
  });

  expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
  expect(row.IDENTIFIER).toBe('0001');
  expect(row.IS_PUBLISHED).toBe('1');
  expect(row.PUBLISHED).toBe('1');
  expect(row.IS_DELETED).toBe('0');
});
