import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test';

const workspace = path.resolve(__dirname, '../..');
const entry = 'http://127.0.0.1:30250/ibizplm-plmweb/';
const origin = new URL(entry).origin;
const api = '/api/ibizplm__plmweb';
const themes = `${api}/extension/app_view_themes`;
const viewTag = 'idea_all_grid_view';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const privateRead = (filename: string) => {
  assert.ok(path.isAbsolute(filename));
  const child = path.relative(path.join(workspace, '.artifacts'), filename);
  assert.ok(child && !child.startsWith('..') && !path.isAbsolute(child));
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(descriptor);
    assert.ok(info.isFile() && info.uid === process.geteuid() && (info.mode & 0o077) === 0);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
};
const redact = (value: unknown) => String(value)
  .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
  .replace(/(refresh_token\/)[^/"'\s?]+/gi, '$1[redacted]');

export type Theme = {
  id: string; name: string; caption: string; owner_type: string;
  system_tag: string; app_view_tag: string; app_tag?: string; create_man?: string;
  theme_model?: string; valid_flag?: number;
};

export function stateProduct(rows: any[], productId: string) {
  const matches = rows.filter(row => row.id === productId);
  assert.equal(matches.length, 1, 'The real product directory must expose the configured own product');
  assert.ok(typeof matches[0].name === 'string' && matches[0].name.length > 0);
  return matches[0];
}

export function validateOwnedViewTheme(record: Theme, actor: Record<string, any>,
  marker: string, expectedId?: string, requireCreator = true): Theme {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record));
  assert.match(record.id ?? '', /^[A-Za-z0-9_-]{1,100}$/);
  assert.equal(record.name, `${viewTag}___${marker}`);
  assert.equal(record.caption, marker);
  assert.equal(record.owner_type, 'PERSONAL');
  assert.equal(record.app_view_tag, viewTag);
  assert.ok(actor.srfdcsystemid && actor.srfuserid);
  assert.equal(record.system_tag, actor.srfdcsystemid);
  if (requireCreator || record.create_man !== undefined) assert.equal(record.create_man, actor.srfuserid);
  if (expectedId) assert.equal(record.id, expectedId);
  return record;
}

export function decodeViewThemeResponse(method: string, text: string): unknown {
  if (method === 'DELETE' && text.length === 0) return null;
  assert.ok(text.trim().length > 0, 'A view theme read or save must return its actual JSON payload');
  return JSON.parse(text);
}

type DirectoryReceipt = { sequence: number; rows: Theme[] };
export class ViewThemeDirectoryGate {
  private sequence = 0;
  private requests = new WeakMap<object, { page: object; sequence: number }>();
  private receipts = new WeakMap<object, DirectoryReceipt>();
  private failures = new WeakMap<object, Error>();
  private waiters = new Set<{ page: object; after: number;
    resolve(value: DirectoryReceipt): void; reject(error: Error): void }>();

  mark(): number { return this.sequence; }

  observeRequest(request: object, page: object, path: string, method: string,
    authenticated: boolean, requestData: any): boolean {
    if (path !== `${themes}/fetch_cur_user_all` || method !== 'POST' || !authenticated) return false;
    const conditions = requestData?.searchconds;
    if (!Array.isArray(conditions) || !conditions.some(condition =>
      condition.condop === 'EQ' && condition.condtype === 'DEFIELD'
      && condition.fieldname === 'app_view_tag' && condition.value === viewTag)) return false;
    this.requests.set(request, { page, sequence: ++this.sequence });
    return true;
  }

  publish(request: object, rows: unknown): boolean {
    const observed = this.requests.get(request);
    if (!observed) return false;
    const { page } = observed;
    assert.ok(Array.isArray(rows), 'The actual current-view directory response must be a JSON array');
    for (const row of rows) {
      assert.ok(row && typeof row === 'object');
      assert.equal(row.app_view_tag, viewTag, 'A foreign view cannot satisfy the directory gate');
    }
    const receipt = { sequence: observed.sequence, rows: rows as Theme[] };
    if (!this.receipts.has(page) || this.receipts.get(page)!.sequence < receipt.sequence) {
      this.receipts.set(page, receipt);
    }
    for (const waiter of this.waiters) {
      if (waiter.page === page && receipt.sequence > waiter.after) waiter.resolve(receipt);
    }
    return true;
  }

  fail(page: object, error: Error): void {
    this.failures.set(page, error);
    for (const waiter of this.waiters) if (waiter.page === page) waiter.reject(error);
  }

