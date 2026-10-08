import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The Modeling IDE evidence is filtered by the same narrow classifier the spec
// uses. Load it from the TypeScript contract instead of duplicating the rule,
// so the coverage gate cannot drift from the gate that produced the evidence.
const modelingIdeContract = (() => {
  const file = fileURLToPath(new URL('../tests/modeling-ide-contract.ts', import.meta.url));
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  // The contract parses URLs, so the sandbox needs the host URL constructor.
  runInNewContext(code, { exports, URL });
  return exports;
})();

export const isExpectedExtensionManifestMiss = item =>
  modelingIdeContract.isExpectedExtensionManifestMiss(item);

const navigationTabs = {
  工作台: ['首页', '仪表盘', '工时'],
  产品管理: [],
  项目管理: [],
  资源管理: ['工时日历', '工时日志'],
};

const remainingByRef = {
  '@ibiz-template-plm/person-select@0.0.3-alpha.434':
    'Saved assignee ID, multiple/OBJECT/OBJECTS modes, roles and error recovery lack native business assertions.',
  '@ibiz-template-plm/resource-gantt@0.0.3-alpha.304':
    'Assignment persistence, task drag/resize, dates and context-menu actions lack native business assertions.',
  '@ibiz-template-plm/route-picker@0.0.3-alpha.245':
    'Other entity contexts, enabled-cache/immediate/value modes, group actions and permission/error recovery lack native business assertions.',
  '@ibiz-template-plm/group-tree@0.0.3-alpha.252':
    'Node create/rename/move/delete, context menus and permission cases lack native business assertions.',
  '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311':
    'Paging, selection across pages, restored initial selections and non-picker modes lack native business assertions.',
  '@ibiz-template-plugin/sample-list@0.1.3-alpha.39':
    'Restored initial selections, selection across pages and non-picker modes lack native business assertions.',
  '@ibiz-template-plm/drbar-ex@0.0.3-alpha.241':
    'Eight native product relation panels and history are bounded navigation only; permission, counter, overflow modes and actions remain unverified.',
  '@ibiz-template-plm/route-drbar@0.0.3-alpha.276':
    'Three native management panels and history are bounded navigation only; other groups, counters, permissions and actions remain unverified.',
  '@ibiz-template-plm/breadcrumb-nav-pos@0.0.3-alpha.247':
    'Three native management panel bindings are bounded only; breadcrumb click, nested navigation, cache and mode behavior remain unverified.',
};

export const navigationWorkflows = [
  {
    file: 'isolated-plugin-navigation.spec.ts',
    title: 'product relationship tabs bind all eight real panels and preserve native browser navigation',
    attachment: 'plugin-navigation-evidence',
    checkpoints: ['product-eight-panels', 'product-tabs-back', 'product-tabs-forward', 'product-tabs-reloaded'],
    refs: ['@ibiz-template-plm/drbar-ex@0.0.3-alpha.241'],
    checks: ['eight native relationship panels and data controls', 'native tab-arrow pointer navigation',
      'back', 'forward', 'reload selected relationship', 'desktop/mobile viewport'],
    panels: [
      ['usrdrgroup1228809432', 'idea_tree_exp_view'],
      ['usrdrgroup1228149482', 'product_plan_tree_exp_view'],
      ['usrdrgroup1228280909', 'ticket_all_grid_view'],
      ['usrdrgroup1228275731', 'customer_tree_exp_view'],
      ['usrdrgroup0423482168', 'baseline_product_tree_exp_view'],
      ['usrdrgroup0425581290', 'review_idea_tree_exp_view'],
      ['usrdrgroup1203616060', 'relation_product_re_project_grid_view'],
      ['usrdrgroup0229373827', 'space_product_re_tree_exp_view'],
    ],
  },
  {
    file: 'isolated-plugin-navigation.spec.ts',
    title: 'management route sidebar binds real configuration panels and restores history and reload state',
    attachment: 'plugin-navigation-evidence',
    checkpoints: ['management-three-panels', 'management-sidebar-back',
      'management-sidebar-forward', 'management-sidebar-reloaded',
      'management-workload-command-opened', 'management-print-command-opened'],
    refs: ['@ibiz-template-plm/route-drbar@0.0.3-alpha.276',
      '@ibiz-template-plm/breadcrumb-nav-pos@0.0.3-alpha.247'],
    checks: ['native role/workload/print panel bindings', 'real rows or native empty state',
      'usable desktop/mobile grid viewport', 'real management command dialogs and cancel without save',
      'back', 'forward', 'reload selected panel'],
    panels: [
      ['role', 'role_grid_view', 'roles'],
      ['workload', 'workload_type_setup_grid_view', 'workload_types'],
      ['print', 'extend_print_templ_grid_view', 'extend_print_templs'],
    ],
    commands: [
      { item: 'workload', name: '新建类别', view: 'workload_type_quick_create_view', fields: ['name'] },
      { item: 'print', name: '新建模版', view: 'extend_print_templ_quick_cfg_view',
        fields: ['name', 'de_tag', 'print_tag', 'print_model'] },
    ],
  },
];

