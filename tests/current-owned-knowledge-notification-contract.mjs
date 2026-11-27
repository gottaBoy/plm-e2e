import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const workspace = [process.cwd(), path.resolve(process.cwd(), '..')].find(directory =>
  fs.existsSync(path.join(directory, 'plm-e2e/package.json'))
  && fs.existsSync(path.join(directory, 'plm/model/PSSYSTEM.json')));
assert.ok(workspace, 'Run the knowledge notification contract within the workspace or plm-e2e');
const projectRequire = createRequire(path.join(workspace, 'plm-web/package.json'));
const compilerRequire = createRequire(projectRequire.resolve('vue'));
const parseHtml = compilerRequire('@vue/compiler-dom').parse;
export const notificationDigest = value => createHash('sha256').update(value).digest('hex');
const identifier = /^[A-Za-z0-9_-]{1,100}$/;
const resultDirectory = 'test-results/current-owned-knowledge-li-d1f9d-nd-public-sharing-lifecycle-knowledge-zh-desktop';
export const knowledgeNotificationSourceReceipts = Object.freeze([
  ['b01-knowledge-closeout-20261126-r1', 'e4f7182ddc3a3055781fee755b3bcc45bd365103ea72307afbb64564487b29ef'],
  ['b01-knowledge-closeout-20261126-r2', '2662895f3dec0e870951b1811dce939006a369e94db344e83f6a999909dd62d6'],
  ['b01-knowledge-closeout-20261126-r3', 'c5822ab29a049fe233d2b4219a196401ed83b35661f85782c6dba4ae5a3ae601'],
].map(([directory, sha256]) => Object.freeze({
  receipt: `.artifacts/${directory}/${resultDirectory}/knowledge-lifecycle-evidence.private.json`,
  journal: `.artifacts/${directory}/${resultDirectory}/knowledge-owned-journal.private.jsonl`, sha256,
})));

export const knowledgeNotificationRules = Object.freeze([
  Object.freeze({ template: 'space_member_create', event: '把你加入了空间', linked: true, objectIdentifier: false }),
  Object.freeze({ template: 'space_member_remove', event: '把你移除了空间', linked: false, objectIdentifier: false }),
  Object.freeze({ template: 'space_remove_or_recover', event: '删除了空间', linked: false, objectIdentifier: true }),
]);

