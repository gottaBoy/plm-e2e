import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCoverage, pluginRegistrations, reportRows, scopedPluginCoverage,
  isPersistentManagementRequest, navigationWorkflows, requiredWorkflows,
  strictTestPassed, workflowEvidencePassed,
} from '../scripts/isolated-functional-coverage.mjs';

const ref = '@ibiz-template-plm/person-select@0.0.3-alpha.434';
const title = 'person select searches, selects and clears a real contextual product member';
function interactionEvidence(overrides = {}) {
  return {
    fixtureAcceptance: false, nativeAcceptance: false,
    pageErrors: [], consoleErrors: [],
    requests: [{ status: 200, method: 'POST', url: 'http://127.0.0.1/api/users/fetch_default' }],
    checkpoints: requiredWorkflows.flatMap(workflow => workflow.checkpoints || []),
    business: {
      defaultMemberDeduplicated: true, repeatedSelectionDeduplicated: true,
      pickerSelectionRemovalVerified: true, allDirectoryUsersSelected: true,
      persistedMemberUniquenessAndAdminRoleVerified: true, uiDeleted: true,
      requiredValidationErrors: ['required'], identifierValidationErrors: ['identifier'],
      initialUsers: ['user-one', 'user-two'],
    },
    cleanup: { wizardClosed: true, persistentProductRequests: 0, ids: ['owned'],
      responses: [{ id: 'owned', status: 200 }], remains: [] },
    ...overrides,
  };
}
function row(project, overrides = {}) {
  return {
    file: 'isolated-plugin-functional.spec.ts', title, project,
    expectedStatus: 'passed', status: 'expected',
    results: [{
      status: 'passed', errors: [],
      attachments: [{ name: 'browser-evidence', path: `${project}.json` }],
    }],
    ...overrides,
  };
}

test('AST preserves actual versioned plugin registrations and line references', () => {
  const registrations = pluginRegistrations(`
    export default { appPFPluginRefs: [{
      rtobjectRepo: '${ref}', pluginCode: 'PERSON_SELECT',
      rtobjectName: 'IBizPersonelSelect', id: 'person'
    }] };
  `);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].ref, ref);
  assert.equal(registrations[0].pluginCode, 'PERSON_SELECT');
  assert.equal(registrations[0].line, 2);
});

