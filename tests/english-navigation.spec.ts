import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoApp, menus } from './helpers';

const content: Record<string, string[]> = {
  工作台: ['Home', 'Dashboard', 'Worklog', 'Overview', 'To Do'],
  产品管理: ['All Products'],
  项目管理: ['All Projects', 'Organization Projects', 'Team Projects', 'Project Sets', 'Filters', 'Archived Projects'],
  测试管理: ['Testing', 'All Test Libraries', 'Organization Test Libraries', 'Team Test Libraries', 'Archived Test Libraries'],
  知识管理: ['All Spaces', 'Organization Spaces', 'Team Spaces', 'Personal Spaces', 'Shared with Me', 'My Favorites', 'Categories', 'Archived Spaces'],
  效能度量: ['Insights', 'All Views', 'Organization Views', 'Team Views', 'Personal Views'],
  协作空间: ['Collaboration', 'All Topics', 'Organization Topics', 'Team Topics', 'Latest Discussions'],
  资源管理: ['Worklog Management', 'Registered By', 'Total Logged Hours'],
  自动化: ['All Rules'],
  智能协同: ['Agent Templates'],
  应用市场: ['Discover', 'Installed Apps', 'Custom Install'],
  二次开发: ['API Reference', 'Data Model', 'Modeling IDE'],
};

for (const [index, menu] of menus.entries()) {
  test(`English ${menu} navigation renders translated core labels`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await gotoApp(page);
    await page.evaluate(() => localStorage.setItem('language', 'en'));
    await gotoApp(page);
    await expect(page.locator('#app-loading-x')).toBeHidden();
    const marketplaceResponse = menu === '应用市场'
      ? page.waitForResponse(response =>
        new URL(response.url()).pathname.endsWith('/pscoreprdfuncs/fetchdefault') &&
        response.request().method() === 'POST', { timeout: 30_000 })
      : undefined;
    await page.locator('.el-menu-item').nth(index).click();
    if (marketplaceResponse) {
      const response = await marketplaceResponse;
      expect(response.status(), 'marketplace dataset must succeed').toBe(200);
    }
    for (const label of content[menu]) {
      await expect(page.locator('body')).toContainText(label);
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    if (['项目管理', '知识管理'].includes(menu)) {
      const field = menu === '项目管理' ? 'Project' : 'Space';
      await expect(page.getByPlaceholder(`${field} Identifier、${field} Name`, { exact: true })).toBeVisible();
    }
    await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0, {
      timeout: menu === '应用市场' ? 30_000 : 10_000,
    });
    const commands: Record<string, string> = {
      产品管理: 'New Product', 项目管理: 'New Project',
      测试管理: 'New Test Library', 知识管理: 'New Space',
    };
    if (commands[menu]) {
      const command = page.locator(`button[title="${commands[menu]}"]`);
      await expect(command).toBeVisible();
      await expect(command).toBeEnabled();
      await command.click({ trial: true });
      const bounds = (await command.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(await command.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return [0.1, 0.5, 0.9].map(fraction => {
          const hit = document.elementFromPoint(rect.x + rect.width * fraction, rect.y + rect.height / 2);
          return hit !== null && (hit === element || element.contains(hit));
        });
      }), 'create command must not be clipped or covered').toEqual([true, true, true]);
    }
    for (const label of await page.locator('.ibiz-no-data:visible .el-empty__description').all()) {
      await expect(label).toHaveText(/^(?:No Data|No data available)$/);
    }
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('english-module.png'), fullPage: true });
  });
}