// These are bounded interactions, not an assertion that every plugin method works.
const workflows = [
  {
    file: 'isolated-member-selection.spec.ts',
    title: 'native member picker preserves multi-selection across filtering and discards canceled selections',
    attachment: 'member-selection-evidence',
    checkpoints: [
      'native-select-all', 'native-multi-remove', 'native-selection-survives-filter',
      'native-selection-restored-after-filter', 'native-canceled-selection-discarded',
      'native-confirmed-multi-members', 'native-repeated-selection-deduplicated',
    ],
    refs: [
      '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311',
      '@ibiz-template-plugin/sample-list@0.1.3-alpha.39',
    ],
    pluginChecks: {
      '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311': [
        'real-user select-all', 'selected-list removal unchecks the correct ID',
        'filter preserves off-filter selections', 'filter reset restores checked users',
        'cancel discards selection', 'confirm and repeated pickup do not duplicate existing members',
      ],
      '@ibiz-template-plugin/sample-list@0.1.3-alpha.39': [
        'multiple real users render with shared display names', 'remove synchronizes the correct checkbox ID',
        'selected users survive filtering', 'cancel and reopen clear canceled selections',
        'confirm retains all selected users',
      ],
    },
  },
  {
    file: 'isolated-plugin-functional.spec.ts',
    title: 'person select searches, selects and clears a real contextual product member',
    checkpoints: ['person-member-list', 'person-search', 'person-empty-search', 'person-search-reset',
      'person-selected', 'person-cleared', 'person-department', 'person-rapid-tab-reset'],
    refs: ['@ibiz-template-plm/person-select@0.0.3-alpha.434'],
    checks: ['contextual real members', 'search and native empty results', 'search reset',
      'select', 'clear', 'department/user toggle', 'rapid tab reset'],
  },
  {
    file: 'isolated-plugin-functional.spec.ts',
    title: 'resource gantt supports expand, collapse, member search and search reset',
    checkpoints: ['gantt-member-search', 'gantt-reset', 'gantt-reopened-search'],
    refs: ['@ibiz-template-plm/resource-gantt@0.0.3-alpha.304'],
    checks: ['expand', 'collapse', 'member search', 'search reset'],
  },
  {
    file: 'isolated-product-workflows.spec.ts',
    title: 'organization product wizard adds a real member, creates, edits, deletes and cleans up its own product',
    attachment: 'product-workflow-evidence',
    checkpoints: [
      'member-picked', 'member-removed-from-selection', 'member-added', 'product-created',
      'product-settings-editable', 'product-edited-and-reloaded', 'product-advanced-settings',
      'product-ui-deleted', 'final-state',
    ],
    refs: [
      '@ibiz-template-plm/group-tree@0.0.3-alpha.252',
      '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311',
      '@ibiz-template-plugin/sample-list@0.1.3-alpha.39',
    ],
    pluginChecks: {
      '@ibiz-template-plm/group-tree@0.0.3-alpha.252': [
        'real organization root navigation', 'organization click reloads the native directory',
      ],
      '@ibiz-template-plugin/checkbox-grid@0.0.3-alpha.311': [
        'real user checkbox selection', 'selected-list removal unchecks the user',
        'reselection', 'selected user ID persists in product members',
      ],
      '@ibiz-template-plugin/sample-list@0.1.3-alpha.39': [
        'selected real user renders', 'remove synchronizes the native checkbox grid', 'reselection renders again',
      ],
    },
  },
  {
    file: 'isolated-plugin-functional.spec.ts',
    title: 'route picker handles empty keyboard selection and restores real product navigation',
    checkpoints: ['route-real-products', 'route-empty-keyboard', 'route-context-switched', 'route-context-reloaded'],
    refs: ['@ibiz-template-plm/route-picker@0.0.3-alpha.245'],
    checks: ['real product directory', 'native empty search', 'empty keyboard selection is inert',
      'search recovery', 'real product context switch', 'reload retains the selected product'],
  },
  ...navigationWorkflows,
];