  wait(page: object, after = 0, timeout = 15000): Promise<DirectoryReceipt> {
    const failed = this.failures.get(page);
    if (failed) return Promise.reject(failed);
    const previous = this.receipts.get(page);
    if (previous && previous.sequence > after) return Promise.resolve(previous);
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const waiter = { page, after,
        resolve: (value: DirectoryReceipt) => { clearTimeout(timer); this.waiters.delete(waiter); resolve(value); },
        reject: (error: Error) => { clearTimeout(timer); this.waiters.delete(waiter); reject(error); } };
      timer = setTimeout(() => waiter.reject(new Error(
        'The exact page/view theme HTTP response was not parsed before the directory deadline')), timeout);
      this.waiters.add(waiter);
    });
  }
}

function baseline() {
  const filename = process.env.PLM_CURRENT_VIEW_THEMES_BASELINE ||
    path.join(workspace, '.artifacts/plm-app-view-themes-readonly-20261123-r2/report.private.json');
  const bytes = privateRead(filename);
  const report = JSON.parse(bytes.toString());
  assert.equal(report.status, 'completed-readonly-native-theme-diagnostic-not-capability-acceptance');
  assert.equal(report.comparison.proxyEmptySuccessStub, false);
  assert.equal(report.comparison.anonymousFrontendStatus, 401);
  assert.equal(report.comparison.nativeAuthenticatedStatus, 200);
  assert.equal(report.storage.textColumnsSupplementaryPlaneReady, true);
  assert.equal(report.source.view.viewTag, viewTag);
  assert.equal(report.scopedCounts.systemOwnedRows, 4);
  const index = report.requests.findIndex((item: any) => item.label === 'native-current-user-all');
  assert.ok(index >= 0);
  const responseBytes = privateRead(path.join(path.dirname(filename),
    `response-${String(index + 1).padStart(3, '0')}.private.json`));
  const response = JSON.parse(responseBytes.toString());
  assert.equal(response.status, 200);
  assert.equal(response.data.length, 4);
  const records: Theme[] = response.data;
  for (const record of records) {
    assert.equal(record.owner_type, 'SYSTEM');
    assert.equal(record.app_view_tag, viewTag);
    assert.ok(record.id && record.caption && record.name);
  }
  const previousContext = JSON.parse(privateRead(path.join(path.dirname(filename),
    'observed-context.private.json')).toString());
  return { path: filename, sha256: sha(bytes), records, context: previousContext,
    sourceBindings: report.source.sourceBindings };
}
function runtimeWitness() {
  const rows = JSON.parse(execFileSync('docker',
    ['inspect', 'plmweb', 'plmservice', 'ibiz-ebsx-allinone', 'ibizlab-uaa-api'],
    { encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }));
  return rows.map((row: any) => {
    assert.equal(row.State.Status, 'running');
    return { name: row.Name, id: row.Id, imageId: row.Image,
      startedAt: row.State.StartedAt, restartCount: row.RestartCount,
      configurationSha256: sha(JSON.stringify(row.Config)),
      mountsSha256: sha(JSON.stringify([...row.Mounts].sort((a: any, b: any) =>
        a.Destination.localeCompare(b.Destination)))) };
  }).sort((a: any, b: any) => a.name.localeCompare(b.name));
}
async function bounded<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Private browser evidence exceeded its collection budget')), timeout);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