test('report traversal retains native failures and skips instead of only counting green specs', () => {
  const rows = reportRows({ suites: [{ suites: [{
    file: 'probe.spec.ts', specs: [{ title: 'probe', tests: [{
      projectName: 'mobile', expectedStatus: 'passed', status: 'skipped',
      results: [{ status: 'skipped', errors: [] }],
    }] }],
  }] }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project, 'mobile');
  assert.equal(rows[0].status, 'skipped');
});

test('asset identity and unknown plugins do not grant functional acceptance', () => {
  const coverage = scopedPluginCoverage([ref, 'unknown@1'], [], () => {
    throw new Error('should not load absent evidence');
  });
  assert(coverage.every(plugin => !plugin.scopedInteractionCovered));
  assert(coverage.every(plugin => plugin.nativeAcceptance === false && plugin.functionalAcceptance === false));
});

test('desktop and mobile real evidence only grants bounded interaction coverage', () => {
  const [coverage] = scopedPluginCoverage([ref], [row('desktop'), row('mobile')], interactionEvidence);
  assert.equal(coverage.scopedInteractionCovered, true);
  assert.equal(coverage.nativeAcceptance, false);
  assert.equal(coverage.functionalAcceptance, false);
});

test('fixture, missing evidence, expected failures and skips never pass the native interaction boundary', () => {
  for (const failing of [
    row('mobile', { results: [{ status: 'skipped', errors: [] }] }),
    row('mobile', { expectedStatus: 'failed' }),
    row('mobile', { status: 'unexpected' }),
  ]) {
    const [coverage] = scopedPluginCoverage([ref], [row('desktop'), failing], () => ({
      fixtureAcceptance: false,
    }));
    assert.equal(coverage.scopedInteractionCovered, false);
  }
  const [fixture] = scopedPluginCoverage([ref], [row('desktop'), row('mobile')], () => ({
    fixtureAcceptance: true,
  }));
  assert.equal(fixture.scopedInteractionCovered, false);
  const [missing] = scopedPluginCoverage([ref], [row('desktop'), row('mobile')], () => undefined);
  assert.equal(missing.scopedInteractionCovered, false);
});

test('repeated reports cannot silently combine different runs into one plugin acceptance', () => {
  assert.throws(() => scopedPluginCoverage([ref], [row('desktop'), row('desktop')], () => ({
    fixtureAcceptance: false,
  })), /do not merge repeated runs/);
});

test('member-selection attachments preserve failed and missing required pickup workflows', () => {
  const ref = '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311';
  const title = 'native member picker preserves multi-selection across filtering and discards canceled selections';
  const rows = ['desktop', 'mobile'].map(project => ({
    ...row(project),
    file: 'isolated-member-selection.spec.ts',
    title,
    results: [{ status: 'passed', errors: [], attachments: [{
      name: 'member-selection-evidence', path: `${project}.json`,
    }] }],
  }));
  const [covered] = scopedPluginCoverage([ref], rows, interactionEvidence);
  const pickup = covered.checks.find(check => check.title === title);
  assert(pickup.projects.every(project => project.status === 'scoped-passed'));
  assert.equal(covered.scopedInteractionCovered, false, 'required product CRUD is still unverified');
  assert.equal(covered.functionalAcceptance, false);
  rows[1].results[0].status = 'failed';
  const [failed] = scopedPluginCoverage([ref], rows, interactionEvidence);
  assert.equal(failed.checks.find(check => check.title === title).projects[1].status, 'failed-or-unbound');
});

test('coverage rejects mismatched source, served bytes, and browser dist identity', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plm-coverage-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, data) => {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, typeof data === 'string' ? data : JSON.stringify(data));
    return destination;
  };
  const model = `export default { refs: [{rtobjectRepo: '${ref}'}] };`;
  write('source/src/publish/model/app/app.ts', model);
  write('source/tools/plugin-recovery/runtime-plugins.txt', ref);
  const file = { path: `plugins/${ref}/package.json`, sha256: 'plugin-hash' };
  const identity = {
    fixtureAcceptance: false, failures: [], pluginCount: 1,
    sourceSha256: 'source-hash', distSha256: 'dist-hash', imageDistSha256: 'dist-hash',
    baseUrl: 'http://127.0.0.1:30252/ibizplm-plmweb/', distRoot: path.join(root, 'source/dist'),
    httpFiles: [{ ...file, httpSha256: file.sha256, status: 200 }],
  };
  write('identity.json', identity);
  write('build-receipt.json', {
    sourceInputs: { before: {
      sha256: identity.sourceSha256,
      entries: [{
        path: 'src/publish/model/app/app.ts',
        sha256: createHash('sha256').update(model).digest('hex'),
      }],
    } },
    dist: { sha256: identity.distSha256 },
    pluginOutputs: { pluginCount: 1, files: [file] },
  });
  for (const project of ['desktop', 'mobile']) {
    write(`${project}.json`, interactionEvidence({
      baseUrl: identity.baseUrl, distRoot: identity.distRoot,
    }));
  }
  const reportRowsFixture = ['desktop', 'mobile'].map(project => {
    const entry = row(project);
    return {
      projectName: project, expectedStatus: entry.expectedStatus, status: entry.status,
      results: [{
        ...entry.results[0],
        attachments: [{ name: 'browser-evidence', path: path.join(root, `${project}.json`) }],
      }],
    };
  });
  const reportPath = write('report.json', {
    suites: [{ file: 'isolated-plugin-functional.spec.ts', specs: [{ title, tests: reportRowsFixture }] }],
  });
  const valid = buildCoverage(root, [reportPath]);
  assert.equal(valid.counts.withScopedInteractionEvidence, 1);
  assert.equal(valid.nativeAcceptance, false);
  assert.equal(valid.requiredMatrixPassed, false);
  assert.equal(valid.counts.requiredChecks, 31);
  assert.equal(valid.counts.unmetRequiredChecks, 29, 'unexecuted required workflows cannot disappear');
  assert.equal(valid.counts.failedRequiredChecks, 0);
  assert.equal(valid.counts.unverifiedRequiredChecks, 29);
  assert.equal(valid.counts.skippedRequiredChecks, 0);
  identity.httpFiles[0].httpSha256 = 'another-build';
  write('identity.json', identity);
  assert.throws(() => buildCoverage(root, [reportPath]), /package.json/);
  identity.httpFiles[0].httpSha256 = file.sha256;
  write('identity.json', identity);
  write('mobile.json', {
    fixtureAcceptance: false, baseUrl: identity.baseUrl, distRoot: path.join(root, 'old/dist'),
  });
  assert.throws(() => buildCoverage(root, [reportPath]), /another dist/);
  write('source/src/publish/model/app/app.ts', `${model}\n// modified after build`);
  assert.throws(() => buildCoverage(root, [reportPath]), /built snapshot/);
});