export const requiredWorkflows = [
  ...workflows,
  {
    file: 'isolated-plugin-functional.spec.ts',
    title: 'isolated HTTP plugin outputs match the dist under test',
    attachment: 'plugin-http-identity',
  },
  {
    file: 'isolated-product-workflows.spec.ts',
    title: 'product wizard validates required fields and identifier, preserves input and cancels without creation',
    attachment: 'product-workflow-evidence',
    checkpoints: ['required-validation', 'identifier-validation', 'retreat-preserved-input', 'final-state'],
  },
  {
    file: 'isolated-product-workflows.spec.ts',
    title: 'product member picker renders the initially fetched real users without a second root click',
    attachment: 'product-workflow-evidence',
    checkpoints: ['initial-user-directory', 'final-state'],
  },
  {
    file: 'modeling-ide.spec.ts',
    title: 'Modeling IDE loads its work item counter from the local backend',
    attachment: 'modeling-ide-evidence',
  },
  ...['工作台', '产品管理', '项目管理', '资源管理'].map(menu => ({
    menu,
    file: 'isolated-responsive-navigation.spec.ts',
    title: `${menu} tree panes and native tabs stay usable on the current viewport`,
    attachment: 'responsive-native-navigation',
  })),
];

export function strictTestPassed(row) {
  return row?.expectedStatus === 'passed' && row.status === 'expected' &&
    row.results?.length === 1 && row.results[0].status === 'passed' &&
    !row.results[0].error && (row.results[0].errors || []).length === 0 &&
    (row.results[0].retry === undefined || row.results[0].retry === 0);
}

function attachmentName(workflow) {
  return workflow.attachment || 'browser-evidence';
}

