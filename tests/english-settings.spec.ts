import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test('English configuration panels and create dialogs translate commands without saving data',
  async ({ page }) => {
    const mutations: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (['PUT', 'PATCH', 'DELETE'].includes(request.method()) ||
          (request.method() === 'POST' &&
            /\/(?:workload_types|extend_print_templs)\/?$/.test(pathname))) {
        mutations.push(`${request.method()} ${pathname}`);
      }
    });
    await gotoApp(page);
    await page.evaluate(() => localStorage.setItem('language', 'en'));
    const path = '/#/-/index/-/management_tab_exp_view/srfnav=config/management_setting_view';
    await gotoApp(page, `${path}/srfnav=role/role_grid_view/-`);
    await expect(page.locator('#app-loading-x')).toBeHidden();
    const sidebar = page.locator('.ibiz-route-drbar-control');
    for (const caption of ['Role Configuration', 'Worklog Settings', 'Entity Printing']) {
      await expect(sidebar.getByText(caption, { exact: true })).toBeVisible();
    }
    for (const panel of [
      { caption: 'Worklog Settings', view: 'workload_type_setup_grid_view', command: 'New Category',
        fields: ['Category'] },
      { caption: 'Entity Printing', view: 'extend_print_templ_grid_view', command: 'New Template',
        fields: ['Name', 'Entity ID', 'Print ID', 'Print Model'] },
    ]) {
      await sidebar.getByText(panel.caption, { exact: true }).click();
      const view = page.locator(`.ibiz-view--${panel.view}:visible`);
      await expect(view).toBeVisible();
      await view.locator(`button[title="${panel.command}"]`).click();
      const dialog = page.locator('.ibiz-modal:visible').last();
      await expect(dialog.locator('.ibiz-control-form')).toBeVisible();
      for (const field of panel.fields) {
        await expect(dialog.locator('.ibiz-form-item-container__label')
          .filter({ hasText: field }).first()).toBeVisible();
      }
      await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${panel.view}-english.png`), fullPage: true });
      await dialog.locator('.el-dialog__headerbtn').click();
      await expect(dialog).toBeHidden();
    }
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