test('scoped coverage rejects prior failures, retries, browser/HTTP errors and absent checkpoints', () => {
  for (const results of [
    [{ status: 'failed', errors: [] }, { status: 'passed', errors: [] }],
    [{ status: 'passed', errors: [], retry: 1 }],
    [{ status: 'passed', errors: [], error: { message: 'late failure' } }],
    [],
  ]) assert.equal(strictTestPassed(row('mobile', { results })), false);
  for (const evidence of [
    interactionEvidence({ pageErrors: ['uncaught'] }),
    interactionEvidence({ consoleErrors: ['bad response'] }),
    interactionEvidence({ requests: [{ status: 404 }] }),
    interactionEvidence({ requests: [] }),
    interactionEvidence({ requests: [{ status: undefined }] }),
    interactionEvidence({ checkpoints: [] }),
    interactionEvidence({ evidenceCaptureErrors: ['page closed'] }),
    interactionEvidence({ nativeAcceptance: true }),
  ]) {
    const [coverage] = scopedPluginCoverage([ref], [row('desktop'), row('mobile')], () => evidence);
    assert.equal(coverage.scopedInteractionCovered, false);
  }
  const duplicate = row('mobile');
  duplicate.results[0].attachments.push({ ...duplicate.results[0].attachments[0] });
  const [coverage] = scopedPluginCoverage([ref], [row('desktop'), duplicate], interactionEvidence);
  assert.equal(coverage.scopedInteractionCovered, false);
});

function fullMatrixFixture(t) {
  // Controlled contract fixture only; it is never native or deployment evidence.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plm-full-matrix-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
    return target;
  };
  const hash = 'a'.repeat(64);
  const model = `export default { refs: [{rtobjectRepo: '${ref}'}] };`;
  write('source/src/publish/model/app/app.ts', model);
  write('source/tools/plugin-recovery/runtime-plugins.txt', ref);
  const identity = {
    fixtureAcceptance: false, failures: [], pluginCount: 1,
    sourceSha256: hash, distSha256: hash, imageDistSha256: hash,
    baseUrl: 'http://127.0.0.1:30252/ibizplm-plmweb/', distRoot: path.join(root, 'source/dist'),
    httpFiles: [{ path: `plugins/${ref}/package.json`, sha256: hash, httpSha256: hash, status: 200 }],
  };
  write('identity.json', identity);
  write('build-receipt.json', {
    sourceInputs: { before: { sha256: hash, entries: [{
      path: 'src/publish/model/app/app.ts',
      sha256: createHash('sha256').update(model).digest('hex'),
    }] } },
    dist: { sha256: hash }, pluginOutputs: { pluginCount: 1, files: [{
      path: `plugins/${ref}/package.json`, sha256: hash,
    }] },
  });
  const specs = requiredWorkflows.flatMap((workflow, index) => ['desktop', 'mobile'].map(project => {
    const evidence = interactionEvidence({
      baseUrl: identity.baseUrl, distRoot: identity.distRoot,
      counter: { status: 200, value: 0 },
      iframe: { path: '/modeldesign/', rendered: true },
      appIdentity: { codeName: 'ModelDesign', sysCodeName: 'ibizmodeling' },
      errors: [], menu: workflow.menu, labels: ({
        工作台: ['首页', '仪表盘', '工时'], 产品管理: [], 项目管理: [],
        资源管理: ['工时日历', '工时日志'],
      })[workflow.menu] || [], panes: [{
        left: { width: 200, height: 100 }, right: { width: 200, height: 100 },
        outer: { width: 400, height: 100 },
      }],
      failures: [], pluginCount: 1, fileCount: 1,
      files: [{ ref, path: 'package.json', status: 200, localSha256: hash, httpSha256: hash }],
      ...navigationEvidence(workflow),
    });
    const name = workflow.attachment || 'browser-evidence';
    const attachment = name === 'responsive-native-navigation'
      ? { name, body: Buffer.from(JSON.stringify(evidence)).toString('base64') }
      : { name, path: write(`evidence/${index}-${project}.json`, evidence) };
    return {
      file: workflow.file, title: workflow.title,
      tests: [{ projectName: project, expectedStatus: 'passed', status: 'expected',
        results: [{ status: 'passed', errors: [], retry: 0, attachments: [attachment] }] }],
    };
  }));
  specs.push({ file: 'auth.setup.ts', title: 'authenticate local PLM', tests: [{
    projectName: 'setup', expectedStatus: 'passed', status: 'expected',
    results: [{ status: 'passed', errors: [] }],
  }] });
  const report = { suites: [{ specs }], errors: [] };
  const reportPath = write('report.json', report);
  return { root, write, report, reportPath };
}

