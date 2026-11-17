import { expect, test } from '@playwright/test';
import {
  expectMainContent,
  expectNoHorizontalOverflow,
  gotoApp,
  menus,
  openMenu,
} from './helpers';

const expectedContent: Record<string, string[]> = {
  工作台: ['首页', '仪表盘', '工时', '概览', '待办'],
  产品管理: ['全部产品'],
  项目管理: ['全部项目'],
  测试管理: ['测试管理'],
  知识管理: ['产品生命周期管理系统'],
  效能度量: ['效能度量'],
  协作空间: ['协作空间'],
  资源管理: ['工时管理', '登记人', '总登记时长'],
  自动化: ['全部规则'],
  智能协同: ['智能体模板'],
  应用市场: ['发现应用市场', '已安装应用', '自定义安装'],
  二次开发: ['接口说明', '数据模型', 'Modeling IDE'],
};

for (const menu of menus) {
  test(`${menu} opens and renders`, async ({ page }) => {
    await gotoApp(page);
    await openMenu(page, menu);
    await expectMainContent(page);

    for (const expected of expectedContent[menu]) {
      await expect(page.locator('body')).toContainText(expected);
    }
    await expectNoHorizontalOverflow(page);
  });
}

test('secondary development API reference keeps the local document theme', async ({ page }) => {
  await gotoApp(page);
  await openMenu(page, '二次开发');
  const apiLink = page.getByText('接口说明', { exact: true }).first();
  await expect(apiLink).toBeVisible();
  await apiLink.click();

  const frame = page.frames().find(item => item.url().includes('/doc/'));
  expect(frame, 'API reference iframe must load the local Docsify document').toBeTruthy();
  await expect(frame!.locator('.markdown-section').first()).toBeVisible();
  const style = await frame!.locator('h1').first().evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      fontSize: computed.fontSize,
      color: computed.color,
      textDecoration: computed.textDecorationLine,
    };
  });
  expect(Number.parseFloat(style.fontSize)).toBeGreaterThanOrEqual(24);
  expect(style.color).not.toBe('rgb(0, 0, 238)');
  expect(style.textDecoration).not.toContain('underline');
  expect(await frame!.locator('.sidebar').evaluate(element => getComputedStyle(element).width))
    .toBe('250px');
});
