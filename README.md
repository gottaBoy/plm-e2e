# PLM E2E

独立的 PLM 前端端到端测试项目，用于重复验证 `http://127.0.0.1:4173/` 的登录、一级功能、接口路由、移动端布局和已知问题回归。

## 范围

- 登录与认证状态复用
- 12 个一级功能的桌面端和移动端打开、渲染、横向溢出检查
- 常见树节点和标签页交互
- `TICKET` JSON Schema、站内消息、`SysOperator` 字典接口健康检查
- 已知问题回归：
  - 动态仪表盘接口返回 500
  - Vue 路由切换触发 `nextSibling` 空引用错误
  - 二次开发 HTML View 缺少渲染引擎

## 运行

前置条件：

1. 本机安装 Google Chrome。
2. PLM 前端运行在 `http://127.0.0.1:4173/`。
3. 相关后端服务可访问：32003、30000、30251。

```sh
pnpm install
pnpm test
```

常用命令：

```sh
pnpm test:desktop
pnpm test:mobile
pnpm test:api
pnpm test:known
pnpm report
```

默认账号是 `demo_admin / 123456`。需要覆盖时复制 `.env.example` 为 `.env` 后修改；`.env` 不会提交。

## 结果

- HTML 报告：`playwright-report/index.html`
- JSON 结果：`reports/test-results.json`
- 失败截图和 trace：`test-results/`

报告和运行产物均已加入 `.gitignore`。

`pnpm test` 默认排除 `@known-issue` 用例，用于验证当前应通过的功能。`pnpm test:known` 单独运行已知缺陷用例；在这些缺陷修复前，该命令预期失败，修复后对应用例应转为通过。