test('complete bounded matrix remains non-native; report errors and omitted mobile/IDE/setup gates fail closed', t => {
  const fixture = fullMatrixFixture(t);
  const passed = buildCoverage(fixture.root, [fixture.reportPath]);
  assert.equal(passed.requiredMatrixPassed, true);
  assert.equal(passed.counts.passedRequiredChecks, 31);
  assert.equal(passed.nativeAcceptance, false);
  assert.equal(passed.functionalAcceptance, false);
  fixture.report.errors.push({ message: 'global teardown failed' });
  fixture.write('report.json', fixture.report);
  const runnerFailed = buildCoverage(fixture.root, [fixture.reportPath]);
  assert.equal(runnerFailed.requiredMatrixPassed, false);
  assert.equal(runnerFailed.counts.runnerErrors, 1);
  fixture.report.errors = [];
  fixture.report.suites[0].specs = fixture.report.suites[0].specs.filter(spec =>
    spec.tests[0].projectName !== 'mobile' && spec.file !== 'modeling-ide.spec.ts' &&
    spec.file !== 'auth.setup.ts');
  fixture.write('report.json', fixture.report);
  const omitted = buildCoverage(fixture.root, [fixture.reportPath]);
  assert.equal(omitted.requiredMatrixPassed, false);
  assert.equal(omitted.counts.unmetRequiredChecks, 17);
  assert(omitted.unmetChecks.some(check => check.file === 'modeling-ide.spec.ts'));
});

test('coverage CLI writes failures and returns nonzero for runner, parse and absent-input errors', t => {
  const fixture = fullMatrixFixture(t);
  const script = path.resolve('scripts/isolated-functional-coverage.mjs');
  const run = (output, reports) => spawnSync(process.execPath, [script, fixture.root, output, ...reports], {
    encoding: 'utf8',
  });
  const passOutput = path.join(fixture.root, 'pass-output.json');
  assert.equal(run(passOutput, [fixture.reportPath]).status, 0);
  fixture.report.errors.push({ message: 'teardown' });
  fixture.write('report.json', fixture.report);
  const errorOutput = path.join(fixture.root, 'runner-failed.json');
  assert.equal(run(errorOutput, [fixture.reportPath]).status, 1);
  assert.equal(JSON.parse(fs.readFileSync(errorOutput)).requiredMatrixPassed, false);
  fixture.write('invalid.json', '{');
  for (const [index, reportPath] of ['invalid.json', 'absent.json'].entries()) {
    const output = path.join(fixture.root, `failed-${index}.json`);
    assert.equal(run(output, [path.join(fixture.root, reportPath)]).status, 1);
    const failure = JSON.parse(fs.readFileSync(output));
    assert.equal(failure.status, 'failed');
    assert.equal(failure.nativeAcceptance, false);
    assert(failure.failure);
  }
  const before = fs.readFileSync(errorOutput, 'utf8');
  assert.notEqual(run(errorOutput, [fixture.reportPath]).status, 0);
  assert.equal(fs.readFileSync(errorOutput, 'utf8'), before, 'prior receipt must remain unchanged');
});

test('HTTP identity omissions and cleanup errors cannot satisfy required coverage', t => {
  const fixture = fullMatrixFixture(t);
  const httpSpec = fixture.report.suites[0].specs.find(spec =>
    spec.title === 'isolated HTTP plugin outputs match the dist under test');
  const attachment = httpSpec.tests[0].results[0].attachments[0];
  const evidence = JSON.parse(fs.readFileSync(attachment.path));
  evidence.files[0].path = 'unbuilt.js';
  fs.writeFileSync(attachment.path, JSON.stringify(evidence));
  const failed = buildCoverage(fixture.root, [fixture.reportPath]);
  assert.equal(failed.requiredMatrixPassed, false);
  assert(failed.unmetChecks.some(check => check.title === httpSpec.title));
  const crud = requiredWorkflows.find(workflow => workflow.title.includes('cleans up its own product'));
  const [plugin] = scopedPluginCoverage(
    ['@ibiz-template-plm/group-tree@0.0.3-alpha.252'],
    ['desktop', 'mobile'].map(project => ({
      ...row(project), file: crud.file, title: crud.title,
      results: [{ status: 'passed', errors: [],
        attachments: [{ name: 'product-workflow-evidence', path: 'cleanup.json' }] }],
    })),
    () => interactionEvidence({ cleanup: { ids: ['owned'], responses: [{ status: 500 }], remains: [] } }),
  );
  assert.equal(plugin.scopedInteractionCovered, false);
});

