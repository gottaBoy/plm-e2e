import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Page, type Response, type TestInfo } from '@playwright/test';

export const knowledgeOrigin = 'http://127.0.0.1:30250';
export const knowledgeEntry = `${knowledgeOrigin}/ibizplm-plmweb/`;
export const knowledgeApi = '/api/ibizplm__plmweb';
export const digest = (value: string | Buffer) => createHash('sha256')
  .update(typeof value === 'string' ? value : new Uint8Array(value)).digest('hex');
const redact = (value: unknown) => String(value).replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
  .replace(/(refresh_token\/)[^/"'\s?]+/gi, '$1[redacted]');

export function validateKnowledgeIdentity(context: any, headers: Record<string, string>,
  credentials: { username: string }) {
  assert.ok(context && typeof context === 'object' && !Array.isArray(context));
  assert.equal(headers.srfsystemid, 'ibizplm');
  assert.equal(context.srfsystemid, headers.srfsystemid);
  assert.ok(typeof headers.srforgid === 'string' && headers.srforgid.length > 0);
  assert.equal(context.srforgid, headers.srforgid);
  assert.ok(typeof context.srfuserid === 'string' && context.srfuserid.length > 0);
  assert.ok(context.srfloginname === credentials.username || context.srfuserid === credentials.username
    || context.srfpersonid === credentials.username, 'The current actor must match the normal login');
  return true;
}

export function validateOwnedKnowledgePage(row: any,
  owned: { spaceId: string; title: string; pageId?: string }) {
  assert.ok(row && typeof row === 'object' && !Array.isArray(row));
  assert.match(row.id, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(row.space_id, owned.spaceId);
  assert.equal(row.name, owned.title);
  if (owned.pageId !== undefined) assert.equal(row.id, owned.pageId);
  return row;
}

export function validateOwnedKnowledgeHome(row: any, owned: { spaceId: string; actorId: string }) {
  assert.ok(row && typeof row === 'object' && !Array.isArray(row));
  assert.match(owned.spaceId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(row.id, owned.spaceId);
  assert.equal(row.space_id, owned.spaceId);
  assert.equal(row.name, '主页');
  assert.equal(String(row.type), '1');
  assert.equal(row.format_type, 'HTML');
  assert.equal(row.create_man, owned.actorId);
  return row;
}

export function knowledgeCredentials() {
  const filename = process.env.PLM_CURRENT_KNOWLEDGE_CREDENTIALS;
  if (!filename || !path.isAbsolute(filename)) throw new Error('An explicit private knowledge credentials file is required');
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.geteuid() || (info.mode & 0o077)) {
    throw new Error('Knowledge credentials must be an owned private regular file');
  }
  const input = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const key of ['username', 'password', 'declaredRole']) {
    if (typeof input[key] !== 'string' || !input[key]) throw new Error(`Missing knowledge credential ${key}`);
  }
  return input as { username: string; password: string; declaredRole: string };
}

export function knowledgeRecovery() {
  const filename = process.env.PLM_CURRENT_KNOWLEDGE_RECOVERY_JOURNAL;
  if (!filename) return undefined;
  expect(path.isAbsolute(filename)).toBe(true);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let rows: any[];
  let journalSha256: string;
  try {
    const info = fs.fstatSync(fd);
    expect(info.isFile() && info.uid === process.geteuid() && info.nlink === 1
      && (info.mode & 0o077) === 0 && info.size <= 1024 * 1024).toBe(true);
    const bytes = fs.readFileSync(fd);
    journalSha256 = digest(bytes);
    rows = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  } finally { fs.closeSync(fd); }
  const intent = rows.filter(row => row.stage === 'intent-before-any-business-write');
  const creation = rows.filter(row => row.stage === 'space-create-ui-intent');
  const verified = rows.filter(row => row.stage === 'cleanup-owned-space-verified');
  const completed = rows.filter(row => row.stage === 'cleanup-complete');
  const recoveryMode = process.env.PLM_CURRENT_KNOWLEDGE_RECOVERY_MODE ?? 'derived-only';
  expect(['resources', 'derived-only']).toContain(recoveryMode);
  const resources = recoveryMode === 'resources';
  const created = rows.filter(row => row.stage === 'space-created');
  for (const candidates of [intent, creation, verified]) expect(candidates).toHaveLength(1);
  if (resources) expect(created).toHaveLength(1);
  else expect(completed).toHaveLength(1);
  const { marker, identifier } = intent[0].details;
  const { name } = creation[0].details;
  const { spaceId } = verified[0].details;
  expect(marker).toMatch(/^CK-[a-f0-9-]{36}$/);
  expect(identifier).toMatch(/^CK[A-F0-9]{12}$/);
  expect(creation[0].details.identifier).toBe(identifier);
  expect(creation[0].details.expectedVisibility).toBe('private');
  expect(typeof name === 'string' && name.startsWith(marker)).toBe(true);
  expect(spaceId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  expect(verified[0].details.identifier).toBe(identifier);
  if (resources) {
    expect(created[0].details.id).toBe(spaceId);
    expect(created[0].details.identifier).toBe(identifier);
    expect(created[0].details.name).toBe(name);
    expect(completed).toHaveLength(0);
  } else {
    expect(completed[0].details.status).toBe('PASS');
    expect(completed[0].details.spaceId).toBe(spaceId);
    expect(completed[0].details.remainingSpaces).toBe(0);
  }
  const pageIds = [...new Set<string>(rows.filter(row =>
    (row.stage === 'cleanup-owned-page-intent' ||
      (resources || completed[0]?.details.knownPageIds) && row.stage === 'draft-created')
      && row.details?.spaceId === spaceId).map(row => row.details.pageId ?? row.details.id))];
  for (const id of pageIds) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  if (!resources) {
    if (completed[0].details.knownPageIds) {
      expect([...pageIds].sort()).toEqual([...completed[0].details.knownPageIds].sort());
    } else expect(pageIds).toHaveLength(completed[0].details.pagesRemoved);
  }
  return { marker, identifier, name, spaceId, pageIds, journalSha256,
    mode: resources ? 'resources' : 'derived-only' };
}

export function knowledgeRuntimeWitness() {
  const names = ['plmweb', 'plmservice', 'ibizlab-uaa-api', 'ibiz-ebsx-allinone', 'ibiz-ebsx-gateway'];
  const rows = JSON.parse(execFileSync('docker', ['inspect', ...names], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  }));
  return names.map(name => {
    const row = rows.find((item: any) => item.Name === `/${name}`);
    if (!row?.State.Running) throw new Error('Existing knowledge runtime is not running');
    const mounts = row.Mounts;
    let provider: { sha256: string; metadata: string } | undefined;
    if (name === 'plmservice') {
      const result = execFileSync('docker', ['exec', row.Id, 'sh', '-c', `set -efu
test -f /app/plm-provider.jar && test ! -L /app/plm-provider.jar
knowledge_before=$(stat -c '%d %i %u %g %a %h %s %Y %Z' /app/plm-provider.jar)
knowledge_hash=$(sha256sum /app/plm-provider.jar)
knowledge_after=$(stat -c '%d %i %u %g %a %h %s %Y %Z' /app/plm-provider.jar)
test "$knowledge_before" = "$knowledge_after"
printf '%s\\n%s\\n' "$knowledge_after" "\${knowledge_hash%% *}"
`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 });
      const [metadata, sha256, empty] = result.split('\n');
      assert.equal(empty, '');
      assert.match(metadata, /^\d+ \d+ \d+ \d+ [0-7]+ \d+ \d+ \d+ \d+$/);
      assert.match(sha256, /^[a-f0-9]{64}$/);
      provider = { sha256, metadata };
    }
    return { name, id: row.Id, imageId: row.Image, startedAt: row.State.StartedAt,
      restartCount: row.RestartCount, mounts, mountsSha256: digest(JSON.stringify(mounts)),
      configurationSha256: digest(JSON.stringify({ config: row.Config, host: row.HostConfig })), provider };
  });
}

export function assertKnowledgeRuntimeUnchanged(before: ReturnType<typeof knowledgeRuntimeWitness>,
  after: ReturnType<typeof knowledgeRuntimeWitness>) {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const sorted = (runtime: ReturnType<typeof knowledgeRuntimeWitness>) => runtime.map(
    ({ mounts, mountsSha256: _rawHash, ...identity }) => ({
      ...identity,
      mounts: mounts.map(canonical).sort((left: any, right: any) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))),
    }));
  assert.deepEqual(sorted(after), sorted(before), 'Runtime identity, configuration, mounts or provider bytes drifted');
  return { status: 'PASS', completeMountContentCompared: true, providerBytesCompared: true,
    rawMountHashChanges: before.filter((row, index) => row.mountsSha256 !== after[index].mountsSha256)
      .map(row => row.name) };
}

