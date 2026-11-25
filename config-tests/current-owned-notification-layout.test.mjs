import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scopeNotificationCss } from '../../scripts/prepare-plm-notification-style.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hub = path.join(workspace, 'ibiz-app-hub');
const require = createRequire(path.join(workspace, 'plm-e2e/package.json'));
const hubRequire = createRequire(path.join(hub, 'package.json'));
const { chromium } = require('@playwright/test');
const sass = hubRequire('sass');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  'components/ibiz-next-vue3/src/panel-component/user-message/user-message.scss',
  'components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-group/internal-message-group.scss',
  'components/ibiz-next-vue3/src/panel-component/user-message/internal-message/common/internal-message-container/internal-message-container.scss',
];
const global = path.join(hub, 'packages/theme/style/global.scss');
const compile = entries => sass.compileString(
  `@use ${JSON.stringify(global)} as *;\n${entries.join('\n')}`,
  { style: 'expanded', loadPaths: [path.join(hub, 'node_modules')], logger: sass.Logger.silent },
).css;
const current = sources.map(filename => fs.readFileSync(path.join(hub, filename), 'utf8'));
const baseline = sources.map(filename => execFileSync('git', ['show', `HEAD:${filename}`], { cwd: hub, encoding: 'utf8' }));
const oldCss = compile(baseline), newCss = scopeNotificationCss(compile(current));
const artifact = path.join(workspace, '.artifacts', `notification-layout-${randomUUID()}`);
fs.mkdirSync(artifact, { mode: 0o700 });

function fixture(css, english, inlineWidth = false) {
  const text = english ? 'Notification content' : '通知内容';
  return `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root { --ibiz-spacing-tight:8px; --ibiz-spacing-loose:16px; --ibiz-user-message-header-height:40px; }
      * { box-sizing:border-box; }
      body { margin:0; font:14px Arial,sans-serif; }
      .el-popover { position:absolute; right:12px; top:12px; padding:12px; background:white; border:1px solid #888; }
      .ibiz-internal-message-tab { height:100%; overflow:auto; }
      .ibiz-internal-message-group__content--html { min-height:80px; }
      .ibiz-internal-message-group__action--item { display:block; background:#ddd; }
      .ibiz-internal-message-container { margin-top:8px; min-height:100px; }
      .ibiz-internal-message-container-toolbar__button { display:block; width:18px; height:18px; background:#ccc; }
      ${css}
    </style></head><body>
    <div class="el-popover ibiz-user-message-popover"${inlineWidth ? ' style="width:500px;height:500px"' : ''}>
      <div class="ibiz-internal-message-tab">
        <div class="ibiz-internal-message-group">
          <div class="ibiz-internal-message-group__content">
            <div class="ibiz-internal-message-group__content--html">${text} ${'long-unbroken-template-value'.repeat(20)}</div>
            <div class="ibiz-internal-message-group__action">
              <ion-icon class="ibiz-internal-message-group__action--item" title="${english ? 'Expand' : '展开'}">+</ion-icon>
            </div>
          </div>
        </div>
        <div class="ibiz-internal-message-container">
          <div>${text} 中文 e&#769; &#128578;</div>
          <div class="ibiz-internal-message-container-toolbar">
            <span class="ibiz-internal-message-container-toolbar__button" title="${english ? 'Mark as read' : '标记为已读'}">R</span>
          </div>
        </div>
      </div>
    </div></body></html>`;
}

test('actual notification SCSS keeps mobile popovers and controls inside the viewport without a business request', async t => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  t.after(() => browser.close());
  const report = { contract: 'notification-layout-source-browser-v1', syntheticDom: true,
    authenticatedBusinessAcceptance: false, httpRequests: 0, baselineReproducedOverflow: false,
    sources: sources.map((filename, index) => ({ path: filename, sha256: digest(current[index]),
      baselineHeadSha256: digest(baseline[index]) })), cssSha256: digest(newCss), cells: [] };
  for (const mobile of [false, true]) {
    for (const english of [false, true]) {
      for (const order of ['patch-after-base', 'patch-before-base', 'inline-width-500']) {
      const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      page.on('request', () => { report.httpRequests++; });
      await page.route('**/*', route => route.abort());
      if (mobile && !english) {
        await page.setContent(fixture(oldCss, false));
        const oldBox = await page.locator('.ibiz-user-message-popover').boundingBox();
        assert.ok(oldBox.x < 0 && oldBox.width > viewport.width, 'The actual old SCSS must reproduce the known overflow');
        report.baselineReproducedOverflow = true;
      }
      const css = order === 'patch-before-base' ? `${newCss}\n${oldCss}` : `${oldCss}\n${newCss}`;
      await page.setContent(fixture(css, english, order === 'inline-width-500'));
      const popup = await page.locator('.ibiz-user-message-popover').boundingBox();
      assert.ok(popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= viewport.width &&
        popup.y + popup.height <= viewport.height, 'The complete popup must fit inside the viewport');
      const expand = page.locator('.ibiz-internal-message-group__action--item');
      await expand.scrollIntoViewIfNeeded();
      assert.equal(await expand.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      }), true, 'Template HTML cannot intercept the expand icon');
      await expand.click({ timeout: 2000 });
      const leaf = page.locator('.ibiz-internal-message-container');
      if (!mobile) await leaf.hover();
      const read = page.locator('.ibiz-internal-message-container-toolbar__button');
      await read.scrollIntoViewIfNeeded();
      assert.equal(await read.isVisible(), true, 'Touch devices must expose the ordinary leaf read control');
      assert.equal(await read.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      }), true);
      await read.click({ timeout: 2000 });
      const label = `${english ? 'en' : 'zh'}-${mobile ? 'mobile' : 'desktop'}-${order}`;
      await page.screenshot({ path: path.join(artifact, `${label}.png`), fullPage: true });
      report.cells.push({ label, order, viewport, popup, expandHitTarget: true, leafReadHitTarget: true, forcedClick: false });
      await context.close();
      }
    }
  }
  assert.equal(report.httpRequests, 0);
  assert.equal(report.cells.length, 12);
  fs.writeFileSync(path.join(artifact, 'report.private.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(artifact, 'candidate.private.css'), newCss, { flag: 'wx', mode: 0o600 });
});