export function isPersistentManagementRequest(request) {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (!/^\/api\/ibizplm__plmweb\/(?:workload_types|extend_print_templs)(?:\/|$)/.test(pathname)) return false;
  if (['PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
  return request.method === 'POST' &&
    !/^\/api\/ibizplm__plmweb\/(?:workload_types|extend_print_templs)\/fetch_[^/]+\/?$/.test(pathname);
}

export function workflowEvidencePassed(workflow, evidence) {
  if (evidence?.fixtureAcceptance !== false || evidence.nativeAcceptance !== false) return false;
  if (workflow.attachment === 'plugin-http-identity') {
    return Array.isArray(evidence.failures) && evidence.failures.length === 0 &&
      Number.isInteger(evidence.pluginCount) && evidence.pluginCount > 0 &&
      Array.isArray(evidence.files) && evidence.files.length > 0 &&
      evidence.fileCount === evidence.files.length && evidence.files.every(file =>
        file.status === 200 && /^[a-f0-9]{64}$/.test(file.localSha256) &&
        file.localSha256 === file.httpSha256);
  }
  if (workflow.attachment === 'responsive-native-navigation') {
    return Array.isArray(evidence.errors) && evidence.errors.length === 0 &&
      Array.isArray(evidence.panes) && evidence.panes.length > 0 &&
      evidence.panes.every(pane => ['left', 'right', 'outer'].every(key =>
        pane[key]?.width > 0 && pane[key]?.height > 0)) &&
      evidence.menu === workflow.menu && Array.isArray(evidence.labels) &&
      JSON.stringify(evidence.labels) === JSON.stringify(navigationTabs[workflow.menu]);
  }
  for (const key of ['pageErrors', 'consoleErrors']) {
    if (!Array.isArray(evidence[key]) || evidence[key].length !== 0) return false;
  }
  if (evidence.evidenceCaptureErrors && evidence.evidenceCaptureErrors.length !== 0) return false;
  // Only the platform's documented "no extension plugin" manifest miss may be
  // pre-classified by a spec, and every such entry must carry its URL, status
  // and reason so the coverage report still shows what was excused.
  if (evidence.expectedDiagnostics !== undefined) {
    if (!Array.isArray(evidence.expectedDiagnostics) ||
        evidence.expectedDiagnostics.some(item =>
          item?.reason !== 'extension-manifest-404' ||
          !isExpectedExtensionManifestMiss({ status: item.status ?? 404, url: item.url }))) return false;
  }
  if (!Array.isArray(evidence.requests) || evidence.requests.length === 0 ||
      evidence.requests.some(request =>
        (!Number.isInteger(request.status) || request.status < 200 || request.status >= 400) &&
        !(Number.isInteger(request.status) && isExpectedExtensionManifestMiss(request)))) return false;
  if ((workflow.checkpoints || []).some(checkpoint => !evidence.checkpoints?.includes(checkpoint))) return false;
  if (workflow.attachment === 'plugin-navigation-evidence') {
    if (!['back', 'forward', 'reload'].every(key => evidence.navigation?.[key] === true) ||
        !Array.isArray(evidence.readiness) || !Array.isArray(evidence.transitions) ||
        evidence.transitions.length !== workflow.panels.length ||
        evidence.requests.some(request => ['PUT', 'PATCH', 'DELETE'].includes(request.method))) return false;
    if (workflow.checkpoints.some(checkpoint =>
      evidence.readiness.filter(ready => ready.checkpoint === checkpoint &&
        ready.startupHidden === true && ready.loadingMasks === 0).length !== 1)) return false;
    if (!workflow.refs.every(ref => evidence.requests.some(request =>
      request.url?.includes(`/plugins/${ref}/`) && request.status === 200))) return false;
    return workflow.panels.every(([key, view, dataset], index) => {
      const transition = evidence.transitions[index];
      if (transition.view !== view || typeof transition.url !== 'string') return false;
      if (!dataset) return transition.group === key && transition.selected === 'true' &&
        transition.url.includes(`/product_index_view/srfnav=${key}/`) &&
        transition.panel?.width > 0 && transition.panel?.height > 0 &&
        transition.control?.width > 0 && transition.control?.height > 0;
      return transition.item === key && transition.dataset === dataset &&
        transition.url.includes(`/management_setting_view/srfnav=${key}/`) &&
      transition.grid?.width >= 240 && transition.grid?.height >= 240 &&
        Number.isSafeInteger(transition.rows) && transition.rows >= 0 &&
        (transition.rows > 0 || transition.emptyState === 1) &&
        evidence.datasets?.some(response => response.status === 200 &&
          response.url?.includes(`/${dataset}/fetch_default`) && response.rows === transition.rows);
    }) && (workflow.commands || []).every(command => {
      const transition = evidence.transitions.find(item => item.item === command.item);
      const observed = transition?.command;
      const dialog = observed?.dialog;
      const hitPassed = hit => hit?.width > 0 && hit.height > 0 &&
        Array.isArray(hit.points) && hit.points.length === 3 && hit.points.every(point => point === true);
      return observed?.name === command.name && observed.width >= 108 &&
        observed.title === command.name && observed.text === command.name &&
        observed.visible === true && observed.enabled === true &&
        hitPassed(observed) && dialog?.view === command.view &&
        dialog.opened === true && dialog.canceled === true &&
        dialog.headerClosed === true && dialog.close?.inViewport === true &&
        hitPassed(dialog.close) &&
        ['canceled', 'retainedValue', 'confirmed', 'draftDiscarded'].every(key =>
          dialog.closeConfirmation?.[key] === true) &&
        dialog.bounds?.width > 0 && dialog.bounds?.height > 0 &&
        Array.isArray(dialog.fields) && dialog.fields.length === command.fields.length &&
        command.fields.every((name, index) =>
          dialog.fields[index].name === name && hitPassed(dialog.fields[index])) &&
        Array.isArray(dialog.buttons) && dialog.buttons.length === 2 &&
        ['确定', '取消'].every((name, index) =>
          dialog.buttons[index].name === name && hitPassed(dialog.buttons[index])) &&
        !evidence.requests.some(isPersistentManagementRequest);
    });
  }
  if (workflow.attachment === 'modeling-ide-evidence') {
    return evidence.counter?.status === 200 && Number.isSafeInteger(evidence.counter.value) &&
      evidence.counter.value >= 0 && evidence.iframe?.path === '/modeldesign/' &&
      evidence.iframe.rendered === true &&
      evidence.appIdentity?.codeName?.toLowerCase() === 'modeldesign' &&
      evidence.appIdentity?.sysCodeName?.toLowerCase() === 'ibizmodeling';
  }
  if (workflow.attachment === 'member-selection-evidence') {
    return evidence.business?.defaultMemberDeduplicated === true &&
      evidence.business.repeatedSelectionDeduplicated === true &&
      evidence.cleanup?.wizardClosed === true && evidence.cleanup.persistentProductRequests === 0;
  }
  if (workflow.title === workflows[3].title) {
    return evidence.business?.pickerSelectionRemovalVerified === true &&
      evidence.business.allDirectoryUsersSelected === true &&
      evidence.business.persistedMemberUniquenessAndAdminRoleVerified === true &&
      evidence.business.uiDeleted === true &&
      Array.isArray(evidence.cleanup?.ids) && evidence.cleanup.ids.length > 0 &&
      Array.isArray(evidence.cleanup.responses) && evidence.cleanup.responses.length === evidence.cleanup.ids.length &&
      evidence.cleanup.responses.every(response => response.status === 200) &&
      Array.isArray(evidence.cleanup.remains) && evidence.cleanup.remains.length === 0;
  }
  if (workflow.title === 'product wizard validates required fields and identifier, preserves input and cancels without creation') {
    return evidence.business?.requiredValidationErrors?.length > 0 &&
      evidence.business.identifierValidationErrors?.length > 0 &&
      !evidence.requests.some(request => request.method === 'POST' &&
        /\/products\/?(?:\?|$)/.test(request.url));
  }
  if (workflow.title === 'product member picker renders the initially fetched real users without a second root click') {
    return Array.isArray(evidence.business?.initialUsers) && evidence.business.initialUsers.length > 0;
  }
  return true;
}

function readAttachment(attachment) {
  if (attachment.path) return JSON.parse(fs.readFileSync(attachment.path, 'utf8'));
  assert(attachment.body, 'captured evidence has no path or body');
  return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
}

export function pluginRegistrations(source) {
  const ast = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.parseDiagnostics.length, 0, 'plugin model must be valid TypeScript');
  const registrations = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const strings = {};
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) continue;
        const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
          ? property.name.text : undefined;
        if (key) strings[key] = property.initializer.text;
      }
      if (strings.rtobjectRepo) {
        registrations.push({
          ref: strings.rtobjectRepo, id: strings.id, pluginCode: strings.pluginCode,
          runtimeObject: strings.rtobjectName,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return registrations;
}

export function reportRows(report) {
  const rows = [];
  function visit(suite) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        rows.push({
          file: spec.file || suite.file, title: spec.title, project: test.projectName,
          expectedStatus: test.expectedStatus, status: test.status,
          results: test.results || [],
        });
      }
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites || []) visit(suite);
  return rows;
}