test('current native view theme directory survives real UI refresh and a new login', async ({ browser }, testInfo) => {
  const expected = baseline();
  const credentialPath = process.env.PLM_CURRENT_VIEW_THEMES_CREDENTIALS ||
    path.join(workspace, '.artifacts/current-business-actors-20261122-r1/credentials.private.json');
  const credentials = JSON.parse(privateRead(credentialPath).toString());
  assert.ok(credentials.username && credentials.password);
  const english = testInfo.project.use.locale === 'en-US';
  const language = english ? 'en' : 'zh-CN';
  const touch = testInfo.project.use.hasTouch === true;
  const activate = (target: Locator) => touch ? target.tap() : target.click();
  const writeEnabled = process.env.PLM_CURRENT_VIEW_THEMES_WRITE === '1';
  if (writeEnabled) {
    assert.equal(process.env.PLM_CURRENT_VIEW_THEMES_WRITE_GATE,
      'native-route-and-exact-theme-table-utf8mb4-verified',
      'Write mode requires the explicit reviewed route and table migration gate');
  }
  const marker = `VT-${randomUUID().slice(0, 8)} 中文🙂 e\u0301 '" \\`;
  const report: any = {
    contract: 'current-owned-app-view-theme-browser-v1', status: 'FAILED',
    startedAt: new Date().toISOString(), project: testInfo.project.name, language,
    viewport: testInfo.project.use.viewport, writeEnabled, marker: writeEnabled ? marker : null,
    baseline: { path: expected.path, sha256: expected.sha256, existingSystemRecords: 4 },
    account: { usernameSha256: sha(credentials.username), declaredRole: credentials.declaredRole,
      roleMatrixAccepted: false, ordinaryUserAccepted: false },
    runtimeBefore: runtimeWitness(), sessions: [], stages: {}, consoleErrors: [], pageErrors: [],
    failedRequests: [], httpErrors: [], expectedPreAuthErrors: [], resourceBindings: [],
    captureErrors: [], themeRequests: [], themeResponses: [], mutations: [], applicationRequests: [],
    accessSideEffectsIndependentlyChecked: false, localizationFindings: [],
    cleanup: { status: 'not-required' }, fullF06Acceptance: false,
  };
  const sourcePaths = [path.relative(workspace, __filename),
    'plm-e2e/playwright.current-owned-app-view-themes.config.ts',
    'plm-web/src/publish/model/entities/product.ts',
    'plm-web/src/locale/en.json',
    'plm-web/src/locale/model-locale.ts',
    'ibiz-app-hub/packages/runtime/src/controller/control/search-bar/search-bar-group.util.ts',
    ...expected.sourceBindings.map((binding: any) => binding.path)];
  const syncDirectory = (filename: string) => {
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  };
  report.sourceBindings = [...new Set(sourcePaths)].map(filename => {
    const content = fs.readFileSync(path.join(workspace, filename));
    const snapshot = testInfo.outputPath('source', filename);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(snapshot, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    syncDirectory(path.dirname(snapshot));
    return { path: filename, sha256: sha(content), bytes: content.length,
      privateSnapshot: path.relative(testInfo.outputDir, snapshot) };
  });
  syncDirectory(testInfo.outputDir);
  let sequence = 0;
  const append = (stage: string, data: unknown) => {
    const descriptor = fs.openSync(testInfo.outputPath(
      `event-${String(++sequence).padStart(3, '0')}-${stage}.private.json`), 'wx', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify({ stage, data }, null, 2)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    syncDirectory(testInfo.outputDir);
  };
  type Session = {
    page: Page; context: BrowserContext; actor: Record<string, any>;
    productRows: any[];
    themeLists: Theme[][]; themeGets: Theme[]; directoryGate: ViewThemeDirectoryGate;
    drain(): Promise<void>; close(): Promise<void>;
  };
  const sessions: Session[] = [];
  let owned: Theme | undefined;
  let current: Session | undefined;
  let primaryFailure: unknown;
  let creationDispatched = false;
  let issuedOwnedId: string | undefined;
  let deletedOwnedId: string | undefined;
  let cleanupSession: Session | undefined;
  let savedThemeModel: Record<string, unknown> | undefined;
  let observedUrl: string | undefined;
  const validateOwnRecord = (record: Theme, actor: Record<string, any>, requireCreator = false) => {
    const verified = validateOwnedViewTheme(record, actor, marker, owned?.id ?? issuedOwnedId, requireCreator);
    issuedOwnedId = verified.id;
    return verified;
  };
  const createSession = async (browserInstance: Browser): Promise<Session> => {
    const context = await browserInstance.newContext({
      locale: english ? 'en-US' : 'zh-CN', viewport: testInfo.project.use.viewport as any,
      isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch,
      serviceWorkers: 'block', timezoneId: 'Asia/Shanghai',
    });
    await context.addInitScript(selected => {
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        localStorage.setItem('language', selected);
      }
    }, language);
    const page = await context.newPage();
    let phase = 'pre-auth';
    const pending = new Set<Promise<void>>();
    const state: Session = { page, context, actor: {}, themeLists: [], themeGets: [], productRows: [],
      directoryGate: new ViewThemeDirectoryGate(),
      async drain() {
        await bounded((async () => { while (pending.size) await Promise.all([...pending]); })(), 15000);
      },
      async close() {
        try { await state.drain(); } finally { await context.close(); }
        await state.drain();
      },
    };
    const track = (promise: Promise<void>) => {
      const work = promise.catch(error => report.captureErrors.push(redact(error.message)))
        .finally(() => pending.delete(work));
      pending.add(work);
    };
    const monitor = (observedPage: Page) => {
    observedPage.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push({ phase,
        message: redact(message.text()), path: new URL(message.location().url || entry).pathname });
    });
    observedPage.on('pageerror', error => report.pageErrors.push({ phase, message: redact(error.message) }));
    observedPage.on('requestfailed', request => report.failedRequests.push({
      phase, path: new URL(request.url()).pathname, method: request.method(),
      error: redact(request.failure()?.errorText),
    }));
    observedPage.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith(`${api}/`)) return;
      report.applicationRequests.push({ phase, method: request.method(), path: url.pathname,
        authenticated: Boolean(request.headers().authorization),
        themeResource: url.pathname.startsWith(themes) });
      if (!url.pathname.startsWith(themes)) return;
      const method = request.method();
      const data = request.postDataJSON();
      state.directoryGate.observeRequest(request, observedPage, url.pathname, method,
        Boolean(request.headers().authorization), data);
      const observation = { phase, method, path: url.pathname, body: data,
        authenticated: Boolean(request.headers().authorization) };
      report.themeRequests.push(observation);
      if (['PUT', 'PATCH', 'DELETE'].includes(method) ||
        method === 'POST' && url.pathname === themes) {
        report.mutations.push(observation);
        if (method === 'POST' && url.pathname === themes && data?.caption === marker) {
          creationDispatched = true;
          report.cleanup = { status: 'required-after-create-dispatch', marker };
        }
      }
    });
    observedPage.on('response', response => track((async () => {
      const url = new URL(response.url());
      if (url.origin !== origin) return;
      const request = response.request();
      const authenticated = Boolean(request.headers().authorization);
      if (response.status() >= 400) {
        const observation = { phase, path: url.pathname, status: response.status(),
          method: request.method(), authenticated };
        if (phase === 'pre-auth' && response.status() === 401 && !authenticated
          && [`${api}/appdata`, `${api}/uaa/getbydcsystem/ibizplm`].includes(url.pathname)) {
          report.expectedPreAuthErrors.push(observation);
        } else report.httpErrors.push(observation);
      }
      if (url.pathname === `${api}/appdata` && response.status() === 200 && authenticated) {
        const payload = await response.json();
        state.actor = payload.context;
      }
      if (response.status() === 200 && request.method() === 'POST'
        && new RegExp(`^${api}/products/fetch_[a-z_]+$`).test(url.pathname)) {
        const payload = await response.json();
        if (Array.isArray(payload)) state.productRows = payload;
      }
      if (url.pathname.startsWith(themes) && response.status() === 200) {
        try {
          const body = await response.text();
          const payload = decodeViewThemeResponse(request.method(), body);
          report.themeResponses.push({ path: url.pathname, method: request.method(), status: response.status(),
            bytes: Buffer.byteLength(body), sha256: sha(body),
            bodyKind: request.method() === 'DELETE' && body.length === 0 ? 'native-void-remove' : 'json' });
          if (state.directoryGate.publish(request, payload)) {
            state.themeLists.push(payload as Theme[]);
          } else if (request.method() === 'GET') state.themeGets.push(payload as Theme);
        } catch (error) {
          if (url.pathname === `${themes}/fetch_cur_user_all`) {
            state.directoryGate.fail(observedPage, error as Error);
          }
          throw error;
        }
      } else if (url.pathname === `${themes}/fetch_cur_user_all` && response.status() >= 400) {
        state.directoryGate.fail(observedPage, new Error(
          `The native current-view directory returned HTTP ${response.status()}`));
      }
      if (response.status() === 200 && ['document', 'script', 'stylesheet'].includes(request.resourceType())) {
        let body: Buffer;
        let source = 'observed-browser-response';
        try { body = await bounded(response.body(), 5000); }
        catch {
          const etag = response.headers().etag;
          assert.ok(etag && request.method() === 'GET',
            'An unavailable browser resource needs a matching conditional readback');
          const readback = await context.request.get(url.href,
            { headers: { 'If-Match': etag }, timeout: 10000 });
          assert.equal(readback.status(), 200);
          assert.equal(readback.headers().etag, etag);
          body = await readback.body();
          source = 'same-etag-conditional-readback';
        }
        report.resourceBindings.push({ path: url.pathname, source, bytes: body.length, sha256: sha(body) });
      }
    })()));
    };
    monitor(page);
    context.on('page', observedPage => {
      if (observedPage !== page) monitor(observedPage);
    });
    sessions.push(state);
    await page.goto(entry, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await state.drain();
    await page.locator('input[type="text"]').first().fill(credentials.username);
    await page.locator('input[type="password"]').first().fill(credentials.password);
    phase = 'login-submitted';
    const [login] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === `${api}/v7/login`
        && response.request().method() === 'POST'),
      page.getByRole('button', { name: /^(?:登录|登陆|Log\s?in|Sign\s?in)$/i }).first().click(),
    ]);
    expect(login.status()).toBe(200);
    await expect(page.locator('.ibiz-control-appmenu-plm_menu')).toBeVisible();
    await state.drain();
    if (credentials.userId && credentials.personId) {
      assert.equal(state.actor.srfuserid, credentials.userId);
      assert.equal(state.actor.srfpersonid, credentials.personId);
      assert.ok(state.actor.srforgid, 'Normal organization selection must yield a real organization');
      for (const field of ['srfsystemid', 'srfdcsystemid']) {
        assert.equal(state.actor[field], expected.context[field]);
      }
    } else {
      for (const field of ['srfuserid', 'srforgid', 'srfsystemid', 'srfdcsystemid']) {
        assert.equal(state.actor[field], expected.context[field], 'The normal UI actor differs from the read-only baseline');
      }
    }
    phase = 'authenticated';
    report.sessions.push({ normalUILogin: true, tokenInjected: false, language,
      contextSha256: sha(JSON.stringify(state.actor)), independentlyCreated: true });
    return state;
  };
  const themeView = (session: Session) => session.page.locator('.ibiz-view--idea_all_grid_view:visible')
    .filter({ has: session.page.locator('.ibiz-search-groups') }).last();
  const waitDirectory = async (session: Session, after = 0) => {
    await expect(themeView(session)).toBeVisible();
    const receipt = await session.directoryGate.wait(session.page, after);
    await session.drain();
    return receipt.rows;
  };
  const openExistingIdeaView = async (session: Session) => {
    let page = session.page;
    const menu = page.locator('.ibiz-control-appmenu-plm_menu');
    if (await menu.evaluate(element => element.classList.contains('is-collapse'))) {
      await activate(menu.locator('.ibiz-control-appmenu-collapse-icon'));
    }
    await activate(menu.locator('.el-menu-item').filter({
      hasText: english ? /^Products$/ : /^产品管理$/,
    }));
    const productTree = page.locator('.ibiz-view--product_tree_exp_view');
    await expect(productTree).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) < 768) {
      await activate(menu.locator('.ibiz-control-appmenu-collapse-icon'));
      await expect(menu).toHaveClass(/\bis-collapse\b/);
    }
    await activate(productTree.getByText(english ? 'All Products' : '全部产品', { exact: true }).first());
    const products = page.locator('.ibiz-view--product_all_grid_view:visible');
    await expect(products).toBeVisible();
    if (credentials.productId) {
      await expect.poll(() => session.productRows.filter(row => row.id === credentials.productId).length,
        { message: 'The normally authorized role must see its own fixture product' }).toBe(1);
    }
    await session.drain();
    const ownProduct = credentials.productId
      ? stateProduct(session.productRows, credentials.productId) : undefined;
    const firstProduct = ownProduct ? products.locator('.el-table__row').filter({ hasText: ownProduct.name })
      : products.locator('.el-table__row').first();
    await expect(firstProduct, 'An existing real accessible product must be visible').toBeVisible();
    if (touch) {
      await firstProduct.tap();
    } else {
      await firstProduct.hover();
      const [popup] = await Promise.all([
        page.waitForEvent('popup', { timeout: 15000 }),
        activate(firstProduct.getByRole('button', {
          name: english ? 'Open in New Window' : '新窗口打开', exact: true,
        })),
      ]);
      session.page = popup;
    }
    page = session.page;
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.ibiz-view--product_index_view:visible')).toBeVisible();
    const popupMenu = page.locator('.ibiz-control-appmenu-plm_menu');
    if (touch && !await popupMenu.evaluate(element => element.classList.contains('is-collapse'))) {
      await activate(popupMenu.locator('.ibiz-control-appmenu-collapse-icon'));
      await expect(popupMenu).toHaveClass(/\bis-collapse\b/);
    }
    const requirements = page.locator('.ibiz-view--product_index_view:visible')
      .locator('[role="tab"][id="tab-usrdrgroup1228809432"]');
    await expect(requirements).toBeVisible();
    if ((await requirements.getAttribute('aria-selected')) !== 'true') await activate(requirements);
    await waitDirectory(session);
  };
  const directory = async (session: Session, stage: string, after = 0) => {
    const { page } = session;
    const view = themeView(session);
    const list = await waitDirectory(session, after);
    const systemRecords = list.filter(row => row.owner_type === 'SYSTEM');
    expect(systemRecords.map(row => row.id).sort()).toEqual(expected.records.map(row => row.id).sort());
    for (const record of systemRecords) {
      expect(record.app_view_tag).toBe(viewTag);
      expect(record.system_tag).toBe(session.actor.srfdcsystemid);
    }
    const groups = view.locator('.ibiz-search-groups');
    await expect(groups).toBeVisible();
    await activate(groups.locator('.ibiz-search-groups__more,.ibiz-search-groups-more').first());
    const manageText = english ? 'Group manage' : '分组管理';
    await activate(page.locator('.el-dropdown-menu:visible').getByText(manageText, { exact: true }));
    const dialog = page.locator('.ibiz-search-groups__manage-dialog:visible,.ibiz-search-groups-manage-dialog:visible');
    await expect(dialog).toBeVisible();
    const rendered = [];
    const englishLabels = JSON.parse(fs.readFileSync(path.join(workspace, 'plm-web/src/locale/en.json'), 'utf8'));
    for (const record of expected.records) {
      const persisted = systemRecords.find(row => row.id === record.id)!;
      expect(persisted.caption).toBe(record.caption);
      const displayedCaption = english ? englishLabels[record.caption] : record.caption;
      expect(displayedCaption, 'A system model caption needs an explicit English dictionary entry').toBeTruthy();
      const item = dialog.locator('.ibiz-search-groups__table-row,.ibiz-search-groups-table-row')
        .filter({ hasText: displayedCaption });
      await expect(item).toHaveCount(1);
      await item.scrollIntoViewIfNeeded();
      await expect(item).toBeVisible();
      rendered.push({ id: record.id, persistedCaption: record.caption, displayedCaption, name: record.name });
      if (english && /[\u3400-\u9fff]/u.test(displayedCaption)) {
        report.localizationFindings.push({ stage, kind: 'system-caption-remains-chinese-in-English',
          id: record.id, captionSha256: sha(record.caption) });
      }
    }
    report.stages[stage] = { status: 'PASS-readonly-directory', renderedSystemRecords: rendered,
      directoryRequestObserved: true, userRecords: list.filter(row => row.owner_type === 'PERSONAL').length };
    await page.screenshot({ path: testInfo.outputPath(`${stage}.png`), fullPage: true });
    await activate(dialog.locator('.el-dialog__headerbtn'));
  };
  const selectOwnedGroup = async (session: Session) => {
    assert.ok(owned);
    const groups = themeView(session).locator('.ibiz-search-groups');
    const shown = groups.locator('.ibiz-search-groups__quick-group-item,.ibiz-search-groups-quick-group-item')
      .filter({ hasText: marker });
    const [response] = await Promise.all([
      session.page.waitForResponse(result => result.request().method() === 'GET'
        && new URL(result.url()).pathname === `${themes}/${owned!.id}`),
      (async () => {
        if (await shown.isVisible()) await shown.click();
        else {
          await groups.locator('.ibiz-search-groups__more,.ibiz-search-groups-more').first().click();
          await session.page.locator('.el-dropdown-menu:visible').getByText(marker, { exact: true }).click();
        }
      })(),
    ]);
    expect(response.status()).toBe(200);
    const fetched = await response.json();
    await session.drain();
    return validateOwnRecord(fetched, session.actor, true);
  };
  const removeOwnedGroup = async (session: Session) => {
    assert.ok(owned);
    const verified = await selectOwnedGroup(session);
    const exactId = verified.id;
    append('exact-owned-full-record-before-delete', verified);
    await directory(session, `before-own-delete-${sequence}`);
    const groups = themeView(session).locator('.ibiz-search-groups');
    await groups.locator('.ibiz-search-groups__more,.ibiz-search-groups-more').first().click();
    await session.page.locator('.el-dropdown-menu:visible')
      .getByText(english ? 'Group manage' : '分组管理', { exact: true }).click();
    const dialog = session.page.locator('.ibiz-search-groups__manage-dialog:visible,.ibiz-search-groups-manage-dialog:visible');
    const item = dialog.locator('.ibiz-search-groups__table-row,.ibiz-search-groups-table-row')
      .filter({ hasText: marker });
    await expect(item).toHaveCount(1);
    const afterDelete = session.directoryGate.mark();
    append('before-exact-owned-delete', { id: owned.id, marker });
    await item.getByText(english ? 'Delete' : '删除', { exact: true }).click();
    const [removed] = await Promise.all([
      session.page.waitForResponse(response => response.request().method() === 'DELETE'
        && new URL(response.url()).pathname === `${themes}/${exactId}`),
      session.page.locator('.el-message-box:visible')
        .getByRole('button', { name: english ? /^Determine$/ : /^确定$/ }).click(),
    ]);
    expect(removed.status()).toBe(200);
    deletedOwnedId = exactId;
    owned = undefined;
    report.cleanup = { status: 'native-owned-delete-observed-independent-absence-pending', id: exactId };
    const refreshed = await waitDirectory(session, afterDelete);
    expect(refreshed.some(record => record.id === exactId || record.caption === marker)).toBe(false);
    if (await dialog.isVisible()) await dialog.locator('.el-dialog__headerbtn').click();
    const afterRefresh = session.directoryGate.mark();
    await session.page.reload({ waitUntil: 'domcontentloaded' });
    const readback = await waitDirectory(session, afterRefresh);
    expect(readback.some(record => record.id === exactId || record.caption === marker
      || record.name === `${viewTag}___${marker}`)).toBe(false);
    report.cleanup = { status: 'PASS-native-ui-exact-owned-delete-and-refreshed-directory-absence',
      id: exactId, nativeResponseObserved: true, independentPageRefreshObserved: true };
  };
  try {
    current = await createSession(browser);
    cleanupSession = current;
    await openExistingIdeaView(current);
    await directory(current, 'initial-system-directory');
    observedUrl = current.page.url();
    const beforeRefresh = current.directoryGate.mark();
    await current.page.reload({ waitUntil: 'domcontentloaded' });
    await directory(current, 'refresh-system-directory', beforeRefresh);
    if (writeEnabled) {
      const groups = themeView(current).locator('.ibiz-search-groups');
      expect((await waitDirectory(current)).some(record => record.caption === marker ||
        record.name === `${viewTag}___${marker}`)).toBe(false);
      await groups.locator('.ibiz-search-groups__more,.ibiz-search-groups-more').first().click();
      await current.page.locator('.el-dropdown-menu:visible')
        .getByText(english ? 'New group' : '新建分组', { exact: true }).click();
      const dialog = current.page.locator('.ibiz-search-groups__new-dialog:visible,.ibiz-search-groups-new-dialog:visible');
      await expect(dialog).toBeVisible();
      await dialog.locator('input').fill(marker);
      const beforeCreate = current.directoryGate.mark();
      append('before-owned-ui-create', { marker, expectedView: viewTag, expectedOwner: 'PERSONAL' });
      const [response] = await Promise.all([
        current.page.waitForResponse(result =>
          result.request().method() === 'POST' && new URL(result.url()).pathname === themes),
        dialog.getByRole('button', { name: english ? /^Determine$/ : /^确\s*定$/ }).click(),
      ]);
      const payload = await response.json();
      append('owned-create-response', { status: response.status(), payload });
      if (payload?.caption === marker && payload?.owner_type === 'PERSONAL') {
        owned = validateOwnRecord(payload, current.actor);
      }
      expect(response.status()).toBe(200);
      assert.ok(owned, 'The normal create response must identify the exact owned personal record');
      append('owned-ui-created', owned);
      await waitDirectory(current, beforeCreate);
      await selectOwnedGroup(current);
      append('before-owned-ui-save', { id: owned.id, marker });
      const [responseSaved] = await Promise.all([
        current.page.waitForResponse(response => response.request().method() === 'PUT'
          && new URL(response.url()).pathname === `${themes}/${owned!.id}`),
        themeView(current).getByRole('button', {
          name: english ? 'Save group' : '保存分组', exact: true,
        }).click(),
      ]);
      expect(responseSaved.status()).toBe(200);
      const saveRecord = validateOwnRecord(await responseSaved.json(), current.actor);
      assert.ok(typeof saveRecord.theme_model === 'string');
      savedThemeModel = JSON.parse(saveRecord.theme_model);
      expect(savedThemeModel).toHaveProperty('columnstates');
      append('owned-normal-ui-save-readback', saveRecord);
      report.stages.ownedGroupSaved = { status: 'PASS-normal-ui', id: owned.id };
      const beforeOwnedRefresh = current.directoryGate.mark();
      await current.page.reload({ waitUntil: 'domcontentloaded' });
      await waitDirectory(current, beforeOwnedRefresh);
      const recordAfterRefresh = await selectOwnedGroup(current);
      expect(JSON.parse(recordAfterRefresh.theme_model!)).toEqual(savedThemeModel);
      report.stages.ownedRefreshReadback = { status: 'PASS-normal-ui-native-get', id: owned.id };
    }
    const fresh = await createSession(browser);
    cleanupSession = fresh;
    const beforeFreshNavigation = fresh.directoryGate.mark();
    await fresh.page.goto(observedUrl, { waitUntil: 'domcontentloaded' });
    await directory(fresh, 'new-login-system-directory', beforeFreshNavigation);
    if (owned) {
      const record = await selectOwnedGroup(fresh);
      expect(typeof record.theme_model).toBe('string');
      const saved = JSON.parse(record.theme_model!);
      expect(saved).toEqual(savedThemeModel);
      report.stages.newLoginOwnedGroup = { status: 'PASS-normal-ui-and-native-get', id: owned.id };
      await removeOwnedGroup(fresh);
      owned = undefined;
    }
    await current.drain();
    if (!writeEnabled) expect(report.mutations).toEqual([]);
    for (const mutation of report.mutations) {
      if (mutation.method === 'POST') {
        expect(mutation.path).toBe(themes);
        expect(mutation.body.name).toBe(`${viewTag}___${marker}`);
        expect(mutation.body.caption).toBe(marker);
      } else {
        expect(mutation.path).toBe(`${themes}/${issuedOwnedId}`);
        expect(['PUT', 'DELETE']).toContain(mutation.method);
      }
    }
    expect(report.pageErrors).toEqual([]);
    expect(report.failedRequests).toEqual([]);
    expect(report.httpErrors).toEqual([]);
    expect(report.captureErrors).toEqual([]);
    const expectedConsole = report.consoleErrors.filter((item: any) => item.phase === 'pre-auth'
      && /^Failed to load resource: the server responded with a status of 401(?:\s|\(|$)/.test(item.message)
      && report.expectedPreAuthErrors.some((response: any) => response.path === item.path));
    report.expectedPreAuthConsoleErrors = expectedConsole;
    expect(report.consoleErrors.filter((item: any) => !expectedConsole.includes(item))).toEqual([]);
    expect(report.localizationFindings,
      'System supplied search group captions must be localized; persistent personal content remains verbatim').toEqual([]);
    report.status = writeEnabled ? 'PASS-normal-ui-owned-theme-lifecycle' : 'PASS-readonly-system-directory';
  } catch (error) {
    primaryFailure = error;
    report.error = redact((error as Error).message);
  } finally {
    if (creationDispatched && !owned && !deletedOwnedId && cleanupSession && report.cleanup.status !==
      'PASS-native-ui-exact-owned-delete-and-refreshed-directory-absence') {
      try {
        // A failing response can follow persistence. Refresh normally before deciding cleanup.
        const beforeRecovery = cleanupSession.directoryGate.mark();
        await cleanupSession.page.reload({ waitUntil: 'domcontentloaded' });
        const records = await waitDirectory(cleanupSession, beforeRecovery);
        const matches = records.filter(record =>
          record.caption === marker || record.name === `${viewTag}___${marker}`);
        append('failed-create-normal-ui-readback', matches);
        if (matches.length === 1) {
          owned = validateOwnRecord(matches[0], cleanupSession.actor);
          await selectOwnedGroup(cleanupSession);
          report.cleanup.recoveredExactPersistedOwnRecord = true;
        } else {
          report.cleanup.status = matches.length === 0 ? 'no-owned-row-observed-after-normal-ui-refresh'
            : 'blocked-ambiguous-owned-marker-readback';
          report.cleanup.persistenceAfterFailedCreateUncertain = true;
        }
      } catch (error) {
        report.cleanup.readbackError = redact((error as Error).message);
        report.cleanup.persistenceAfterFailedCreateUncertain = true;
      }
    }
    if (owned && cleanupSession) {
      try { await removeOwnedGroup(cleanupSession); owned = undefined; }
      catch (error) { report.cleanup.error = redact((error as Error).message); }
    }
    if (deletedOwnedId && cleanupSession && report.cleanup.status !==
      'PASS-native-ui-exact-owned-delete-and-refreshed-directory-absence') {
      try {
        const after = cleanupSession.directoryGate.mark();
        await cleanupSession.page.reload({ waitUntil: 'domcontentloaded' });
        const records = await waitDirectory(cleanupSession, after);
        expect(records.some(record => record.id === deletedOwnedId ||
          record.caption === marker || record.name === `${viewTag}___${marker}`)).toBe(false);
        report.cleanup = { status: 'PASS-native-ui-exact-owned-delete-and-refreshed-directory-absence',
          id: deletedOwnedId, nativeResponseObserved: true, independentPageRefreshObserved: true,
          recoveredAfterObservedDelete: true };
      } catch (error) { report.cleanup.error = redact((error as Error).message); }
    }
    for (const session of sessions) {
      try { await session.close(); } catch (error) { report.captureErrors.push(redact((error as Error).message)); }
    }
    report.runtimeAfter = runtimeWitness();
    try { assert.deepEqual(report.runtimeAfter, report.runtimeBefore); report.runtimeUnchanged = true; }
    catch (error) { primaryFailure ??= error; report.runtimeUnchanged = false; }
    report.finishedAt = new Date().toISOString();
    if (report.captureErrors.length > 0) {
      primaryFailure ??= new Error('Private browser evidence callbacks failed');
      report.status = 'FAILED';
    }
    if (creationDispatched && report.cleanup.status !==
      'PASS-native-ui-exact-owned-delete-and-refreshed-directory-absence') {
      primaryFailure ??= new Error('The exact personal view theme cleanup remains unresolved');
      report.status = 'FAILED';
    }
    const filename = testInfo.outputPath('view-theme-evidence.private.json');
    const descriptor = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, JSON.stringify(report, null, 2)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    syncDirectory(testInfo.outputDir);
  }
  if (primaryFailure) throw primaryFailure;
});
