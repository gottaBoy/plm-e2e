import { expect, test, type Page } from '@playwright/test';
import { gotoApp, menus, openMenu } from './helpers';

// Clicks every tree node and every tab each first-level menu exposes, so a
// broken secondary feature cannot hide behind the twelve top-level checks in
// navigation.spec.ts.

const SETTLE_MS = 2_500;
const MAX_ITEMS = 16;

type Finding = { item: string; kind: string; detail: string };

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', 'Deep sweep is desktop-only by design');
  test.setTimeout(600_000);
});

function watch(page: Page) {
  const failures: Finding[] = [];
  const notes: Finding[] = [];
  page.on('pageerror', error =>
    failures.push({ item: '', kind: 'pageerror', detail: String(error).slice(0, 200) }));
  page.on('response', response => {
    if (response.status() >= 500)
      failures.push({ item: '', kind: `http ${response.status()}`, detail: response.url().slice(0, 160) });
  });
  // A failed sub-resource already shows up as an HTTP status, so console noise
  // is reported without failing the sweep.
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource|Navigation aborted/.test(text)) return;
    notes.push({ item: '', kind: 'console', detail: text.slice(0, 200) });
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
  const text = await page.locator('body').innerText().catch(() => '');
  if (text.trim().length <= 2) failures.push({ item, kind: 'empty-render', detail: '' });
}

for (const menu of menus) {
  test(`${menu} every tree node and tab renders @deep-sweep`, async ({ page }) => {
    await gotoApp(page);
    await openMenu(page, menu);
    const { failures, notes } = watch(page);
    const visited: string[] = [];

    const treeNodes = page.locator('.el-tree-node__content:visible');
    for (let index = 0; index < Math.min(await treeNodes.count(), MAX_ITEMS); index += 1) {
      const node = treeNodes.nth(index);
      if (!(await node.isVisible().catch(() => false))) continue;
      const label = (await node.innerText().catch(() => '')).trim();
      if (!label || visited.includes(label)) continue;
      visited.push(label);
      const from = { failures: failures.length, notes: notes.length };
      await node.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(SETTLE_MS);
      await drain(failures, notes, `${menu}/${label}`, from, page);
    }

    const tabs = page.locator('[role="tab"]:visible');
    const tabLabels = (await tabs.allInnerTexts())
      .map(label => label.trim())
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    for (const label of tabLabels) {
      const from = { failures: failures.length, notes: notes.length };
      await tabs.filter({ hasText: label }).first().click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(SETTLE_MS);
      await drain(failures, notes, `${menu}/tab ${label}`, from, page);
    }

    // One run enumerates the whole surface, so assert at the end rather than at
    // the first breakage.
    test.info().annotations.push({
      type: 'sweep',
      description:
        `${menu}: ${visited.length} nodes [${visited.join(', ')}]; ${tabLabels.length} tabs ` +
        `[${tabLabels.join(', ')}]; ${notes.length} console note(s)` +
        (notes.length ? ` [${notes.map(n => `${n.item || menu}<${n.kind}> ${n.detail}`).join(' || ')}]` : ''),
    });
    expect(
      failures,
      `${menu}: ${failures.length} failure(s) across ${visited.length} nodes and ${tabLabels.length} tabs\n` +
        failures.slice(0, 15).map(f => `  ${f.item || menu}: [${f.kind}] ${f.detail}`).join('\n'),
    ).toEqual([]);
  });
}
