# PLM E2E

独立的 PLM 前端端到端测试项目，用于重复验证 `http://127.0.0.1:30250/ibizplm-plmweb/` 的登录、一级功能、接口路由、移动端布局和已知问题回归。

## 范围

- 登录与认证状态复用
- 12 个一级功能的桌面端和移动端打开、渲染、横向溢出检查
- 常见树节点和标签页交互
- `TICKET` JSON Schema、站内消息、`SysOperator` 字典接口健康检查
- 已知问题回归：
- 动态仪表盘接口返回 500
- Vue 路由切换触发 `nextSibling` 空引用错误
- 二次开发 HTML View 缺少渲染引擎

当前这三项已完成修复回归，`pnpm test:known` 预期全部通过。

## 运行

前置条件：

1. 本机安装 Chrome 或 Playwright Chromium。
2. PLM 前端运行在 `http://127.0.0.1:30250/ibizplm-plmweb/`。
3. 相关后端服务可访问：32003、30000、30251。

```sh
pnpm install
pnpm test
```

常用命令：

```sh
pnpm test:desktop
pnpm test:mobile
pnpm test:mobile:skip-gate
pnpm test:api
pnpm test:known
pnpm test:sweep
pnpm test:sweep:workspace
pnpm test:config
pnpm test:harness-ui
pnpm report
```

默认账号是 `demo_admin / 123456`。需要覆盖时复制 `.env.example` 为 `.env` 后修改；`.env` 不会提交。

跨机器运行时可通过环境变量覆盖入口和账号：

```sh
PLM_E2E_BASE_URL=http://127.0.0.1:30250/ibizplm-plmweb/
# 可留空；测试会从 PLM_E2E_BASE_URL 自动推导。
PLM_E2E_APP_PATH=
PLM_E2E_CHANNEL=
PLM_E2E_USERNAME=demo_admin
PLM_E2E_PASSWORD=123456
```

## 结果

- HTML 报告：`playwright-report/index.html`
- JSON 结果：`reports/test-results.json`
- 失败截图和 trace：`test-results/`

报告和运行产物均已加入 `.gitignore`。

`pnpm test` 默认排除 `@known-issue` 与 `@deep-sweep` 用例，用于快速验证当前应通过的功能。

`pnpm test:known` 单独运行历史缺陷回归，当前预期全部通过。

`pnpm test:sweep` 逐个点击 12 个一级菜单下的全部树节点和标签页（实测约 95 个节点、44 个标签页），
每次运行约 12 分钟，用于全功能巡检。用例通过 `sweep` 注解输出各菜单实际访问的节点与标签页清单。

`pnpm test:mobile:skip-gate` 必须在 `pnpm test:mobile` 后执行。它读取本次
Playwright JSON 报告，要求移动端零 skip、零 unexpected、零 flaky。

`pnpm test:sweep:workspace` 只运行工作台范围的深度扫描，适合定位问题；
完整验收仍应运行 `pnpm test:sweep`。

`pnpm test:config` 验证 `PLM_E2E_ARTIFACT_DIR`、HTML/JSON 报告和认证状态文件
不会落到其他并发运行目录。推荐每次运行显式设置独立目录：

```sh
export PLM_E2E_ARTIFACT_DIR=/home/my/workspace/ainfra/aibiz/.artifacts/plm-e2e/$(date +%Y%m%d-%H%M%S)
pnpm test
```

测试资产包括：

- `tests/modeling-ide.spec.ts`
- `tests/resource-gantt.spec.ts`
- `config-tests/artifact-isolation.test.mjs`
- `scripts/mobile-skip-gate.mjs`

默认 `pnpm test` 排除 `@known-issue` 和 `@deep-sweep`；这是命令设计，不是
缺失覆盖。完整回归必须额外执行 `pnpm test:known` 和 `pnpm test:sweep`。
移动端报告中任何 skip 都不算 pass，且会使能力门槛失败。

## 证据约定

JSON、HTML、截图和 trace 默认写入
`.artifacts/<run-id>/reports`、`.artifacts/<run-id>/test-results` 和
`.artifacts/<run-id>/playwright`。不要把仓库根目录已有的
`reports/test-results.json` 当作最新证据：当前该文件是含失败的历史
deep-sweep 输出。

已确认的通过证据：

- `.artifacts/plm-e2e-final/reports/test-results.json`：
  `40 passed, 13 skipped, 0 unexpected`。
- `.artifacts/plm-e2e-matrix-known-20260928/reports/test-results.json`：
  `4 passed, 0 unexpected`。
- `.artifacts/plm-full-flow-e2e/desktop/reports/test-results.json`：
  `27 passed, 0 unexpected`。
- `.artifacts/plm-full-flow-e2e/mobile/reports/test-results.json`：
  `14 passed, 13 skipped, 0 unexpected`。
- `.artifacts/plm-full-flow-e2e/deep-sweep/reports/test-results.json`：
  `13 passed, 0 unexpected`。

`.artifacts/plm-audit-20260929-desktop/reports/test-results.json` 含 1 个
失败，不能写入“桌面端已通过”的结论。`SKIP` 必须与允许规则或环境缺失原因
一起记录。
