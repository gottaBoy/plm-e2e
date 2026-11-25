import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { URL } from 'node:url';
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

export function validateProductEntry(value: string) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/ibizplm-plmweb/');
  assert.ok(!url.username && !url.password && !url.search && !url.hash);
  return url.href;
}
export const productEntry = validateProductEntry(process.env.PLM_CURRENT_PRODUCT_BASE_URL ||
  'http://127.0.0.1:30250/ibizplm-plmweb/');
export const productOrigin = new URL(productEntry).origin;
export const productApi = '/api/ibizplm__plmweb';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const projectRequire = createRequire(path.resolve(__dirname, '../../plm-web/package.json'));
const compilerRequire = createRequire(projectRequire.resolve('vue'));
const parseNotificationHtml = compilerRequire('@vue/compiler-dom').parse as (html: string) => any;
const mqttRequire = createRequire(projectRequire.resolve('mqtt'));
const mqttPacket = mqttRequire('mqtt-packet');
const redact = (value: unknown) => String(value)
  .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
  .replace(/(refresh_token\/)[^/"'\s?]+/gi, '$1[redacted]');

export type ProductCredentials = {
  username: string;
  password: string;
  declaredRole: string;
};

export function validateOwnedProductRecord(record: any, owned: {
  id?: string; identifier: string; names: string[];
}) {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record));
  assert.match(record.id ?? '', /^[A-Za-z0-9_-]{1,100}$/);
  if (owned.id) assert.equal(record.id, owned.id, 'Only the recorded owned product ID is eligible');
  assert.equal(record.identifier, owned.identifier, 'Product identifier does not belong to this run');
  assert.ok(owned.names.includes(record.name), 'Product name does not belong to this run');
  return record;
}

export function validateProductIdentity(context: Record<string, unknown> | undefined,
  headers: Record<string, string>, credentials: ProductCredentials) {
  assert.ok(context && (context.srfuserid || context.srfpersonid),
    'Authenticated appdata must identify the real actor');
  assert.equal(context.srfsystemid, headers.srfsystemid, 'Server appdata belongs to a different application system');
  assert.equal(context.srforgid, headers.srforgid, 'Server appdata belongs to a different organization');
  const loginName = context.srfloginname;
  assert.ok(typeof loginName === 'string' ? loginName === credentials.username
    : context.srfuserid === credentials.username || context.srfpersonid === credentials.username,
  'Server appdata must bind the normally authenticated configured account');
  return true;
}

export function validateOwnedProductMember(record: any, productId: string) {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record));
  assert.match(record.id ?? '', /^[A-Za-z0-9_-]{1,100}$/);
  assert.equal(record.product_id, productId, 'Only the owned product membership is eligible for cleanup');
  assert.ok(typeof record.user_id === 'string' && record.user_id, 'A real member identity is required');
  return record;
}

export function validateProductNotificationReceipt(receipt: any, project: string, usernameSha256: string) {
  assert.equal(receipt.status, 'PASS', 'Only a completed owned product receipt may authorize notification work');
  return validateProductNotificationScope(receipt, project, usernameSha256);
}

export function validateFailedRealtimeNotificationCleanupReceipt(receipt: any, project: string, usernameSha256: string) {
  assert.equal(receipt?.status, 'FAILED');
  assert.equal(receipt.stages?.realtimeBusinessDelivery?.status, 'FAILED');
  assert.equal(receipt.stages?.failure, undefined, 'A failed business workflow cannot authorize this cleanup');
  for (const key of ['unexpectedConsoleErrors', 'pageErrors', 'failedRequests', 'httpErrors', 'captureErrors']) {
    assert.ok(Array.isArray(receipt[key]) && receipt[key].length === 0,
      'Only a completed business workflow with the isolated realtime failure is eligible');
  }
  assert.ok(Array.isArray(receipt.mqttPackets));
  assert.equal(receipt.mqttPackets.filter((packet: any) => packet.command === 'publish'
    && packet.matchesOwnedMarker && packet.portalSubtype === 'INTERNALMESSAGE').length, 0);
  return validateProductNotificationScope(receipt, project, usernameSha256);
}