export function scopedPluginCoverage(refs, rows, loadEvidence) {
  return refs.map(ref => {
    const checks = workflows.filter(workflow => workflow.refs.includes(ref)).map(workflow => ({
      title: workflow.title,
      checks: workflow.pluginChecks?.[ref] || workflow.checks,
      projects: ['desktop', 'mobile'].map(project => {
        const matching = rows.filter(row =>
          row.file === workflow.file && row.title === workflow.title && row.project === project);
        assert(matching.length <= 1, 'do not merge repeated runs into acceptance');
        const row = matching[0];
        const attachments = row?.results?.[0]?.attachments?.filter(item =>
          item.name === attachmentName(workflow)) || [];
        const attachment = attachments[0];
        const evidence = attachments.length === 1 && (attachment.path || attachment.body)
          ? loadEvidence(attachment.path, attachment) : undefined;
        const verified = strictTestPassed(row) && workflowEvidencePassed(workflow, evidence);
        return {
          project, status: verified ? 'scoped-passed' : row ? 'failed-or-unbound' : 'unverified',
          reportStatus: row?.status, evidencePath: attachment?.path,
          executionStatus: row?.results?.[0]?.status,
        };
      }),
    }));
    const statuses = checks.flatMap(check => check.projects.map(project => project.status));
    return {
      ref, functionalAcceptance: false, nativeAcceptance: false,
      fullFunctionalityStatus: statuses.includes('failed-or-unbound') ? 'failed' : 'unverified',
      scopedInteractionCovered: checks.length > 0 && checks.every(check =>
        check.projects.every(project => project.status === 'scoped-passed')),
      checks,
      remaining: remainingByRef[ref] ||
        'No dedicated desktop/mobile native business assertion in this matrix.',
    };
  });
}

