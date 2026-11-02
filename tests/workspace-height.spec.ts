import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

const workspacePath =
  '/#/-/index/-/workspace_tab_exp_view/srfnav=overview/recent_tree_exp_view/-';

test('workspace navigation and overview fill the available viewport height', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await gotoApp(page, workspacePath);
  const workspace = page.locator('.ibiz-view--workspace_tab_exp_view');
  const tree = workspace.locator('.ibiz-view--recent_tree_exp_view');
  await expect(tree).toBeVisible();
  await tree.getByText('\u6982\u89c8', { exact: true }).first().click();
  await expect(tree.locator('.ibiz-view--recent_data_view')).toBeVisible();

  const sizes = test.info().project.name === 'mobile'
    ? [{ width: 390, height: 844 }, { width: 390, height: 1000 }]
    : [{ width: 1440, height: 900 }, { width: 1440, height: 1200 },
      { width: 1440, height: 720 }];
  const measurements = [];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const read = () => workspace.evaluate(element => {
      const box = (selector: string) => {
        const target = document.querySelector(selector);
        if (!target) throw new Error(`Missing layout element: ${selector}`);
        const rect = target.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
      };
      const root = box('.ibiz-view--app_index_view');
      const host = document.querySelector('.ibiz-nav-pos-index')!;
      const hostBox = host.getBoundingClientRect();
      const padding = getComputedStyle(host);
      const view = element.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        root,
        hostContentHeight: hostBox.height - parseFloat(padding.paddingTop) -
          parseFloat(padding.paddingBottom),
        workspaceHeight: view.height,
        tree: box('.ibiz-view--recent_tree_exp_view'),
        overview: box('.ibiz-view--recent_data_view'),
        left: box('.ibiz-view--recent_tree_exp_view .ibiz-split-pane--left'),
        right: box('.ibiz-view--recent_tree_exp_view .ibiz-split-pane--right'),
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    await expect.poll(async () => Math.abs((await read()).root.height - size.height),
      { message: 'The application route shell must fill the viewport after resize' }).toBeLessThanOrEqual(1);
    const evidence = await read();
    expect(Math.abs(evidence.workspaceHeight - evidence.hostContentHeight),
      'The workspace must fill its parent after preserving the navigation padding').toBeLessThanOrEqual(1);
    expect(Math.abs(evidence.overview.height - evidence.right.height),
      'The loaded overview must fill the right pane').toBeLessThanOrEqual(1);
    if (test.info().project.name === 'mobile') {
      expect(evidence.right.y).toBeGreaterThanOrEqual(evidence.left.bottom - 1);
      expect(evidence.left.height).toBeLessThanOrEqual(180);
      expect(evidence.right.height).toBeGreaterThanOrEqual(300);
      expect(evidence.right.bottom).toBeLessThanOrEqual(size.height);
    } else {
      expect(Math.abs(evidence.left.height - evidence.tree.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(evidence.right.height - evidence.tree.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(evidence.tree.bottom - (size.height - 20))).toBeLessThanOrEqual(1);
    }
    expect(evidence.horizontalOverflow).toBeLessThanOrEqual(0);
    measurements.push(evidence);
    await page.screenshot({ path: test.info().outputPath(`workspace-${size.height}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
  await test.info().attach('workspace-height', {
    body: Buffer.from(JSON.stringify({ measurements, errors, url: page.url() }, null, 2)),
    contentType: 'application/json',
  });
});