function validateProductNotificationScope(receipt: any, project: string, usernameSha256: string) {
  assert.equal(receipt?.contract, 'current-owned-product-lifecycle-v1');
  assert.equal(receipt.project, project);
  assert.equal(receipt.entry, productEntry);
  assert.equal(receipt.account?.usernameSha256, usernameSha256);
  assert.match(receipt.marker ?? '', /^CP-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const owned = receipt.stages?.ownedInput;
  assert.equal(owned?.marker, receipt.marker);
  assert.match(owned.identifier ?? '', /^CP\d{12}$/);
  assert.equal(owned.name, `${receipt.marker} 产品🙂`);
  assert.equal(owned.editedName, `${owned.name} e\u0301`);
  assert.equal(receipt.stages.create?.status, 'PASS');
  assert.match(receipt.stages.create.productId ?? '', /^[A-Za-z0-9_-]{1,100}$/);
  assert.equal(receipt.cleanup?.status, 'PASS');
  assert.equal(receipt.cleanup.productId, receipt.stages.create.productId);
  assert.equal(receipt.cleanup.activeArchivedDeletedRemain, 0);
  assert.equal(receipt.cleanup.membershipReadbackEmpty, true);
  for (const stage of ['initialMembership', 'editReload', 'freshSessionReadback', 'archiveActivate', 'deleteRecover']) {
    assert.equal(receipt.stages[stage]?.status, 'PASS', `A complete source business event is required: ${stage}`);
  }
  const started = Date.parse(receipt.startedAt), finished = Date.parse(receipt.finishedAt);
  assert.ok(Number.isFinite(started) && Number.isFinite(finished) && finished >= started && finished - started <= 180_000);
  return { marker: receipt.marker as string, identifier: owned.identifier as string,
    names: [owned.name, owned.editedName] as string[], productId: receipt.stages.create.productId as string,
    startedAt: receipt.startedAt as string, finishedAt: receipt.finishedAt as string };
}

export const productNotificationEvents = [
  { template: 'product_member_create', text: '把你加入了产品', link: true },
  { template: 'product_member_remove', text: '把你移除了产品', link: false },
  { template: 'product_archived_or_activate', text: '归档了产品', link: false },
  { template: 'product_archived_or_activate', text: '激活了产品', link: true },
  { template: 'product_remove_or_recover', text: '删除了产品', link: false },
  { template: 'product_remove_or_recover', text: '恢复了产品', link: true },
] as const;

export function productNotificationText(html: string) {
  const tree = parseNotificationHtml(html);
  const selected = new Map<string, string[]>();
  const text = (node: any): string => node.type === 2 ? node.content : (node.children ?? []).map(text).join('');
  const visit = (node: any) => {
    if (node.type === 1) {
      assert.ok(!['script', 'iframe', 'object'].includes(node.tag.toLowerCase()), 'Unexpected active notification content');
      const classes = node.props.find((prop: any) => prop.type === 6 && prop.name === 'class')?.value?.content?.split(/\s+/) ?? [];
      for (const name of ['notice-card__event-desc', 'notice-card__object-name', 'notice-card__object-id']) {
        if (classes.includes(name)) selected.set(name, [...selected.get(name) ?? [], text(node).trim()]);
      }
    }
    (node.children ?? []).forEach(visit);
  };
  visit(tree);
  const single = (name: string) => {
    assert.equal(selected.get(name)?.length, 1, `Exactly one rendered notification field is required: ${name}`);
    return selected.get(name)![0];
  };
  return { event: single('notice-card__event-desc'), name: single('notice-card__object-name'),
    identifier: single('notice-card__object-id') };
}

export function validateProductNotificationLink(value: unknown, productId: string, mobile = false) {
  assert.ok(typeof value === 'string' && value.trim(), 'This business event declares a product link');
  const source = value.trim();
  const link = new URL(source, productEntry);
  const view = mobile ? 'product_mob_product_tree' : 'product_index_view';
  if (link.protocol === 'route:') {
    assert.equal(link.hostname, '-');
    assert.ok(!link.username && !link.password && !link.port && !link.hash && !link.search);
    const segments = decodeURIComponent(link.pathname).split('/');
    assert.equal(segments[1], mobile ? 'home' : 'index');
    assert.equal(segments[2], `product=${productId}`);
    assert.equal(segments[3], view);
    assert.equal(segments.filter(part => part.startsWith('product=')).length, 1);
  } else {
    assert.equal(link.origin, productOrigin);
    assert.equal(link.pathname, new URL(productEntry).pathname);
    const segments = decodeURIComponent(link.hash).split('/');
    assert.equal(segments.filter(part => part === `product=${productId}`).length, 1);
    assert.ok(segments.includes(view));
    assert.equal(segments.filter(part => part.startsWith('product=')).length, 1);
  }
}

export function validateOwnedProductNotification(record: any, owned: {
  marker: string; productId: string; names: string[]; identifier: string; startedAt: string; finishedAt: string;
}, identity: Record<string, unknown>) {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record));
  assert.match(record.id ?? '', /^[A-Za-z0-9_-]{1,100}$/);
  assert.ok(typeof identity.srfuserid === 'string' && identity.srfuserid);
  assert.ok(typeof identity.srfdcsystemid === 'string' && identity.srfdcsystemid);
  assert.equal(record.receiver, identity.srfuserid, 'Only a normally authenticated current receiver is eligible');
  const ownerIds = [identity.srfuserid, identity.srfpersonid].filter(value => typeof value === 'string' && value);
  assert.ok(typeof record.owner_id === 'string' && record.owner_id && ownerIds.includes(record.owner_id),
    'A matching receiver cannot authorize a message owned by another actor');
  assert.equal(record.system_tag, identity.srfdcsystemid, 'The message must belong to the current native system');
  assert.equal(record.owner_type, 'PERSONAL');
  assert.equal(record.content_type, 'HTML');
  assert.ok(['RECEIVED', 'READ'].includes(record.status));
  assert.ok(typeof record.content === 'string' && record.content.includes(owned.marker));
  const rendered = productNotificationText(record.content);
  assert.equal(rendered.identifier, owned.identifier);
  assert.ok(owned.names.includes(rendered.name), 'The rendered complete product name does not match the source receipt');
  const event = productNotificationEvents.find(item => item.template === record.message_type && item.text === rendered.event);
  assert.ok(event, 'Only a source-proven product lifecycle event is eligible');
  assert.ok(typeof record.create_time === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(record.create_time));
  const created = Date.parse(`${record.create_time.replace(' ', 'T')}+08:00`);
  const started = Date.parse(owned.startedAt), finished = Date.parse(owned.finishedAt);
  assert.ok(Number.isFinite(created) && Number.isFinite(started) && Number.isFinite(finished));
  assert.ok(created >= started - 120_000 && created <= finished + 120_000,
    'Notification time is outside the source business run');
  for (const [field, mobile] of [['url', false], ['mobile_url', true]] as const) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) validateProductNotificationLink(value, owned.productId, mobile);
    else {
      assert.ok(value === undefined || value === null || value === '', 'Malformed optional notification link');
      assert.equal(event.link, false, 'A linked business event lost its declared product route');
    }
  }
  return record;
}