export function buildCoverage(candidateRoot, reportPaths) {
  const identityPath = path.join(candidateRoot, 'identity.json');
  const receiptPath = path.join(candidateRoot, 'build-receipt.json');
  const identity = JSON.parse(fs.readFileSync(identityPath));
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  assert.equal(identity.fixtureAcceptance, false);
  assert.equal(identity.distSha256, receipt.dist.sha256);
  assert.equal(identity.imageDistSha256, receipt.dist.sha256);
  assert.equal(identity.sourceSha256, receipt.sourceInputs.before.sha256);
  assert.deepEqual(identity.failures, []);
  const refs = fs.readFileSync(path.join(candidateRoot, 'source/tools/plugin-recovery/runtime-plugins.txt'), 'utf8')
    .trim().split(/\r?\n/);
  assert.equal(new Set(refs).size, refs.length, 'plugin list must not contain duplicates');
  assert.equal(refs.length, receipt.pluginOutputs.pluginCount);
  assert.equal(identity.pluginCount, refs.length);
  for (const declared of receipt.pluginOutputs.files) {
    const served = identity.httpFiles.find(file => file.path === declared.path);
    assert(served, 'every declared plugin file needs served-byte evidence');
    assert.equal(served.status, 200, declared.path);
    assert.equal(served.sha256, declared.sha256, declared.path);
    assert.equal(served.httpSha256, declared.sha256, declared.path);
  }
  const modelPath = 'src/publish/model/app/app.ts';
  const modelBytes = fs.readFileSync(path.join(candidateRoot, 'source', modelPath));
  assert.equal(sha256(modelBytes), receipt.sourceInputs.before.entries.find(entry =>
    entry.path === modelPath)?.sha256, 'plugin registration model must be the built snapshot');
  const registrations = pluginRegistrations(modelBytes.toString('utf8'));
  const reports = reportPaths.map(reportPath => {
    const bytes = fs.readFileSync(reportPath);
    const report = JSON.parse(bytes);
    // Playwright's JSON reporter omits project.use, so use captured browser
    // evidence rather than assuming its environment from the directory name.
    const bindings = reportRows(report).flatMap(row =>
      row.results.flatMap(result => (result.attachments || []).filter(attachment =>
        ['browser-evidence', 'product-workflow-evidence', 'member-selection-evidence',
          'plugin-http-identity', 'responsive-native-navigation', 'modeling-ide-evidence',
          'plugin-navigation-evidence'].includes(attachment.name)
        && (attachment.path || attachment.body)).map(readAttachment)));
    assert(bindings.length > 0, 'report has no captured deployment identity');
    for (const binding of bindings) {
      assert.equal(binding.baseUrl, identity.baseUrl, 'report belongs to another deployment');
      assert.equal(path.resolve(binding.distRoot), path.resolve(identity.distRoot), 'report belongs to another dist');
      assert.equal(binding.fixtureAcceptance, false, 'fixture evidence is not a native run');
      assert.equal(binding.nativeAcceptance, false, 'bounded browser evidence must not claim native acceptance');
    }
    return { path: path.resolve(reportPath), sha256: sha256(bytes), stats: report.stats, report };
  });
  const rows = reports.flatMap(report => reportRows(report.report));
  const loadEvidence = (_evidencePath, attachment) => {
    const evidence = readAttachment(attachment);
    assert.equal(evidence.baseUrl, identity.baseUrl, 'functional evidence belongs to another deployment');
    assert.equal(path.resolve(evidence.distRoot), path.resolve(identity.distRoot), 'functional evidence belongs to another dist');
    return evidence;
  };
  const plugins = scopedPluginCoverage(refs, rows, loadEvidence).map(plugin => ({
    ...plugin,
    registrations: registrations.filter(registration => registration.ref === plugin.ref),
    httpIdentityFiles: identity.httpFiles.filter(file =>
      file.path.startsWith(`plugins/${plugin.ref}/`)).map(file => ({
      path: file.path, status: file.status, sha256: file.sha256, httpSha256: file.httpSha256,
    })),
  }));
  assert(plugins.every(plugin => plugin.registrations.length > 0), 'every plugin must map to the real app model');
  const failures = rows.filter(row => !strictTestPassed(row));
  const runnerErrors = reports.flatMap(({ path: reportPath, report }) => {
    if (report.errors === undefined) return [];
    if (!Array.isArray(report.errors)) return [{ reportPath, reason: 'invalid runner errors' }];
    return report.errors.map((_error, index) => ({ reportPath, reason: `runner error ${index + 1}` }));
  });
  const requiredChecks = requiredWorkflows.flatMap(workflow => ['desktop', 'mobile'].map(project => {
    const matching = rows.filter(row =>
      row.file === workflow.file && row.title === workflow.title && row.project === project);
    let status = 'missing';
    if (matching.length > 1) status = 'duplicate';
    if (matching.length === 1) {
      const row = matching[0];
      const attachments = row.results?.[0]?.attachments?.filter(attachment =>
        attachment.name === attachmentName(workflow)) || [];
      const evidence = attachments.length === 1 ? loadEvidence(undefined, attachments[0]) : undefined;
      status = strictTestPassed(row) && workflowEvidencePassed(workflow, evidence) ? 'passed' : 'failed-or-unbound';
      if (row.results?.some(result => result.status === 'skipped')) status = 'skipped';
      if (status === 'passed' && workflow.attachment === 'plugin-http-identity') {
        const expected = receipt.pluginOutputs.files;
        const matched = new Set();
        for (const file of evidence.files) {
          const relative = `plugins/${file.ref}/${file.path}`;
          const declared = expected.find(entry => entry.path === relative);
          if (!declared || matched.has(relative) || declared.sha256 !== file.localSha256) {
            status = 'failed-or-unbound';
          }
          matched.add(relative);
        }
        if (matched.size !== expected.length || evidence.pluginCount !== refs.length) status = 'failed-or-unbound';
      }
    }
    return { file: workflow.file, title: workflow.title, project, status };
  }));
  const setupRows = rows.filter(row => row.project === 'setup' &&
    row.file === 'auth.setup.ts' && row.title === 'authenticate local PLM');
  requiredChecks.push({
    file: 'auth.setup.ts', title: 'authenticate local PLM', project: 'setup',
    status: setupRows.length === 0 ? 'missing' : setupRows.length !== 1 ? 'duplicate' :
      strictTestPassed(setupRows[0]) ? 'passed' : 'failed-or-unbound',
  });
  const unmetChecks = requiredChecks.filter(check => check.status !== 'passed');
  const requiredMatrixPassed = runnerErrors.length === 0 && failures.length === 0 &&
    unmetChecks.length === 0;
  return {
    createdAt: new Date().toISOString(),
    fixtureAcceptance: false, nativeAcceptance: false, functionalAcceptance: false,
    requiredMatrixPassed,
    status: requiredMatrixPassed ? 'passed-scoped' : 'failed',
    scope: 'Observed isolated native workflows, not complete PLM or all-plugin functionality acceptance',
    candidate: {
      identityPath, receiptPath, baseUrl: identity.baseUrl, containerId: identity.containerId,
      sourceSha256: identity.sourceSha256, distSha256: identity.distSha256,
      imageSha256: identity.imageSha256, imageDistSha256: identity.imageDistSha256,
    },
    reports: reports.map(({ report, ...entry }) => entry),
    counts: {
      runtimePlugins: plugins.length,
      withScopedInteractionEvidence: plugins.filter(plugin => plugin.scopedInteractionCovered).length,
      withoutPassedScopedInteractionEvidence: plugins.filter(plugin => !plugin.scopedInteractionCovered).length,
      fullPluginFunctionalityAccepted: 0, remainingFullPluginFunctionality: plugins.length,
      testExecutions: rows.length,
      passed: rows.length - failures.length,
      failedOrUnverified: failures.length,
      skipped: rows.filter(row => row.results.some(result => result.status === 'skipped')).length,
      requiredChecks: requiredChecks.length,
      passedRequiredChecks: requiredChecks.length - unmetChecks.length,
      failedRequiredChecks: requiredChecks.filter(check => ['failed-or-unbound', 'duplicate'].includes(check.status)).length,
      unverifiedRequiredChecks: requiredChecks.filter(check => check.status === 'missing').length,
      skippedRequiredChecks: requiredChecks.filter(check => check.status === 'skipped').length,
      unmetRequiredChecks: unmetChecks.length,
      runnerErrors: runnerErrors.length,
    },
    failures,
    runnerErrors,
    requiredChecks,
    unmetChecks,
    remainingBusinessWorkflows: [
      'Project create/edit/member binding/delete and cleanup',
      'Requirement create/edit/status/association/delete and cleanup',
      'Work item create/edit/assignee/status/delete and cleanup',
      'Test case/suite/plan/run/review CRUD, transitions and cleanup',
      'Knowledge library/page/file CRUD, sharing, permissions and cleanup',
      'Baseline/version/release/board/report/settings full action coverage',
      'Remaining plugin modes/actions and dedicated business assertions',
    ],
    plugins,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [candidateRoot, output, ...reportPaths] = process.argv.slice(2);
  assert(candidateRoot && output && reportPaths.length, 'candidate root, new output file and reports are required');
  assert(!fs.existsSync(output), 'coverage evidence must not overwrite a prior run');
  let coverage;
  try {
    coverage = buildCoverage(path.resolve(candidateRoot), reportPaths);
  } catch (error) {
    coverage = {
      createdAt: new Date().toISOString(), status: 'failed', requiredMatrixPassed: false,
      fixtureAcceptance: false, nativeAcceptance: false, functionalAcceptance: false,
      failure: { code: error.code || 'EVIDENCE_CONTRACT', message: error.message },
    };
  }
  fs.writeFileSync(output, JSON.stringify(coverage, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output: path.resolve(output), counts: coverage.counts }, null, 2));
  if (!coverage.requiredMatrixPassed) process.exitCode = 1;
}