export function knowledgeEvidence(testInfo: TestInfo, marker: string, identifier: string) {
  const root = path.resolve(__dirname, '../..');
  const files = [
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/space.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/space/PSDELOGICS/auto_create_home_page.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/publish_page.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/guard_locked_page.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/shared_setting.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/shared_url.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/lock_page.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/unlock_page.json',
    'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/closed_shared.json',
    'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/wiki/articlepage/logic/PublishPage.groovy',
    'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/wiki/articlepage/logic/SharedUrl.groovy',
    'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/logic/DELogicScriptNodeRuntime.java',
    'plm-e2e/tests/current-owned-knowledge-helper.ts',
    'plm-e2e/tests/current-owned-knowledge-lifecycle.spec.ts',
    'plm-e2e/playwright.current-owned-knowledge.config.ts',
  ];
  fs.mkdirSync(testInfo.outputDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(testInfo.outputDir, 0o700);
  const journal = testInfo.outputPath('knowledge-owned-journal.private.jsonl');
  const append = (stage: string, details: unknown) => {
    const fd = fs.openSync(journal,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const identity = fs.fstatSync(fd);
      if (!identity.isFile() || identity.uid !== process.geteuid() || identity.nlink !== 1 || (identity.mode & 0o077)) {
        throw new Error('The owned knowledge journal identity changed');
      }
      fs.writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), stage, details })}\n`);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    const parent = fs.openSync(testInfo.outputDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  };
  append('intent-before-any-business-write', { marker, identifier });
  const sourceFiles = files.map((filename, index) => {
    const bytes = fs.readFileSync(path.join(root, filename));
    const snapshot = `source-${String(index).padStart(3, '0')}.private.txt`;
    const descriptor = fs.openSync(testInfo.outputPath(snapshot), 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    return { path: filename, sha256: digest(bytes), snapshot };
  });
  const sourceDirectory = fs.openSync(testInfo.outputDir,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(sourceDirectory); } finally { fs.closeSync(sourceDirectory); }
  return {
    append,
    verifySourceInputs() {
      for (const file of sourceFiles) assert.equal(digest(fs.readFileSync(path.join(root, file.path))), file.sha256,
        'A knowledge source input changed during the live workflow');
      return true;
    },
    report: {
      contract: 'current-owned-knowledge-lifecycle-v1', status: 'FAILED', marker, identifier,
      startedAt: new Date().toISOString(), language: testInfo.project.use.locale,
      viewport: testInfo.project.use.viewport,
      source: { kind: 'observed-source-not-loaded-model-equivalence',
        commits: ['plm', 'plm-web', 'plm-e2e'].map(repository => ({
          repository,
          commit: execFileSync('git', ['-C', path.join(root, repository), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          dirtyStateSha256: digest(execFileSync('git', ['-C', path.join(root, repository), 'status', '--porcelain'])),
        })),
        files: sourceFiles },
      sourceInputsStable: false,
      runtimeBefore: knowledgeRuntimeWitness(), runtimeAfter: [] as ReturnType<typeof knowledgeRuntimeWitness>,
      runtimeComparison: {} as Record<string, unknown>,
      sessions: [] as unknown[], appdata: [] as unknown[], stages: {} as Record<string, unknown>,
      consoleErrors: [] as any[], pageErrors: [] as unknown[], failedRequests: [] as unknown[],
      httpErrors: [] as unknown[], expectedPreAuth: [] as { path: string; status: number }[],
      expectedDenials: [] as unknown[], apiResponses: [] as unknown[], servedBytes: [] as unknown[],
      resourceReadbackRetries: [] as unknown[],
      captureErrors: [] as unknown[], cleanup: {} as Record<string, unknown>,
      finishedAt: undefined as string | undefined,
      roleMatrixAcceptance: false, fullB01Acceptance: false, fullB02Acceptance: false,
      fullLocalizationAcceptance: false,
    },
  };
}

export type KnowledgeEvidence = ReturnType<typeof knowledgeEvidence>;
export type KnowledgeSession = {
  page: Page; context: BrowserContext;
  userId(): string;
  request(method: string, suffix: string, data?: unknown, expected?: number[]): Promise<any>;
  close(): Promise<void>;
  quiet(): Promise<void>;
};

export async function openKnowledgeManagement(page: Page, english: boolean) {
  const navigation = page.locator('.ibiz-control-appmenu-plm_menu');
  await expect(navigation).toBeVisible();
  if (await navigation.evaluate(element => element.classList.contains('is-collapse'))) {
    await navigation.locator('.ibiz-control-appmenu-collapse-icon').click();
  }
  await navigation.locator('.el-menu-item').filter({ hasText: english ? /^Knowledge$/ : /^知识管理$/ }).click();
  await expect(page.locator('.ibiz-view--space_tree_exp_view')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await navigation.locator('.ibiz-control-appmenu-collapse-icon').click();
    await expect(navigation).toHaveClass(/\bis-collapse\b/);
  }
}

export async function closeKnowledgeModals(page: Page) {
  const closers = page.locator(
    '.ibiz-modal__close:visible,.el-dialog__headerbtn:visible,.el-dialog__close:visible');
  for (let attempt = 0; attempt < 3; attempt++) {
    const count = await closers.count();
    if (count === 0) return;
    await closers.last().click();
    await expect.poll(() => closers.count()).toBeLessThan(count);
  }
  await expect(closers).toHaveCount(0);
}

export async function performKnowledgeAction(page: Page, predicate: (response: Response) => boolean,
  action: () => Promise<unknown>) {
  const response = page.waitForResponse(predicate);
  const [observed] = await Promise.all([response, action()]);
  return observed;
}

export async function cleanupKnowledgeAssociations(session: KnowledgeSession, evidence: KnowledgeEvidence,
  owned: { spaceId: string; identifier: string; name: string; pageIds: string[] }) {
  expect(owned.spaceId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  const ownedIds = new Set([owned.spaceId, ...owned.pageIds]);
  for (const id of ownedIds) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  const members = async () => {
    const rows = await session.request('POST', '/space_members/fetch_default',
      { page: 0, size: 1000, n_space_id_eq: owned.spaceId });
    return rows.filter((row: any) => row.space_id === owned.spaceId);
  };
  const recents = async () => {
    const rows = await session.request('POST', '/recents/fetch_default',
      { page: 0, size: 1000, n_recent_parent_eq: owned.spaceId });
    return rows.filter((row: any) => row.recent_parent === owned.spaceId);
  };
  const memberRows = await members();
  for (const row of memberRows) {
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(row.user_id).toBe(session.userId());
    const current = await session.request('GET', `/space_members/${row.id}`);
    expect(current.id).toBe(row.id);
    expect(current.space_id).toBe(owned.spaceId);
    expect(current.user_id).toBe(session.userId());
    evidence.append('cleanup-owned-membership-intent', { spaceId: owned.spaceId, memberId: row.id });
    await session.request('DELETE', `/space_members/${row.id}`);
  }
  const recentRows = await recents();
  for (const row of recentRows) {
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(ownedIds.has(row.owner_id)).toBe(true);
    expect(row.owner_type).toBe('space');
    expect(['space', 'page']).toContain(row.owner_subtype);
    expect(row.create_man).toBe(session.userId());
    expect(row.recent_parent_identifier).toBe(owned.identifier);
    expect(row.recent_parent_name).toBe(owned.name);
    const current = await session.request('GET', `/recents/${row.id}`);
    for (const field of ['id', 'owner_id', 'owner_type', 'owner_subtype', 'recent_parent',
      'recent_parent_identifier', 'recent_parent_name', 'create_man']) {
      expect(current[field]).toBe(row[field]);
    }
    evidence.append('cleanup-owned-recent-intent', { spaceId: owned.spaceId, recentId: row.id });
    await session.request('DELETE', `/recents/${row.id}`);
  }
  expect(await members()).toEqual([]);
  expect(await recents()).toEqual([]);
  return { membersRemoved: memberRows.length, recentRecordsRemoved: recentRows.length,
    remainingMembers: 0, remainingRecentRecords: 0 };
}

async function boundedKnowledgeCapture<T>(operation: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Knowledge capture timed out: ${label}`)), 5_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function settleKnowledgeCaptures(pending: Set<Promise<unknown>>,
  labels?: Map<Promise<unknown>, string>) {
  const deadline = Date.now() + 15_000;
  while (pending.size) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Knowledge evidence collection did not finish: ${[...pending]
      .map(task => labels?.get(task) ?? 'anonymous-response').join(', ')}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all([...pending]), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Knowledge evidence collection deadline exceeded: ${[...pending]
          .map(task => labels?.get(task) ?? 'anonymous-response').join(', ')}`)), remaining);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}

export async function loginKnowledgeSession(browser: Browser, credentials: ReturnType<typeof knowledgeCredentials>,
  evidence: KnowledgeEvidence, testInfo: TestInfo): Promise<KnowledgeSession> {
  const english = testInfo.project.use.locale === 'en-US';
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport as { width: number; height: number },
    isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch,
    locale: english ? 'en-US' : 'zh-CN', serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' });
  await context.addInitScript(language => localStorage.setItem('language', language), english ? 'en' : 'zh-CN');
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  let phase = 'pre-auth';
  let observedHeaders: Record<string, string> | undefined;
  let verifiedUserId: string | undefined;
  let appdataIdentityVerified = false;
  let appdataIdentityFailure: Error | undefined;
  const pending = new Set<Promise<unknown>>();
  const pendingLabels = new Map<Promise<unknown>, string>();
  const track = (operation: Promise<unknown>, label: string) => {
    const task = operation.catch(error => evidence.report.captureErrors.push(redact(error.message)))
      .finally(() => { pending.delete(task); pendingLabels.delete(task); });
    pending.add(task);
    pendingLabels.set(task, label);
  };
  page.on('console', message => {
    if (message.type() === 'error') evidence.report.consoleErrors.push({
      phase, text: redact(message.text()), location: message.location() });
  });
  page.on('pageerror', error => evidence.report.pageErrors.push({ phase, text: redact(error.message) }));
  page.on('requestfailed', request => evidence.report.failedRequests.push({
    phase, path: new URL(request.url()).pathname, error: redact(request.failure()?.errorText) }));
  page.on('request', request => track((async () => {
    if (!request.url().startsWith(`${knowledgeOrigin}${knowledgeApi}/`)) return;
    const headers = request.headers();
    if (headers.authorization && headers.srfsystemid && headers.srforgid) {
      observedHeaders = { accept: 'application/json', authorization: headers.authorization,
        srfsystemid: headers.srfsystemid, srforgid: headers.srforgid };
    }
  })(), `request headers ${request.method()} ${new URL(request.url()).pathname}`));
  page.on('response', response => track((async () => {
    const url = new URL(response.url());
    const request = response.request();
    const responsePhase = phase;
    const isServedResource = url.origin === knowledgeOrigin &&
      ['document', 'script', 'stylesheet'].includes(request.resourceType()) && response.status() === 200;
    const servedBody = isServedResource ? boundedKnowledgeCapture(response.body(),
      `served body ${url.pathname}`).then(
      bytes => ({ bytes }), error => ({ error })) : undefined;
    const headers = request.headers();
    const row = { phase: responsePhase, path: url.pathname, method: request.method(), status: response.status() };
    if (response.status() >= 400) {
      if (response.status() === 401 && !headers.authorization &&
          [`${knowledgeApi}/appdata`, `${knowledgeApi}/uaa/getbydcsystem/ibizplm`].includes(url.pathname)) {
        evidence.report.expectedPreAuth.push({ path: url.pathname, status: response.status() });
      } else evidence.report.httpErrors.push(row);
    }
    if (url.pathname.startsWith(`${knowledgeApi}/`)) evidence.report.apiResponses.push(row);
    if (url.pathname === `${knowledgeApi}/appdata` && response.status() === 200) {
      const body = await boundedKnowledgeCapture(response.json(), 'appdata identity body');
      const actualSystem = body.context?.srfsystemid;
      const actualOrganization = body.context?.srforgid;
      let identityMatches = false;
      try { identityMatches = Boolean(headers.authorization) &&
        validateKnowledgeIdentity(body.context, headers, credentials); } catch { /* Recorded below before any write. */ }
      evidence.report.appdata.push({ permissionValidation: body.enablepermissionvalid,
        requestSystem: headers.srfsystemid, actualSystem, dcSystem: body.context?.srfdcsystemid,
        organizationMatchesRequest: actualOrganization === headers.srforgid, identityMatches,
        rolesSha256: digest(JSON.stringify(body.context?.roles ?? null)), identitySha256: digest(JSON.stringify({
          user: body.context?.srfuserid, organization: body.context?.srforgid, system: body.context?.srfsystemid })) });
      if (!identityMatches) {
        appdataIdentityFailure = new Error('Normal PLM appdata returned a system or organization inconsistent with its actual request');
        evidence.append('appdata-identity-mismatch-before-business-writes', {
          requestSystem: headers.srfsystemid, actualSystem,
          organizationMatchesRequest: actualOrganization === headers.srforgid });
      } else {
        appdataIdentityVerified = true;
        verifiedUserId = body.context.srfuserid;
      }
    }
    if (servedBody) {
      const result = await servedBody;
      let bytes: Buffer;
      let source = 'observed-browser-response';
      if ('error' in result) {
        const etag = response.headers().etag;
        if (!etag || etag.startsWith('W/') || request.method() !== 'GET') {
          throw new Error(`Served resource ${url.pathname}: ${result.error.message}`);
        }
        const readback = await context.request.get(url.href, {
          headers: { 'If-Match': etag }, timeout: 10_000,
        });
        expect(readback.status(), 'Conditional static readback must retain the observed resource version').toBe(200);
        expect(readback.headers().etag).toBe(etag);
        bytes = await readback.body();
        source = 'conditional-readback-of-observed-resource';
        evidence.report.resourceReadbackRetries.push({ path: url.pathname, etag,
          reason: redact(result.error.message), result: 'same-etag-readback' });
      } else bytes = result.bytes;
      evidence.report.servedBytes.push({ path: url.pathname, source, bytes: bytes.length, sha256: digest(bytes) });
    }
  })(), `response ${response.status()} ${new URL(response.url()).pathname}`));
  const quiet = () => settleKnowledgeCaptures(pending, pendingLabels);
  const session: KnowledgeSession = {
    page, context, quiet,
    userId() {
      if (!appdataIdentityVerified || !verifiedUserId || appdataIdentityFailure) {
        throw new Error('Current PLM user identity has not been verified');
      }
      return verifiedUserId;
    },
    async request(method, suffix, data, expected = [200]) {
      if (!suffix.startsWith('/') || suffix.includes('..')) throw new Error('Only an exact native knowledge route is allowed');
      await quiet();
      if (appdataIdentityFailure) throw appdataIdentityFailure;
      if (!appdataIdentityVerified) throw new Error('Current PLM appdata identity has not been verified');
      if (!observedHeaders) throw new Error('No normal UI application headers have been observed');
      const response = await context.request.fetch(`${knowledgeOrigin}${knowledgeApi}${suffix}`, {
        method, headers: observedHeaders, ...(data === undefined ? {} : { data }) });
      const bytes = await response.body();
      const bodySnapshot = `native-response-${String(evidence.report.apiResponses.length).padStart(4, '0')}.private.json`;
      const descriptor = fs.openSync(testInfo.outputPath(bodySnapshot), 'wx', 0o600);
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      const row = { source: 'native-api-with-ui-issued-headers', method,
        path: `${knowledgeApi}${suffix}`, status: response.status(), bytes: bytes.length,
        sha256: digest(bytes), bodySnapshot };
      evidence.report.apiResponses.push(row);
      if (response.status() >= 400 && expected.includes(response.status())) evidence.report.expectedDenials.push(row);
      expect(expected, `${method} ${suffix} must return an explicitly expected status`).toContain(response.status());
      return bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
    },
    async close() {
      let failure: unknown;
      try { await quiet(); } catch (error) { failure = error; }
      try { await context.close(); } catch (error) { failure ??= error; }
      try { await quiet(); } catch (error) { failure ??= error; }
      if (failure) throw failure;
    },
  };
  try {
    await page.goto(knowledgeEntry, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="text"]').first().fill(credentials.username);
    await page.locator('input[type="password"]').first().fill(credentials.password);
    phase = 'login-submitted';
    const loggedIn = await performKnowledgeAction(page, response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${knowledgeApi}/v7/login`,
    () => page.getByRole('button', { name: /^(?:登录|登陆|Log\s?in|Sign\s?in)$/i }).first().click());
    expect(loggedIn.status()).toBe(200);
    await expect(page.locator('.ibiz-control-appmenu-plm_menu')).toBeVisible();
    phase = 'authenticated';
    await quiet();
    if (appdataIdentityFailure) throw appdataIdentityFailure;
    if (!appdataIdentityVerified) throw new Error('Normal login did not verify the current PLM appdata identity');
    if (!observedHeaders) throw new Error('Login did not produce normal native request headers');
    evidence.report.sessions.push({ usernameSha256: digest(credentials.username),
      declaredRole: credentials.declaredRole, normalUiLogin: true, tokenInjected: false,
      organizationSha256: digest(observedHeaders.srforgid), system: observedHeaders.srfsystemid });
    return session;
  } catch (error) {
    await session.close().catch(closeError => evidence.report.captureErrors.push(String(closeError.message)));
    throw error;
  }
}