export function productNotificationTotal(value: string | undefined) {
  assert.ok(typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value), 'A native total-count header is required');
  const total = Number(value);
  assert.ok(Number.isSafeInteger(total) && total >= 0 && total <= 10_000, 'The current receiver set exceeds this bounded run');
  return total;
}

export function loadProductCredentials(): ProductCredentials {
  const filename = process.env.PLM_CURRENT_PRODUCT_CREDENTIALS;
  if (!filename || !path.isAbsolute(filename)) throw new Error('A current private product credentials JSON is required');
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.geteuid()) {
    throw new Error('Product credentials must be an owned private regular file');
  }
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const key of ['username', 'password', 'declaredRole']) {
    if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Missing product credential ${key}`);
  }
  return value;
}

export function runtimeWitness() {
  const names = ['plmweb', 'plmservice', 'ibizlab-uaa-api', 'ibiz-ebsx-allinone', 'ibiz-ebsx-gateway'];
  const containers = JSON.parse(execFileSync('docker', ['inspect', ...names], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  }));
  return names.map(name => {
    const container = containers.find((row: any) => row.Name === `/${name}`);
    if (!container || !/^[a-f0-9]{64}$/.test(container.Id) ||
        !/^sha256:[a-f0-9]{64}$/.test(container.Image) || !container.State.Running) {
      throw new Error('The existing PLM runtime is not running with exact immutable identities');
    }
    return { name, containerId: container.Id, imageId: container.Image,
      startedAt: container.State.StartedAt, restartCount: container.RestartCount,
      mounts: container.Mounts,
      mountsSha256: digest(JSON.stringify(container.Mounts)),
      configurationSha256: digest(JSON.stringify({ config: container.Config, host: container.HostConfig })) };
  });
}

export function assertProductRuntimeUnchanged(before: ReturnType<typeof runtimeWitness>,
  after: ReturnType<typeof runtimeWitness>) {
  const canonical = (runtime: ReturnType<typeof runtimeWitness>) => runtime.map(({ mounts, mountsSha256: _raw, ...identity }) => ({
    ...identity,
    mounts: [...mounts].sort((left, right) =>
      [left.Destination, left.Type, left.Source].join('\0')
        .localeCompare([right.Destination, right.Type, right.Source].join('\0'))),
  }));
  assert.deepEqual(canonical(after), canonical(before), 'Runtime identity or mount content changed');
  return { status: 'PASS', completeMountContentCompared: true,
    rawMountHashChanges: before.filter((item, index) => item.mountsSha256 !== after[index].mountsSha256)
      .map(item => item.name) };
}

export function sourceWitness() {
  const root = path.resolve(__dirname, '../..');
  const files = [
    'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/product.json',
    'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/product_member.json',
    'plm/model/PSSYSAPPS/plmweb/PSAPPDEVIEWS/product_create_wizard_view.json',
    'plm-web/src/publish/model/entities/product.ts',
    'plm-web/src/publish/model/views/product-create-wizard-view.ts',
    'plm-e2e/tests/current-owned-product-helper.ts',
    'plm-e2e/tests/current-owned-product-lifecycle.spec.ts',
    'plm-e2e/tests/current-owned-product-cleanup.spec.ts',
    'plm-e2e/tests/current-owned-product-notification.spec.ts',
    'plm-e2e/playwright.current-owned-product.config.ts',
    'plm-e2e/config-tests/current-owned-product-lifecycle.test.mjs',
    'plm/model/PSSYSTEM.json',
    'ibiz-service-hub/libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension/PSMODULES/Notify/PSDATAENTITIES/internal_message.json',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-tab/internal-message-tab.tsx',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/common/internal-message-container/internal-message-container.tsx',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/user-message.scss',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-group/internal-message-group.scss',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/common/internal-message-container/internal-message-container.scss',
    'scripts/prepare-plm-notification-style.mjs',
    'scripts/tests/prepare-plm-notification-style.test.mjs',
    'plm-e2e/config-tests/current-owned-notification-layout.test.mjs',
    'ibiz-app-hub/components/ibiz-next-vue3/src/util/user-message-util/internal-message-locale.ts',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-html/internal-message-html.tsx',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-group/internal-message-group.tsx',
    'ibiz-app-hub/packages/runtime/src/controller/control/search-bar/search-bar-group.util.ts',
    'scripts/prepare-plm-language-runtime-candidate.mjs',
    'scripts/deploy-existing-plm-language-runtime.mjs',
    'scripts/tests/notification-display-locale.test.mjs',
  ];
  return { kind: 'observed-current-source-not-proof-of-loaded-model-equivalence',
    commits: ['plm', 'plm-web', 'plm-e2e'].map(repository => ({
      repository, commit: execFileSync('git', ['-C', path.join(root, repository), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['-C', path.join(root, repository), 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    })),
    files: files.map(filename => ({ path: filename, sha256: digest(fs.readFileSync(path.join(root, filename))) })) };
}

export function createProductEvidence(testInfo: TestInfo, marker: string, credentials: ProductCredentials) {
  const source = sourceWitness();
  const root = path.resolve(__dirname, '../..');
  const snapshots = source.files.map(file => {
    const bytes = fs.readFileSync(path.join(root, file.path));
    if (digest(bytes) !== file.sha256) throw new Error(`Product source changed before snapshot: ${file.path}`);
    const target = testInfo.outputPath('executed-source', file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(target, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    let directory = path.dirname(target);
    const base = testInfo.outputPath();
    while (directory.startsWith(base)) {
      const handle = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
      if (directory === base) break;
      directory = path.dirname(directory);
    }
    return { path: file.path, snapshot: target, sha256: file.sha256, bytes: bytes.length };
  });
  return {
    contract: 'current-owned-product-lifecycle-v1', status: 'FAILED', marker,
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    project: testInfo.project.name, locale: testInfo.project.use.locale,
    viewport: testInfo.project.use.viewport,
    entry: productEntry,
    account: { usernameSha256: digest(credentials.username), declaredRole: credentials.declaredRole,
      ordinaryRoleAcceptance: false, roleMatrixAcceptance: false },
    source: { ...source, sourceSnapshotUnavailable: false, snapshots },
    runtimeBefore: runtimeWitness(), runtimeAfter: [] as ReturnType<typeof runtimeWitness>,
    runtimeComparison: null as ReturnType<typeof assertProductRuntimeUnchanged> | null,
    consoleErrors: [] as unknown[], pageErrors: [] as unknown[], failedRequests: [] as unknown[],
    unexpectedConsoleErrors: [] as unknown[], expectedPreAuthConsoleErrors: [] as unknown[],
    httpErrors: [] as unknown[], apiResponses: [] as unknown[], expectedPreAuthResponses: [] as unknown[],
    resourceBindings: [] as unknown[], captureErrors: [] as string[],
    resourceReadbackRetries: [] as unknown[],
    mqttPackets: [] as any[], mqttFrames: [] as unknown[], mqttConnections: [] as unknown[],
    sessions: [] as unknown[], stages: {} as Record<string, unknown>, cleanup: {} as Record<string, unknown>,
    fullB01Acceptance: false, fullLocalizationAcceptance: false,
  };
}

type Evidence = ReturnType<typeof createProductEvidence>;
export function classifyProductConsole(evidence: Evidence) {
  const expected = evidence.consoleErrors.filter((item: any) => item.phase === 'pre-auth' &&
    /^Failed to load resource: the server responded with a status of 401(?:\s|\(|$)/.test(item.message) &&
    evidence.expectedPreAuthResponses.some((response: any) => response.phase === 'pre-auth' &&
      response.requestPhase === 'pre-auth' && response.method === 'GET' && response.authenticated === false &&
      response.path === item.path && response.status === 401));
  return { expected, unexpected: evidence.consoleErrors.filter(item => !expected.includes(item)) };
}

export async function productDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function productJournal(testInfo: TestInfo, evidence: Evidence) {
  let sequence = 0;
  return (stage: string) => {
    const filename = testInfo.outputPath(`event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`);
    const descriptor = fs.openSync(filename, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify({ stage, evidence }, null, 2)}\n`);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  };
}

