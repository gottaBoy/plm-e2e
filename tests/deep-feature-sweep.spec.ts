import { expect, test, type Page } from '@playwright/test';
import { clickTab, gotoApp, menus, openMenu } from './helpers';

// Clicks every tree node and every tab each first-level menu exposes, so a
// broken secondary feature cannot hide behind the twelve top-level checks in
// navigation.spec.ts.

const SETTLE_MS = 2_500;

type Finding = { item: string; kind: string; detail: string };

function errorDetail(error: unknown) {
  return String(error).slice(0, 200);
}

test.beforeEach(() => {
  test.setTimeout(600_000);
});

function watch(page: Page) {
  const failures: Finding[] = [];
  const notes: Finding[] = [];
  page.on('pageerror', error =>
    failures.push({ item: '', kind: 'pageerror', detail: String(error).slice(0, 200) }));
  page.on('response', response => {
    if (response.status() >= 400)
      failures.push({ item: '', kind: `http ${response.status()}`, detail: response.url().slice(0, 160) });
  });
  page.on('requestfailed', request =>
    failures.push({ item: '', kind: 'requestfailed', detail: `${request.url()} ${request.failure()?.errorText}` }));
  // Console errors are runtime failures. Keep them attached to the triggering
  // item so the sweep identifies the broken feature instead of hiding it as
  // diagnostic noise.
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    failures.push({ item: '', kind: 'console', detail: text.slice(0, 200) });
  });
  return { failures, notes };
}

// Attribute everything reported since `from` to the item that caused it, and
// treat a blank page as a failure, since a dead view is otherwise
// indistinguishable from a click that did nothing.
async function drain(
  failures: Finding[],
  notes: Finding[],
  item: string,
  from: { failures: number; notes: number },
  page: Page,
) {
  for (const failure of failures.slice(from.failures)) failure.item = item;
  for (const note of notes.slice(from.notes)) note.item = item;
  let text = '';
  try {
    text = await page.locator('body').innerText();
  } catch (error) {
    failures.push({ item, kind: 'inspection', detail: errorDetail(error) });
    return;
  }
  if (text.trim().length <= 2) failures.push({ item, kind: 'empty-render', detail: '' });
}

for (const menu of menus) {
  test(`${menu} every tree node and tab renders @deep-sweep`, async ({ page }) => {
    const { failures, notes } = watch(page);
    await gotoApp(page);
    await openMenu(page, menu);
    const visited: string[] = [];

    const treeNodes = page.locator('.el-tree-node__content:visible');
    for (let index = 0; index < await treeNodes.count(); index += 1) {
      const node = treeNodes.nth(index);
      const nodeItem = `${menu}/tree node #${index + 1}`;
      let visible;
      try {
        visible = await node.isVisible();
      } catch (error) {
        failures.push({ item: nodeItem, kind: 'inspection', detail: errorDetail(error) });
        continue;
      }
      if (!visible) continue;
      let label;
      try {
        label = (await node.innerText()).trim();
      } catch (error) {
        failures.push({ item: nodeItem, kind: 'inspection', detail: errorDetail(error) });
        continue;
      }
      if (!label || visited.includes(label)) continue;
      visited.push(label);
      const from = { failures: failures.length, notes: notes.length };
      try {
        await node.click({ timeout: 10_000 });
      } catch (error) {
        failures.push({ item: `${menu}/${label}`, kind: 'interaction', detail: errorDetail(error) });
      }
      await page.waitForTimeout(SETTLE_MS);
      await drain(failures, notes, `${menu}/${label}`, from, page);
    }

    // A tab click can navigate to a view with a different tab set. Preserve
    // the view that exposed the tab list so each captured tab is tested from
    // the same state instead of querying a live locator after navigation.
    const tabViewUrl = page.url();
    const tabs = page.locator('[role="tab"]:visible');
    const tabLabels = (await tabs.allInnerTexts())
      .map(label => label.trim())
      .filter(Boolean);
    for (const [index, label] of tabLabels.entries()) {
      if (index > 0) {
        await page.goto(tabViewUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(SETTLE_MS);
      }
      const from = { failures: failures.length, notes: notes.length };
      try {
        await clickTab(page.getByRole('tab', { name: label, exact: true }).first());
      } catch (error) {
        failures.push({ item: `${menu}/tab ${label}`, kind: 'interaction', detail: errorDetail(error) });
      }
      await page.waitForTimeout(SETTLE_MS);
      await drain(failures, notes, `${menu}/tab ${label}`, from, page);
    }

    // One run enumerates the whole surface, so assert at the end rather than at
    // the first breakage.
    test.info().annotations.push({
      type: 'sweep',
      description:
        `${menu}: ${visited.length} nodes [${visited.join(', ')}]; ${tabLabels.length} tabs ` +
        `[${tabLabels.join(', ')}]; ${failures.filter(f => f.kind === 'console').length} console error(s)` +
        (failures.some(f => f.kind === 'console')
          ? ` [${failures.filter(f => f.kind === 'console').map(n => `${n.item || menu}<${n.kind}> ${n.detail}`).join(' || ')}]`
          : ''),
    });
    await test.info().attach('sweep-evidence', {
      body: Buffer.from(JSON.stringify({
        baseUrl: test.info().project.use.baseURL,
        distRoot: process.env.PLM_E2E_DIST_ROOT,
        fixtureAcceptance: false, nativeAcceptance: false,
        scope: 'currently visible tree nodes and captured tabs, not complete CRUD/action coverage',
        menu, visited, tabLabels, failures, notes, lastUrl: page.url(),
      }, null, 2)),
      contentType: 'application/json',
    });
    expect(
      failures,
      `${menu}: ${failures.length} failure(s) across ${visited.length} nodes and ${tabLabels.length} tabs\n` +
        failures.slice(0, 15).map(f => `  ${f.item || menu}: [${f.kind}] ${f.detail}`).join('\n'),
    ).toEqual([]);
  });
}
