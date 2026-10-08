import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { appPath, authHeaders, clickTab, expectNoHorizontalOverflow } from './helpers';

function monitor(page: Page) {
  const pending: Promise<void>[] = [];
  const evidence = {
    baseUrl: test.info().project.use.baseURL,
    distRoot: process.env.PLM_E2E_DIST_ROOT,
    fixtureAcceptance: false,
    nativeAcceptance: false,
    scope: 'Native read-only plugin navigation, not complete plugin functionality',
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    requests: [] as Array<{ url: string; method: string; status: number }>,
    checkpoints: [] as string[],
    transitions: [] as Array<Record<string, unknown>>,
    datasets: [] as Array<{ url: string; status: number; rows: number; ids: string[] }>,
    readiness: [] as Array<{ checkpoint: string; startupHidden: boolean; loadingMasks: number }>,
    navigation: { back: false, forward: false, reload: false },
    evidenceCaptureErrors: [] as string[],
    settle: () => Promise.all(pending),
  };
  page.on('pageerror', error => evidence.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (/\/(?:api|plugins)\//.test(response.url())) {
      evidence.requests.push({
        url: response.url(), method: response.request().method(), status: response.status(),
      });
      if (/\/(?:roles|workload_types|extend_print_templs)\/fetch_default(?:\?|$)/.test(response.url())) {
        pending.push(response.json().then(rows => {
          if (!Array.isArray(rows)) throw new Error(`native dataset is not an array: ${response.url()}`);
          evidence.datasets.push({
            url: response.url(), status: response.status(), rows: rows.length,
            ids: rows.map(row => String(row.id)),
          });
        }).catch(error => { evidence.evidenceCaptureErrors.push(String(error)); }));
      }
    }
  });
  return evidence;
}

async function checkpoint(page: Page, evidence: ReturnType<typeof monitor>, name: string) {
  await nativeReady(page);
  evidence.readiness.push({
    checkpoint: name, startupHidden: !(await page.locator('#app-loading-x').isVisible()),
    loadingMasks: await page.locator('.el-loading-mask:visible').count(),
  });
  evidence.checkpoints.push(name);
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

async function nativeReady(page: Page) {
  await expect(page.locator('#app-loading-x')).toBeHidden();
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
}

async function pointerHit(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const points = [0.1, 0.5, 0.9].map(fraction => {
      const target = document.elementFromPoint(rect.x + rect.width * fraction, rect.y + rect.height / 2);
      return target !== null && (target === element || element.contains(target));
    });
    return { points, width: rect.width, height: rect.height };
  });
}

async function finish(evidence: ReturnType<typeof monitor>) {
  await evidence.settle();
  const file = test.info().outputPath('plugin-navigation-evidence.json');
  await writeFile(file, JSON.stringify(evidence, null, 2));
  await test.info().attach('plugin-navigation-evidence', { path: file, contentType: 'application/json' });
}

function assertNoErrors(evidence: ReturnType<typeof monitor>) {
  expect(evidence.pageErrors, 'native browser errors must remain failures').toEqual([]);
  expect(evidence.consoleErrors, 'native console errors must remain failures').toEqual([]);
  expect(evidence.evidenceCaptureErrors, 'native response capture must complete').toEqual([]);
  expect(evidence.requests.filter(request => request.status >= 400),
    'native API/plugin errors must remain failures').toEqual([]);
  expect(evidence.requests.filter(request => ['PUT', 'PATCH', 'DELETE'].includes(request.method)),
    'read-only navigation must not update business records').toEqual([]);
}

const productPanels = [
  { caption: '需求', group: 'usrdrgroup1228809432', view: 'idea_tree_exp_view' },
  { caption: '排期', group: 'usrdrgroup1228149482', view: 'product_plan_tree_exp_view' },
  { caption: '工单', group: 'usrdrgroup1228280909', view: 'ticket_all_grid_view' },
  { caption: '客户', group: 'usrdrgroup1228275731', view: 'customer_tree_exp_view' },
  { caption: '基线', group: 'usrdrgroup0423482168', view: 'baseline_product_tree_exp_view' },
  { caption: '评审', group: 'usrdrgroup0425581290', view: 'review_idea_tree_exp_view' },
  { caption: '项目', group: 'usrdrgroup1203616060', view: 'relation_product_re_project_grid_view' },
  { caption: '文档', group: 'usrdrgroup0229373827', view: 'space_product_re_tree_exp_view' },
];