export type ProductSession = {
  page: Page; context: BrowserContext;
  headers(): Promise<Record<string, string>>;
  quiet(): Promise<void>;
  identity(): Promise<Record<string, unknown>>;
  request(method: string, suffix: string, data?: unknown): Promise<any>;
  requestWithMetadata(method: string, suffix: string, data?: unknown): Promise<{
    value: any; status: number; headers: Record<string, string>;
  }>;
  close(): Promise<void>;
};

export async function ensureProductMenu(page: Page, language: 'zh-CN' | 'en') {
  const navigation = page.locator('.ibiz-control-appmenu-plm_menu');
  await expect(navigation).toBeVisible();
  if (await navigation.evaluate(element => element.classList.contains('is-collapse'))) {
    await navigation.locator('.ibiz-control-appmenu-collapse-icon').click();
  }
  const item = navigation.locator('.el-menu-item').filter({ hasText: language === 'en' ? /^Products$/ : /^产品管理$/ });
  await expect(item).toBeVisible();
  return item;
}

export async function openProductManagement(page: Page, language: 'zh-CN' | 'en') {
  await (await ensureProductMenu(page, language)).click();
  await expect(page.locator('.ibiz-view--product_tree_exp_view')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    const navigation = page.locator('.ibiz-control-appmenu-plm_menu');
    await navigation.locator('.ibiz-control-appmenu-collapse-icon').click();
    await expect(navigation).toHaveClass(/\bis-collapse\b/);
  }
}