test('required count breakdown retains failures, skips and missing rows without promoting them', t => {
  const fixture = fullMatrixFixture(t);
  const specs = fixture.report.suites[0].specs;
  specs[0].tests[0].results[0].status = 'failed';
  specs[0].tests[0].status = 'unexpected';
  specs[1].tests[0].results[0].status = 'skipped';
  specs[1].tests[0].status = 'skipped';
  specs.splice(2, 1);
  fixture.write('report.json', fixture.report);
  const coverage = buildCoverage(fixture.root, [fixture.reportPath]);
  assert.equal(coverage.counts.requiredChecks, 31);
  assert.equal(coverage.counts.passedRequiredChecks, 28);
  assert.equal(coverage.counts.failedRequiredChecks, 1);
  assert.equal(coverage.counts.unverifiedRequiredChecks, 1);
  assert.equal(coverage.counts.skippedRequiredChecks, 1);
  assert.equal(coverage.requiredMatrixPassed, false);
  assert.equal(coverage.nativeAcceptance, false);
  assert.equal(coverage.functionalAcceptance, false);
});

function navigationEvidence(workflow) {
  if (workflow.attachment !== 'plugin-navigation-evidence') return {};
  return {
    requests: workflow.refs.map(ref => ({
      url: `http://127.0.0.1/plugins/${ref}/dist/index.es.js`, method: 'GET', status: 200,
    })),
    readiness: workflow.checkpoints.map(checkpoint => ({
      checkpoint, startupHidden: true, loadingMasks: 0,
    })),
    navigation: { back: true, forward: true, reload: true },
    datasets: workflow.panels.filter(panel => panel[2]).map(([, , dataset]) => ({
      url: `http://127.0.0.1/api/${dataset}/fetch_default`, status: 200, rows: 0,
    })),
    transitions: workflow.panels.map(([key, view, dataset]) => dataset ? {
      item: key, view, dataset, url: `/management_setting_view/srfnav=${key}/`,
      grid: { width: 262, height: 300 }, rows: 0, emptyState: 1,
      ...(workflow.commands?.find(command => command.item === key) ? {
        command: {
          name: workflow.commands.find(command => command.item === key).name,
          title: workflow.commands.find(command => command.item === key).name,
          text: workflow.commands.find(command => command.item === key).name,
          visible: true,
          enabled: true,
          width: 108, height: 32, points: [true, true, true],
          dialog: {
            view: workflow.commands.find(command => command.item === key).view,
            opened: true, canceled: true, headerClosed: true,
            close: { inViewport: true, width: 32, height: 32, points: [true, true, true] },
            closeConfirmation: { canceled: true, retainedValue: true, confirmed: true, draftDiscarded: true },
            bounds: { width: 390, height: 240 },
            fields: workflow.commands.find(command => command.item === key).fields.map(name => ({
              name, width: 250, height: 32, points: [true, true, true],
            })),
            buttons: ['确定', '取消'].map(name => ({
              name, width: 60, height: 32, points: [true, true, true],
            })),
          },
        },
      } : {}),
    } : {
      group: key, view, selected: 'true', url: `/product_index_view/srfnav=${key}/`,
      panel: { width: 278, height: 520 }, control: { width: 278, height: 140 },
    }),
  };
}

test('required native navigation rejects blank/loading checkpoints, crushed grids and incomplete panels', () => {
  for (const workflow of navigationWorkflows) {
    const valid = interactionEvidence(navigationEvidence(workflow));
    assert.equal(workflowEvidencePassed(workflow, valid), true);
    for (const mutate of [
      evidence => { evidence.navigation.reload = false; },
      evidence => { evidence.readiness[0].startupHidden = false; },
      evidence => { evidence.readiness[0].loadingMasks = 1; },
      evidence => { evidence.transitions.pop(); },
      evidence => { evidence.requests = []; },
      evidence => { evidence.requests.push({ method: 'DELETE', status: 200, url: '/api/products/real' }); },
      evidence => { evidence.fixtureAcceptance = true; },
    ]) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      assert.equal(workflowEvidencePassed(workflow, invalid), false);
    }
  }
  const management = navigationWorkflows[1];
  for (const mutate of [
    evidence => { evidence.transitions[0].grid.width = 105.34375; },
    evidence => { evidence.transitions[0].grid.height = 100; },
    evidence => { evidence.transitions[0].emptyState = 0; },
    evidence => { evidence.datasets = []; },
  ]) {
    const invalid = interactionEvidence(navigationEvidence(management));
    mutate(invalid);
    assert.equal(workflowEvidencePassed(management, invalid), false);
  }
});