test('product relationship tabs bind all eight real panels and preserve native browser navigation', async ({ page }) => {
  test.setTimeout(180_000);
  const evidence = monitor(page);
  try {
    const headers = await authHeaders(page);
    const response = await page.request.post('/api/ibizplm__plmweb/products/fetch_default', {
      headers, data: { page: 0, size: 100 },
    });
    expect(response.status()).toBe(200);
    const products = await response.json();
    expect(products.length, 'real product context is required, not a fixture').toBeGreaterThan(0);
    const id = products[0].id;
    expect(id).toBeTruthy();
    // This is the product model's open_new relationship entry, not its edit-form route.
    await page.goto(appPath(`/#/-/index/product=${encodeURIComponent(id)}/product_index_view/srfnav=usrdrgroup1228809432/idea_tree_exp_view/srfnavctx=%257B%2522srfdefaulttoroutedepth%2522%253A3%257D;srfnav=root%3Anode/idea_all_grid_view/-`),
      { waitUntil: 'domcontentloaded' });
    await nativeReady(page);
    const bar = page.locator('.ibiz-view--product_index_view .ibiz-control-drbar-ex').first();
    await expect(bar).toBeVisible();
    await expect(bar.locator('[role="tab"]')).toHaveCount(productPanels.length);
    for (const panel of productPanels) {
      const tab = bar.locator(`#tab-${panel.group}`);
      await expect(tab).toContainText(panel.caption);
      if ((await tab.getAttribute('aria-selected')) !== 'true') await clickTab(tab);
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const view = page.locator(`.ibiz-view--${panel.view}:visible`);
      await expect(view, `native ${panel.caption} relation panel must render`).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/product_index_view/srfnav=${panel.group}/`));
      const control = view.locator('.ibiz-control-grid, .ibiz-control-treeexpbar, .ibiz-control-tree').first();
      await expect(control, `${panel.caption} must render a real data control`).toBeVisible();
      await nativeReady(page);
      evidence.transitions.push({
        caption: panel.caption, group: panel.group, view: panel.view,
        url: page.url(), selected: await tab.getAttribute('aria-selected'),
        panel: await view.boundingBox(), control: await control.boundingBox(),
        emptyState: await view.getByText('暂无数据', { exact: true }).count(),
      });
    }
    await checkpoint(page, evidence, 'product-eight-panels');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(bar.locator(`#tab-${productPanels[6].group}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`.ibiz-view--${productPanels[6].view}:visible`)).toBeVisible();
    evidence.navigation.back = true;
    await checkpoint(page, evidence, 'product-tabs-back');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expect(bar.locator(`#tab-${productPanels[7].group}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`.ibiz-view--${productPanels[7].view}:visible`)).toBeVisible();
    evidence.navigation.forward = true;
    await checkpoint(page, evidence, 'product-tabs-forward');
    const selectedUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(selectedUrl);
    await expect(bar.locator(`#tab-${productPanels[7].group}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`.ibiz-view--${productPanels[7].view}:visible`)).toBeVisible();
    evidence.navigation.reload = true;
    await expectNoHorizontalOverflow(page);
    await checkpoint(page, evidence, 'product-tabs-reloaded');
    expect(evidence.requests.some(request =>
      request.url.includes('/plugins/@ibiz-template-plm/drbar-ex@0.0.3-alpha.241/') &&
      request.status === 200)).toBe(true);
    assertNoErrors(evidence);
  } finally {
    await finish(evidence);
  }
});

const managementPanels = [
  { caption: '角色配置', item: 'role', view: 'role_grid_view', dataset: 'roles', command: null,
    modalView: null, fields: [] },
  { caption: '工时设置', item: 'workload', view: 'workload_type_setup_grid_view', dataset: 'workload_types', command: '新建类别',
    modalView: 'workload_type_quick_create_view', fields: ['name'] },
  { caption: '实体打印', item: 'print', view: 'extend_print_templ_grid_view', dataset: 'extend_print_templs', command: '新建模版',
    modalView: 'extend_print_templ_quick_cfg_view', fields: ['name', 'de_tag', 'print_tag', 'print_model'] },
];

test('management route sidebar binds real configuration panels and restores history and reload state', async ({ page }) => {
  test.setTimeout(120_000);
  const evidence = monitor(page);
  try {
    await page.goto(appPath('/#/-/index/-/management_tab_exp_view/srfnav=config/management_setting_view/srfnav=role/role_grid_view/-'),
      { waitUntil: 'domcontentloaded' });
    await nativeReady(page);
    const view = page.locator('.ibiz-view--management_setting_view');
    const bar = view.locator('.ibiz-route-drbar-control').first();
    await expect(bar).toBeVisible();
    for (const panel of managementPanels) {
      const item = bar.locator('.ibiz-route-drbar-control__item').filter({ hasText: panel.caption });
      await expect(item).toHaveCount(1);
      await item.click();
      await expect(item).toHaveClass(/is-active/);
      const panelView = view.locator(`.ibiz-view--${panel.view}:visible`);
      await expect(panelView).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/management_setting_view/srfnav=${panel.item}/`));
      const grid = panelView.locator('.ibiz-control-grid');
      await expect(grid).toBeVisible();
      await nativeReady(page);
      const bounds = await grid.boundingBox();
      await expect.poll(() => evidence.datasets.filter(dataset =>
        dataset.url.includes(`/${panel.dataset}/fetch_default`)).length).toBeGreaterThan(0);
      const dataset = evidence.datasets.filter(dataset =>
        dataset.url.includes(`/${panel.dataset}/fetch_default`)).at(-1)!;
      expect(dataset.status).toBe(200);
      const emptyState = grid.getByText('暂无数据', { exact: true });
      if (dataset.rows === 0) await expect(emptyState).toBeVisible();
      else await expect(grid.locator('.el-table__body-wrapper .el-table__row')).toHaveCount(dataset.rows);
      evidence.transitions.push({
        caption: panel.caption, item: panel.item, view: panel.view, url: page.url(),
        grid: bounds, dataset: panel.dataset, rows: dataset.rows,
        emptyState: await emptyState.count(),
      });
      expect((await grid.boundingBox())?.width, 'settings data grid needs an inspectable native viewport')
        .toBeGreaterThanOrEqual(240);
      expect(bounds?.height, 'settings data grid needs usable rows, not a collapsed pane')
        .toBeGreaterThanOrEqual(240);
      if (panel.command) {
        const command = panelView.getByRole('button', { name: new RegExp(`${panel.command}$`) });
        await expect(command).toHaveCount(1);
        await expect(command).toHaveAttribute('title', panel.command);
        await expect(command.locator('.ibiz-toolbar-item-text')).toHaveText(panel.command);
        await expect(command).toBeVisible();
        await expect(command).toBeEnabled();
        const hit = await pointerHit(command);
        const observed: Record<string, unknown> = {
          name: panel.command,
          title: await command.getAttribute('title'),
          text: await command.locator('.ibiz-toolbar-item-text').innerText(),
          visible: await command.isVisible(),
          enabled: await command.isEnabled(),
          ...hit,
        };
        evidence.transitions.at(-1)!.command = observed;
        expect(hit.points, `${panel.command} must not be clipped by its mobile toolbar`).toEqual([true, true, true]);
        const panelUrl = page.url();
        await command.click();
        const modal = page.locator(`.ibiz-modal:visible`).filter({
          has: page.locator(`.ibiz-view--${panel.modalView}`),
        });
        await expect(modal).toHaveCount(1);
        await expect(modal.locator('.ibiz-control-form')).toBeVisible();
        await nativeReady(page);
        const fields: Array<{ name: string; points: boolean[]; width: number; height: number }> = [];
        const buttons: Array<{ name: string; points: boolean[]; width: number; height: number }> = [];
        const closeButton = modal.locator('.el-dialog__headerbtn');
        await expect(closeButton).toHaveCount(1);
        await expect(closeButton).toBeVisible();
        await expect(closeButton).toBeEnabled();
        const close = await closeButton.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            viewport: { width: innerWidth, height: innerHeight },
            inViewport: rect.x >= 0 && rect.y >= 0 &&
              rect.right <= innerWidth && rect.bottom <= innerHeight,
            points: [0.1, 0.5, 0.9].map(fraction => {
              const hit = document.elementFromPoint(rect.x + rect.width * fraction, rect.y + rect.height / 2);
              return hit !== null && (hit === element || element.contains(hit));
            }),
          };
        });
        const dialog = {
          view: panel.modalView, opened: true, canceled: false, headerClosed: false,
          closeConfirmation: { canceled: false, retainedValue: false, confirmed: false, draftDiscarded: false },
          bounds: await modal.boundingBox(), fields, buttons, close,
        };
        observed.dialog = dialog;
        expect(close.inViewport, `${panel.command} header close must fit the initial viewport`).toBe(true);
        expect(close.points, `${panel.command} header close must receive native pointer events`)
          .toEqual([true, true, true]);
        for (const name of panel.fields) {
          const item = modal.locator(`.ibiz-form-item--${name}`);
          await expect(item).toBeVisible();
          const editor = item.locator('input.el-input__inner, textarea.el-textarea__inner').first();
          const editorHit = await pointerHit(editor);
          expect(editorHit.points, `${panel.command} ${name} must receive native pointer events`)
            .toEqual([true, true, true]);
          fields.push({ name, ...editorHit });
        }
        for (const name of ['确定', '取消']) {
          const button = modal.getByRole('button', { name, exact: true });
          const buttonHit = await pointerHit(button);
          expect(buttonHit.points, `${panel.command} ${name} must be usable`).toEqual([true, true, true]);
          buttons.push({ name, ...buttonHit });
        }
        await checkpoint(page, evidence, `management-${panel.item}-command-opened`);
        await expectNoHorizontalOverflow(page);
        await modal.getByRole('button', { name: '取消', exact: true }).click();
        await expect(modal).toHaveCount(0);
        await expect(page).toHaveURL(panelUrl);
        await expect(command).toBeEnabled();
        dialog.canceled = true;
        await command.click();
        await expect(modal).toHaveCount(1);
        await nativeReady(page);
        const nameInput = modal.locator('.ibiz-form-item--name input.el-input__inner');
        const dismissedName = `n04-dismissed-${panel.item}-${test.info().project.name}`;
        await nameInput.fill(dismissedName);
        await closeButton.click();
        const confirmation = page.getByRole('dialog', { name: '关闭提醒', exact: true });
        await expect(confirmation).toBeVisible();
        await expect(confirmation).toContainText('表单数据已经修改，确定要关闭？');
        await confirmation.getByRole('button', { name: '取消', exact: true }).click();
        await expect(confirmation).toBeHidden();
        await expect(modal).toHaveCount(1);
        await expect(nameInput).toHaveValue(dismissedName);
        dialog.closeConfirmation.canceled = true;
        dialog.closeConfirmation.retainedValue = true;
        await closeButton.click();
        await expect(confirmation).toBeVisible();
        await confirmation.getByRole('button', { name: '确定', exact: true }).click();
        await expect(confirmation).toBeHidden();
        await expect(modal).toHaveCount(0);
        await expect(page).toHaveURL(panelUrl);
        await expect(command).toBeEnabled();
        dialog.closeConfirmation.confirmed = true;
        dialog.headerClosed = true;
        await command.click();
        await expect(modal).toHaveCount(1);
        await nativeReady(page);
        await expect(nameInput).toHaveValue('');
        dialog.closeConfirmation.draftDiscarded = true;
        await modal.getByRole('button', { name: '取消', exact: true }).click();
        await expect(modal).toHaveCount(0);
        await expect(page).toHaveURL(panelUrl);
      }
    }
    await checkpoint(page, evidence, 'management-three-panels');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(bar.locator('.ibiz-route-drbar-control__item').filter({ hasText: '工时设置' }))
      .toHaveClass(/is-active/);
    await expect(view.locator('.ibiz-view--workload_type_setup_grid_view:visible')).toBeVisible();
    evidence.navigation.back = true;
    await checkpoint(page, evidence, 'management-sidebar-back');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expect(bar.locator('.ibiz-route-drbar-control__item').filter({ hasText: '实体打印' }))
      .toHaveClass(/is-active/);
    await expect(view.locator('.ibiz-view--extend_print_templ_grid_view:visible')).toBeVisible();
    evidence.navigation.forward = true;
    await checkpoint(page, evidence, 'management-sidebar-forward');
    const selectedUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(selectedUrl);
    await expect(bar.locator('.ibiz-route-drbar-control__item').filter({ hasText: '实体打印' }))
      .toHaveClass(/is-active/);
    await expect(view.locator('.ibiz-view--extend_print_templ_grid_view:visible .ibiz-control-grid'))
      .toBeVisible();
    evidence.navigation.reload = true;
    await expectNoHorizontalOverflow(page);
    await checkpoint(page, evidence, 'management-sidebar-reloaded');
    for (const ref of [
      '@ibiz-template-plm/route-drbar@0.0.3-alpha.276',
      '@ibiz-template-plm/breadcrumb-nav-pos@0.0.3-alpha.247',
    ]) expect(evidence.requests.some(request =>
      request.url.includes(`/plugins/${ref}/`) && request.status === 200)).toBe(true);
    assertNoErrors(evidence);
  } finally {
    await finish(evidence);
  }
});
