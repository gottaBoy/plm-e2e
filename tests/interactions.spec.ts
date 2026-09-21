import { expect, test } from '@playwright/test';
import { menus, openMenu } from './helpers';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', 'Interaction depth is covered on desktop');
  test.setTimeout(120_000);
});

for (const menu of menus) {
  test(`${menu} common navigation controls`, async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMenu(page, menu);

  const treeNodes = page.locator('.el-tree-node__content:visible');
  if ((await treeNodes.count()) > 1) {
    await treeNodes.nth(1).click({ timeout: 5_000 });
    await page.waitForTimeout(2_000);
    await expect(page.locator('body')).toBeVisible();
  }

  const tabs = page.locator('[role="tab"]:visible');
  const tabTexts = (await tabs.allInnerTexts())
    .map(text => text.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const tabText of tabTexts) {
    await tabs.filter({ hasText: tabText }).first().click();
    await page.waitForTimeout(1_500);
    await expect(page.locator('body')).toBeVisible();
  }
});
}