export function knowledgeNotificationPrivateRead(filename, root = workspace) {
  assert.ok(path.isAbsolute(filename));
  const artifacts = path.join(root, '.artifacts');
  assert.ok(filename.startsWith(`${artifacts}/`));
  assert.equal(fs.realpathSync(filename), path.resolve(filename));
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && before.uid === process.geteuid() && before.nlink === 1
    && !(before.mode & 0o077) && before.size < 16 * 1024 * 1024);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(fd);
    for (const after of [fs.fstatSync(fd), fs.lstatSync(filename)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

export function validateKnowledgeNotificationSource(receipt, journal, usernameSha256) {
  assert.equal(receipt.contract, 'current-owned-knowledge-lifecycle-v1');
  assert.equal(receipt.status, 'FAILED', 'The original knowledge failure must stay a failure');
  assert.match(receipt.marker ?? '', /^CK-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(receipt.identifier ?? '', /^CK[A-F0-9]{12}$/);
  assert.ok(receipt.sessions.length >= 1);
  for (const session of receipt.sessions) {
    assert.equal(session.usernameSha256, usernameSha256);
    assert.equal(session.normalUiLogin, true);
    assert.equal(session.tokenInjected, false);
    assert.equal(session.system, 'ibizplm');
  }
  assert.equal(receipt.sourceInputsStable, true);
  assert.equal(receipt.runtimeComparison.status, 'PASS');
  assert.equal(receipt.cleanup.status, 'PASS');
  for (const field of ['remainingSpaces', 'remainingMembers', 'remainingRecentRecords']) {
    assert.equal(receipt.cleanup[field], 0);
  }
  for (const stage of ['spaceCreate', 'createdOwnerMembership', 'draftSaved',
    'freshDraftReadback', 'publish', 'draftPublicationIsolation', 'lockUnlock']) {
    assert.equal(receipt.stages[stage].status, 'PASS');
  }
  const started = Date.parse(receipt.startedAt), finished = Date.parse(receipt.finishedAt);
  assert.ok(Number.isFinite(started) && Number.isFinite(finished) && finished >= started
    && finished - started <= 240000);
  const single = stage => {
    const found = journal.filter(row => row.stage === stage);
    assert.equal(found.length, 1);
    return found[0].details;
  };
  const intent = single('intent-before-any-business-write');
  assert.equal(intent.marker, receipt.marker);
  assert.equal(intent.identifier, receipt.identifier);
  const createIntent = single('space-create-ui-intent');
  const created = single('space-created');
  const cleaned = single('cleanup-complete');
  assert.equal(createIntent.expectedVisibility, 'private');
  assert.equal(created.name, `${receipt.marker} 知识🙂`);
  assert.equal(createIntent.name, created.name);
  assert.equal(createIntent.identifier, receipt.identifier);
  assert.equal(created.identifier, receipt.identifier);
  assert.match(created.id ?? '', identifier);
  assert.equal(created.id, receipt.cleanup.spaceId);
  assert.equal(receipt.stages.spaceCreate.id, created.id);
  assert.equal(cleaned.status, 'PASS');
  assert.equal(cleaned.spaceId, created.id);
  const pageIds = [...new Set(journal.filter(row => row.stage === 'cleanup-owned-page-intent')
    .map(row => {
      assert.equal(row.details.spaceId, created.id);
      assert.match(row.details.pageId, identifier);
      return row.details.pageId;
    }))].sort();
  assert.equal(pageIds.length, receipt.cleanup.pagesRemoved);
  assert.ok(pageIds.includes(created.id));
  assert.deepEqual(pageIds, [...receipt.cleanup.knownPageIds].sort());
  assert.deepEqual(pageIds, [...cleaned.knownPageIds].sort());
  const appdata = receipt.appdata.filter(row => row.identityMatches);
  assert.ok(appdata.length > 0);
  assert.ok(appdata.every(row => /^[a-f0-9]{64}$/.test(row.identitySha256)));
  return {
    marker: receipt.marker, identifier: receipt.identifier, name: created.name, spaceId: created.id,
    knownPageIds: pageIds, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt,
    usernameSha256, organizationSha256: receipt.sessions[0].organizationSha256,
    appdataIdentitySha256: [...new Set(appdata.map(row => row.identitySha256))],
    originalStatus: 'FAILED', originalCleanup: 'PASS', fullBusinessAcceptance: false,
  };
}

export function loadKnowledgeNotificationSources(usernameSha256, root = workspace) {
  return knowledgeNotificationSourceReceipts.map(source => {
    const receiptBytes = knowledgeNotificationPrivateRead(path.join(root, source.receipt), root);
    assert.equal(notificationDigest(receiptBytes), source.sha256);
    const journalBytes = knowledgeNotificationPrivateRead(path.join(root, source.journal), root);
    const rows = journalBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    const owned = validateKnowledgeNotificationSource(JSON.parse(receiptBytes), rows, usernameSha256);
    return { ...source, journalSha256: notificationDigest(journalBytes), owned };
  });
}

export function bindKnowledgeNotificationActor(sources, identity, usernameSha256) {
  for (const key of ['srfuserid', 'srforgid', 'srfsystemid', 'srfdcsystemid']) {
    assert.ok(typeof identity[key] === 'string' && identity[key]);
  }
  assert.equal(identity.srfsystemid, 'ibizplm');
  const actual = notificationDigest(JSON.stringify({
    user: identity.srfuserid, organization: identity.srforgid, system: identity.srfsystemid,
  }));
  for (const source of sources) {
    assert.equal(source.owned.usernameSha256, usernameSha256);
    assert.equal(source.owned.organizationSha256, notificationDigest(identity.srforgid));
    assert.ok(source.owned.appdataIdentitySha256.includes(actual),
      'Current normal appdata must identify the same source actor, organization and system');
  }
}

export function persistableKnowledgeRuntimeWitness(witness) {
  assert.ok(Array.isArray(witness));
  const expected = ['plmweb', 'plmservice', 'ibizlab-uaa-api', 'ibiz-ebsx-allinone', 'ibiz-ebsx-gateway'];
  assert.deepEqual(witness.map(row => row.name).sort(), [...expected].sort());
  return witness.map(row => {
    const { provider, ...binding } = row;
    assert.match(binding.id ?? '', /^[a-f0-9]{64}$/);
    assert.match(binding.imageId ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.match(binding.configurationSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(binding.startedAt)));
    assert.ok(Number.isSafeInteger(binding.restartCount) && binding.restartCount >= 0);
    assert.ok(Array.isArray(binding.mounts));
    if (row.name === 'plmservice') {
      assert.ok(provider && typeof provider === 'object');
      assert.match(provider.sha256 ?? '', /^[a-f0-9]{64}$/);
      assert.match(provider.metadata ?? '', /^\d+ \d+ \d+ \d+ [0-7]+ \d+ \d+ \d+ \d+$/);
      return { ...binding, provider };
    }
    assert.equal(provider, undefined, 'Only the actual provider container may carry archive metadata');
    return binding;
  });
}

export function knowledgeNotificationText(html) {
  assert.equal(typeof html, 'string');
  assert.ok(!html.includes('${data.') && !html.includes('<#'));
  const tree = parseHtml(html);
  const fields = new Map();
  const text = node => node.type === 2 ? node.content : (node.children ?? []).map(text).join('');
  const visit = node => {
    if (node.type === 1) {
      assert.ok(!['script', 'iframe', 'object', 'embed'].includes(node.tag.toLowerCase()));
      assert.ok(node.props.every(prop => prop.type === 6 && !/^on/i.test(prop.name)),
        'Only inert rendered notification HTML is eligible');
      const classes = node.props.find(prop => prop.name === 'class')?.value?.content?.split(/\s+/) ?? [];
      for (const name of ['notice-card__event-desc', 'notice-card__object-name',
        'notice-card__object-id', 'notice-pilot-time', 'notice-pilot-info']) {
        if (classes.includes(name)) fields.set(name, [...fields.get(name) ?? [], {
          text: text(node).trim(), title: node.props.find(prop => prop.name === 'title')?.value?.content,
        }]);
      }
    }
    (node.children ?? []).forEach(visit);
  };
  visit(tree);
  const single = (name, optional = false) => {
    if (optional && !fields.has(name)) return undefined;
    assert.equal(fields.get(name)?.length, 1, `Exactly one field required: ${name}`);
    return fields.get(name)[0];
  };
  const name = single('notice-card__object-name');
  return {
    event: single('notice-card__event-desc').text, name: name.text, nameTitle: name.title,
    identifier: single('notice-card__object-id', true)?.text,
    pilotTime: single('notice-pilot-time').text, pilotInfo: single('notice-pilot-info').text,
  };
}

export function validateKnowledgeNotificationTemplates(system) {
  const templates = {};
  for (const rule of knowledgeNotificationRules) {
    const found = system.getAllPSSysMsgTempls.filter(row => row.codeName === rule.template);
    assert.equal(found.length, 1);
    const template = found[0];
    assert.equal(template.contentType, 'HTML');
    assert.ok(template.content.includes('notice-card__object-name') && template.content.includes('知识管理'));
    if (rule.template === 'space_remove_or_recover') {
      assert.ok(template.content.includes('<#if data.is_deleted==1>删除<#else>恢复</#if>了空间'));
      assert.ok(template.taskUrl.startsWith('<#if data.is_deleted==0>')
        && template.taskUrl.endsWith('</#if>'));
      assert.ok(template.mobTaskUrl.startsWith('<#if data.is_deleted==0>')
        && template.mobTaskUrl.endsWith('</#if>'));
    } else {
      assert.ok(template.content.includes(rule.event));
      assert.ok(template.content.includes('${data.space_name}'));
      if (rule.linked) {
        assert.ok(template.taskUrl.startsWith('route://-/index/space=${data.space_id}/space_index_view/'));
        assert.ok(template.mobTaskUrl.startsWith('route://-/home/space=${data.space_id}/article_page_mob_list_view/'));
      } else {
        assert.equal(template.taskUrl, undefined);
        assert.equal(template.mobTaskUrl, undefined);
      }
    }
    templates[rule.template] = {
      codeName: template.codeName, content: template.content, contentType: template.contentType,
      taskUrl: template.taskUrl ?? null, mobTaskUrl: template.mobTaskUrl ?? null,
    };
  }
  return templates;
}

function serverTimestamp(text) {
  assert.ok(typeof text === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text));
  const value = Date.parse(`${text.replace(' ', 'T')}+08:00`);
  assert.ok(Number.isFinite(value));
  return value;
}

function exactKnowledgeLink(value, expected) {
  assert.ok(typeof value === 'string' && value.trim());
  const actual = new URL(value.trim());
  const target = new URL(expected);
  assert.equal(actual.protocol, 'route:');
  assert.equal(actual.hostname, '-');
  assert.ok(!actual.username && !actual.password && !actual.port && !actual.search && !actual.hash);
  assert.equal(actual.href, target.href, 'The complete source-declared space route must match');
}

export function validateOwnedKnowledgeNotification(record, owned, identity, templates) {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record));
  assert.match(record.id ?? '', identifier);
  assert.equal(record.receiver, identity.srfuserid);
  assert.ok([identity.srfuserid, identity.srfpersonid].filter(Boolean).includes(record.owner_id));
  assert.equal(record.system_tag, identity.srfdcsystemid);
  assert.equal(record.owner_type, 'PERSONAL');
  assert.equal(record.content_type, 'HTML');
  assert.ok(['RECEIVED', 'READ'].includes(record.status));
  const rule = knowledgeNotificationRules.find(item => item.template === record.message_type);
  assert.ok(rule, 'Unknown notification templates cannot authorize cleanup');
  const rendered = knowledgeNotificationText(record.content);
  assert.equal(rendered.event, rule.event);
  assert.equal(rendered.name, owned.name);
  assert.equal(rendered.nameTitle, owned.name);
  assert.ok(rendered.name.includes(owned.marker));
  assert.equal(rendered.identifier, rule.objectIdentifier ? owned.identifier : undefined);
  assert.equal(rendered.pilotInfo, `· 知识管理 · ${owned.name}`);
  for (const value of [record.create_time, rendered.pilotTime]) {
    const time = serverTimestamp(value);
    assert.ok(time >= Date.parse(owned.startedAt) - 120000
      && time <= Date.parse(owned.finishedAt) + 120000, 'Message time is outside the bounded source run');
  }
  const template = templates[rule.template];
  assert.ok(template && template.codeName === record.message_type);
  for (const [field, sourceField] of [['url', 'taskUrl'], ['mobile_url', 'mobTaskUrl']]) {
    if (rule.linked) {
      const expected = template[sourceField].replaceAll('${data.space_id}', owned.spaceId);
      assert.ok(!expected.includes('${'));
      exactKnowledgeLink(record[field], expected);
    } else assert.ok(record[field] === undefined || record[field] === null || record[field] === '',
      'This exact source event declares no route');
  }
  return { id: record.id, marker: owned.marker, spaceId: owned.spaceId,
    template: rule.template, event: rule.event, status: record.status, contentSha256: notificationDigest(record.content) };
}