test('required management commands reject absent, mislabeled and clipped native hit evidence', () => {
  const workflow = navigationWorkflows[1];
  for (const item of ['workload', 'print']) {
    for (const mutate of [
      transition => { delete transition.command; },
      transition => { transition.command.name = 'unrelated action'; },
      transition => { transition.command.width = 66.7; },
      transition => { transition.command.height = 0; },
      transition => { delete transition.command.points; },
      transition => { transition.command.points = [true, true]; },
      transition => { transition.command.points = [true, true, false]; },
      transition => { transition.command.points = [true, 'true', true]; },
      transition => { delete transition.command.title; },
      transition => { transition.command.title = 'unrelated action'; },
      transition => { transition.command.text = ''; },
      transition => { transition.command.visible = false; },
      transition => { transition.command.enabled = false; },
      transition => { delete transition.command.dialog; },
      transition => { transition.command.dialog.view = 'unrelated_view'; },
      transition => { transition.command.dialog.opened = false; },
      transition => { transition.command.dialog.canceled = false; },
      transition => { transition.command.dialog.headerClosed = false; },
      transition => { transition.command.dialog.close.inViewport = false; },
      transition => { transition.command.dialog.close.points[0] = false; },
      transition => { delete transition.command.dialog.close; },
      transition => { delete transition.command.dialog.closeConfirmation; },
      transition => { transition.command.dialog.closeConfirmation.canceled = false; },
      transition => { transition.command.dialog.closeConfirmation.retainedValue = false; },
      transition => { transition.command.dialog.closeConfirmation.confirmed = false; },
      transition => { transition.command.dialog.closeConfirmation.draftDiscarded = false; },
      transition => { transition.command.dialog.bounds.width = 0; },
      transition => { transition.command.dialog.fields.pop(); },
      transition => { transition.command.dialog.fields[0].points[2] = false; },
      transition => { transition.command.dialog.buttons[1].points[0] = false; },
    ]) {
      const invalid = interactionEvidence(navigationEvidence(workflow));
      mutate(invalid.transitions.find(transition => transition.item === item));
      assert.equal(workflowEvidencePassed(workflow, invalid), false, item);
    }
  }
  for (const url of [
    '/api/ibizplm__plmweb/workload_types',
    '/api/ibizplm__plmweb/extend_print_templs',
  ]) {
    const invalid = interactionEvidence(navigationEvidence(workflow));
    invalid.requests.push({ method: 'POST', url, status: 200 });
    assert.equal(workflowEvidencePassed(workflow, invalid), false, url);
  }
});

test('native POST management datasets are read-only while writes and unknown actions remain rejected', () => {
  const workflow = navigationWorkflows[1];
  const valid = interactionEvidence(navigationEvidence(workflow));
  for (const entity of ['workload_types', 'extend_print_templs']) {
    for (const url of [
      `/api/ibizplm__plmweb/${entity}/fetch_default`,
      `http://127.0.0.1:30252/api/ibizplm__plmweb/${entity}/fetch_default?page=0`,
    ]) {
      const request = { method: 'POST', url, status: 200 };
      assert.equal(isPersistentManagementRequest(request), false);
      valid.requests.push(request);
    }
    for (const pathname of [
      '', '/', '/save', '/owned/delete', '/owned/fetch_default',
      '/fetch_default/delete', '/unknown_action',
    ]) {
      const request = { method: 'POST', url: `/api/ibizplm__plmweb/${entity}${pathname}`, status: 200 };
      assert.equal(isPersistentManagementRequest(request), true, request.url);
      const invalid = structuredClone(valid);
      invalid.requests.push(request);
      assert.equal(workflowEvidencePassed(workflow, invalid), false);
    }
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      assert.equal(isPersistentManagementRequest({
        method, url: `/api/ibizplm__plmweb/${entity}/fetch_default`,
      }), true);
    }
  }
  assert.equal(workflowEvidencePassed(workflow, valid), true);
});
