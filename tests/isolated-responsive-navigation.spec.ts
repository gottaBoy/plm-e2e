import { expect, test } from '@playwright/test';
import { clickTab, expectNoHorizontalOverflow, gotoApp, openMenu, type MenuName } from './helpers';

const expectedTabs: Record<string, string[]> = {
  工作台: ['首页', '仪表盘', '工时'],
  产品管理: [],
  项目管理: [],
  资源管理: ['工时日历', '工时日志'],
};

for (const menu of ['工作台', '产品管理', '项目管理', '资源管理'] as MenuName[]) {
  test(`${menu} tree panes and native tabs stay usable on the current viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await gotoApp(page);
    await openMenu(page, menu);
    const splits = page.locator('.ibiz-split-container--view_exp_split:visible');
    expect(await splits.count(), 'real navigation must expose its tree split').toBeGreaterThan(0);
    const panes = [];
    for (const split of await splits.all()) {
      const row = split.locator(':scope > .ibiz-split-wrapper > .ibiz-split--horizontal');
      const left = await row.locator(':scope > .ibiz-split-pane--left').boundingBox();
      const right = await row.locator(':scope > .ibiz-split-pane--right').boundingBox();
      const outer = await split.boundingBox();
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      expect(outer).not.toBeNull();
      if (test.info().project.name === 'mobile') {
        expect(right!.y, 'content must be below the tree, not obscured by it').toBeGreaterThanOrEqual(left!.y + left!.height - 1);
        expect(right!.width, 'active view must receive the full navigation width').toBeGreaterThanOrEqual(outer!.width - 2);
        expect(left!.height).toBeLessThanOrEqual(180);
      } else {
        expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width - 1);
      }
      panes.push({ left, right, outer });
    }
    const viewUrl = page.url();
    const labels = (await page.locator('[role="tab"]:visible').allInnerTexts()).map(label => label.trim()).filter(Boolean);
    expect(labels, 'native tab surface must match the menu contract, including tree-only entries')
      .toEqual(expectedTabs[menu]);
    for (const [index, label] of labels.entries()) {
      if (index > 0) {
        await page.goto(viewUrl, { waitUntil: 'domcontentloaded' });
      }
      const tab = page.getByRole('tab', { name: label, exact: true }).first();
      await clickTab(tab);
      await expect(tab, 'click must actually select its native tab').toHaveAttribute('aria-selected', 'true');
    }
    await expectNoHorizontalOverflow(page);
    expect(errors, 'layout must not produce runtime errors').toEqual([]);
    await test.info().attach('responsive-native-navigation', {
      body: Buffer.from(JSON.stringify({
        fixtureAcceptance: false, nativeAcceptance: false,
        scope: 'real tree layout and tab interactions only, not complete PLM acceptance',
        baseUrl: test.info().project.use.baseURL, distRoot: process.env.PLM_E2E_DIST_ROOT,
        menu, panes, labels, errors, lastUrl: page.url(),
      }, null, 2)),
      contentType: 'application/json',
    });
    await page.screenshot({ path: test.info().outputPath('navigation.png'), fullPage: true });
  });
}