export function knowledgeNotificationTotal(value) {
  assert.ok(typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value));
  const total = Number(value);
  assert.ok(Number.isSafeInteger(total) && total <= 10000);
  return total;
}

export async function pageAllKnowledgeNotifications(request, identity) {
  const rows = [];
  let total;
  for (let page = 0; page < 100; page++) {
    const response = await request('POST', '/extension/internal_messages/fetch_cur_receiver',
      { page, size: 100, sort: 'timestamp,desc' });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.value) && response.value.length <= 100);
    const count = knowledgeNotificationTotal(response.headers['x-total']);
    total ??= count;
    assert.equal(count, total);
    rows.push(...response.value);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.ok(rows.length <= total);
    if (rows.length === total) break;
    assert.equal(response.value.length, 100);
  }
  assert.equal(rows.length, total);
  for (const row of rows) {
    assert.equal(row.receiver, identity.srfuserid);
    assert.equal(row.system_tag, identity.srfdcsystemid);
  }
  return rows;
}

export function planKnowledgeNotificationCleanup(rows, sources, identity, templates) {
  const owned = [], unrelated = [];
  for (const record of rows) {
    const matches = sources.filter(source => typeof record.content === 'string'
      && record.content.includes(source.owned.marker));
    if (matches.length === 0) { unrelated.push(record); continue; }
    assert.equal(matches.length, 1);
    const validated = validateOwnedKnowledgeNotification(record, matches[0].owned, identity, templates);
    owned.push({ ...validated, record });
  }
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return { owned, unrelated };
}

export function notificationStateSnapshot(rows) {
  return rows.map(row => ({ id: row.id, status: row.status,
    contentSha256: notificationDigest(JSON.stringify({
      present: Object.hasOwn(row, 'content'), value: row.content ?? null,
    })),
    receiver: row.receiver, owner_id: row.owner_id, owner_type: row.owner_type, system_tag: row.system_tag }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