export async function loginProductSession(browser: Browser, credentials: ProductCredentials,
  evidence: Evidence, language: 'zh-CN' | 'en', testInfo: TestInfo): Promise<ProductSession> {
  const context = await browser.newContext({
    locale: language === 'en' ? 'en-US' : 'zh-CN',
    viewport: testInfo.project.use.viewport as { width: number; height: number },
    isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch,
    serviceWorkers: 'block', timezoneId: 'Asia/Shanghai',
  });
  await context.addInitScript(selected => {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      localStorage.setItem('language', selected);
    }
  }, language);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  let phase = 'pre-auth';
  let observedHeaders: Record<string, string> | undefined;
  let serverContext: Record<string, unknown> | undefined;
  const pending = new Set<Promise<unknown>>();
  const requests = new WeakMap<object, string>();
  const track = (operation: Promise<unknown>) => {
    const task = operation.catch(error => evidence.captureErrors.push(redact(error.message)))
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on('request', request => {
    requests.set(request, phase);
    track((async () => {
      if (!request.url().startsWith(`${productOrigin}${productApi}/`)) return;
      const headers = request.headers();
      if (headers.authorization && headers.srfsystemid && headers.srforgid) {
        observedHeaders = { accept: 'application/json', authorization: headers.authorization,
          srfsystemid: headers.srfsystemid, srforgid: headers.srforgid };
      }
    })());
  });
  page.on('websocket', socket => {
    const socketPath = new URL(socket.url()).pathname;
    const received = mqttPacket.parser();
    received.on('error', (error: Error) => evidence.captureErrors.push(`MQTT packet parse: ${redact(error.message)}`));
    received.on('packet', (packet: any) => {
      const body = packet.payload ? Buffer.from(packet.payload) : undefined;
      let message: any;
      if (packet.cmd === 'publish' && body) {
        try { message = JSON.parse(body.toString('utf8')); } catch {}
      }
      let businessEvent: string | undefined;
      if (message?.subtype === 'INTERNALMESSAGE' && body?.includes(Buffer.from(evidence.marker))
          && typeof message.content === 'string') {
        try {
          const event = productNotificationText(message.content).event;
          if (productNotificationEvents.some(item => item.text === event)) businessEvent = event;
          else evidence.captureErrors.push('Owned MQTT notification has an unknown product event');
        } catch (error) {
          evidence.captureErrors.push(`Owned MQTT notification content: ${redact((error as Error).message)}`);
        }
      }
      evidence.mqttPackets.push({ socketPath, direction: 'received', command: packet.cmd,
        ...(packet.cmd === 'connack' ? { returnCode: packet.returnCode } : {}),
        ...(packet.cmd === 'suback' ? { granted: packet.granted } : {}),
        ...(typeof packet.topic === 'string' ? { topicSha256: digest(packet.topic) } : {}),
        ...(body ? { payloadBytes: body.length, payloadSha256: digest(body),
          matchesOwnedMarker: body.includes(Buffer.from(evidence.marker)) } : {}),
        ...(message ? { portalType: message.type, portalSubtype: message.subtype } : {}),
        ...(businessEvent ? { businessEvent } : {}) });
    });
    evidence.mqttConnections.push({ path: socketPath, rawUrlOrTokenRetained: false });
    socket.on('framereceived', frame => {
      const bytes = Buffer.isBuffer(frame.payload) ? frame.payload : Buffer.from(frame.payload);
      evidence.mqttFrames.push({ socketPath, direction: 'received', bytes: bytes.length, sha256: digest(bytes) });
      try { received.parse(bytes); }
      catch (error) { evidence.captureErrors.push(`MQTT frame: ${redact((error as Error).message)}`); }
    });
    socket.on('framesent', frame => evidence.mqttFrames.push({ socketPath, direction: 'sent',
      bytes: Buffer.byteLength(frame.payload), payloadOrCredentialRetained: false }));
    socket.on('socketerror', error => evidence.captureErrors.push(`MQTT socket: ${redact(error)}`));
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      let resourcePath: string | null = null;
      try { resourcePath = new URL(message.location().url).pathname; } catch {}
      evidence.consoleErrors.push({ phase, path: resourcePath, message: redact(message.text()) });
    }
  });
  page.on('pageerror', error => evidence.pageErrors.push({ phase, message: redact(error.message) }));
  page.on('requestfailed', request => evidence.failedRequests.push({
    phase, path: redact(new URL(request.url()).pathname), method: request.method(),
    error: redact(request.failure()?.errorText),
  }));
  page.on('response', response => track((async () => {
    const url = new URL(response.url());
    const request = response.request();
    const requestPhase = requests.get(request);
    const headers = request.headers();
    const observation = { phase, requestPhase, path: redact(url.pathname), status: response.status(),
      method: request.method(), authenticated: Boolean(headers.authorization) };
    if (response.status() >= 400) {
      if (response.status() === 401 && phase === 'pre-auth' && requestPhase === 'pre-auth' && !headers.authorization &&
          [`${productApi}/appdata`, `${productApi}/uaa/getbydcsystem/ibizplm`].includes(url.pathname)) {
        evidence.expectedPreAuthResponses.push(observation);
      } else evidence.httpErrors.push(observation);
    }
    if (url.pathname.startsWith(`${productApi}/`)) evidence.apiResponses.push(observation);
    if (url.pathname === `${productApi}/appdata` && response.status() === 200 && headers.authorization) {
      const payload = await response.json();
      serverContext = payload.context;
    }
    if (['script', 'stylesheet', 'document'].includes(request.resourceType()) && response.status() === 200 &&
        url.origin === productOrigin) {
      let body: Buffer;
      let source = 'observed-browser-response';
      try {
        body = await productDeadline(response.body(), 5000, 'Static browser response bytes were not available before navigation');
      } catch (error) {
        const etag = response.headers().etag;
        if (!etag || request.method() !== 'GET') throw error;
        const readback = await context.request.get(url.href, { headers: { 'If-Match': etag }, timeout: 10_000 });
        expect(readback.status(), 'A conditional readback must still serve the observed resource version').toBe(200);
        expect(readback.headers().etag).toBe(etag);
        body = await readback.body();
        source = 'conditional-readback-of-observed-resource';
        evidence.resourceReadbackRetries.push({ path: url.pathname, etag,
          reason: redact((error as Error).message), result: 'same-etag-readback' });
      }
      evidence.resourceBindings.push({ path: url.pathname, source, bytes: body.length, sha256: digest(body) });
    }
  })()));
  const quiet = async () => {
    await productDeadline((async () => {
      while (pending.size) await Promise.all([...pending]);
    })(), 15_000, 'Product browser evidence did not drain within its 15-second budget');
  };
  const headers = async () => {
    await quiet();
    if (!observedHeaders) throw new Error('Normal UI has not issued authenticated application headers');
    return observedHeaders;
  };
  const requestWithMetadata = async (method: string, suffix: string, data?: unknown) => {
    if (!suffix.startsWith('/') || suffix.includes('..')) throw new Error('Only an exact native product API suffix is allowed');
    const response = await context.request.fetch(`${productOrigin}${productApi}${suffix}`, {
      method, headers: await headers(), ...(data === undefined ? {} : { data }),
    });
    const body = await response.body();
    evidence.apiResponses.push({ source: 'native-api-with-ui-issued-headers',
      method, path: `${productApi}${suffix}`, status: response.status(),
      bytes: body.length, sha256: digest(body) });
    if (response.status() !== 200) throw new Error(`Native product ${method} ${suffix} returned ${response.status()}`);
    return { value: body.length ? JSON.parse(body.toString('utf8')) : null, status: response.status(), headers: response.headers() };
  };
  const session: ProductSession = {
    context, page, quiet, headers, requestWithMetadata,
    async identity() {
      await quiet();
      const nativeHeaders = await headers();
      validateProductIdentity(serverContext, nativeHeaders, credentials);
      return Object.fromEntries(['srfuserid', 'srfpersonid', 'srforgid', 'srfsystemid', 'srfdcsystemid']
        .map(key => [key, serverContext?.[key] ?? null]));
    },
    async request(method, suffix, data) {
      return (await requestWithMetadata(method, suffix, data)).value;
    },
    async close() {
      try { await quiet(); } catch (error) { evidence.captureErrors.push(redact((error as Error).message)); }
      try { await context.close(); } catch (error) { evidence.captureErrors.push(redact((error as Error).message)); }
      try { await quiet(); } catch (error) { evidence.captureErrors.push(redact((error as Error).message)); }
    },
  };
  try {
    await page.goto(productEntry, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="password"]').first().waitFor();
    await page.waitForLoadState('networkidle');
    await quiet();
    await page.locator('input[type="text"]').first().fill(credentials.username);
    await page.locator('input[type="password"]').first().fill(credentials.password);
    const loggedIn = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${productApi}/v7/login`);
    phase = 'login-submitted';
    await page.getByRole('button', { name: /^(?:登录|登陆|Log\s?in|Sign\s?in)$/i }).first().click();
    expect((await loggedIn).status()).toBe(200);
    await ensureProductMenu(page, language);
    phase = 'authenticated';
    await quiet();
    const nativeHeaders = await headers();
    validateProductIdentity(serverContext, nativeHeaders, credentials);
    evidence.sessions.push({ login: 'normal-ui', tokenInjected: false,
      applicationHeaderSource: 'observed-normal-browser-request',
      system: nativeHeaders.srfsystemid, organizationSha256: digest(nativeHeaders.srforgid),
      serverIdentitySha256: digest(JSON.stringify(Object.fromEntries(
        ['srfuserid', 'srfpersonid', 'srforgid', 'srfsystemid', 'srfdcid', 'srfusermode']
          .map(key => [key, serverContext?.[key] ?? null])))),
      roleModeObserved: serverContext?.srfusermode ?? null,
      contextIndependentlyCreated: true });
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

export async function productScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

export function productSettingsPath(id: string, advanced = false) {
  return `${productEntry}#/-/index/product=${encodeURIComponent(id)}/product_index_view/` +
    `srfnav=usrdrgroup1228809432/product_setting_view/srfnav=${advanced ? 'adv' : 'base'}/` +
    `${advanced ? 'product_advanced_setting_edit_view' : 'product_base_information_edit_view'}/-`;
}
