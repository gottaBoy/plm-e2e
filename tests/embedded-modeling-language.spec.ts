import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

for (const language of ['en', 'zh-CN']) {
  test(`embedded Modeling IDE stays visible on entry and its manual console follows ${language}`,
    async ({ page }) => {
      const mqttSockets: string[] = [];
      page.on('websocket', socket => {
        if (/\/mqtt(?:\/|$)/.test(new URL(socket.url()).pathname)) mqttSockets.push(socket.url());
      });
      await gotoApp(page);
      await page.evaluate(value => localStorage.setItem('language', value), language);
      await gotoApp(page, '/#/-/index/-/ps_core_prd_func_second_dev_tav_exp_view/srfnav=modeling/ps_core_prd_func_modeling_ide_html_view/-');
      const iframe = page.locator('.ibiz-view--ps_core_prd_func_modeling_ide_html_view iframe');
      await expect(iframe).toBeVisible();
      const src = new URL((await iframe.getAttribute('src'))!, page.url());
      expect(src.searchParams.get('language')).toBe(language);
      const frame = iframe.contentFrame();
      await expect(frame.locator('html')).toHaveAttribute('lang', language);
      await expect(frame.locator('#app-loading-x')).toBeHidden();
      await expect(frame.locator('.aibiz-design-index')).toBeVisible();
      await expect(frame.locator('.ibiz-drawer.open'),
        'The embedded IDE must not automatically open a console over the workspace').toHaveCount(0);
      const consoleMenu = frame.locator('.ibiz-bottom-side-menu').getByText(
        language === 'en' ? 'Console' : '控制台', { exact: true },
      );
      await expect.poll(() => consoleMenu.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= 0 && bounds.bottom <= innerHeight;
      }), { message: 'A long entity tree must not push the console menu below the iframe' }).toBe(true);
      await consoleMenu.scrollIntoViewIfNeeded();
      await consoleMenu.click();
      const console = frame.locator('.aibiz-console');
      await expect(console).toBeVisible();
      const close = frame.locator('.aibiz-console-drawer .el-drawer__close-btn');
      await expect(close, 'The manually opened console must have a usable close control').toBeVisible();
      await expect(console).toHaveAttribute('data-console-status', 'disabled');
      await expect(console.getByRole('alert')).toHaveCount(0);
      await expect(console).not.toContainText('Authenticated host MQTT service is unavailable.');
      expect(mqttSockets, 'disabled deployment must not fabricate a broker connection').toEqual([]);
      if (language === 'en') {
        await expect(frame.getByText('System Overview', { exact: true })).toHaveCount(1);
        await expect(frame.getByText('Entity Navigation', { exact: true }).first()).toBeVisible();
        await expect(console.getByRole('searchbox', { name: 'Filter logs', exact: true })).toBeVisible();
        await expect(console).toContainText('MQTT is disabled in this deployment.');
        expect((await frame.locator('[role="tab"]:visible').allInnerTexts()).join(' '))
          .not.toMatch(/执行中|已完成|系统问题/);
      } else {
        await expect(frame.getByText('系统总览', { exact: true })).toHaveCount(1);
        await expect(console.getByRole('searchbox', { name: '筛选日志', exact: true })).toBeVisible();
        await expect(console).toContainText('当前部署未启用 MQTT，实时日志不可用。');
      }
      await page.screenshot({ path: test.info().outputPath(`modeling-${language}.png`), fullPage: true });
      await close.click();
      await expect(frame.locator('.ibiz-drawer.open')).toHaveCount(0);
      await expect(frame.locator('.aibiz-design-index')).toBeVisible();
    });
}
