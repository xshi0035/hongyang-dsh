# CLAUDE.md — 弘阳广场 · AI 财务助手 Demo（基于 dsh）

> 本文件替换了原来指向 AGENTS.md 的软链接。上游 DeepSeek Harness 的工程规范仍在 [AGENTS.md](AGENTS.md)，改底座代码时必须遵守；本文件只讲这个 demo 项目怎么做。
> 完整需求见 [docs/hongyang/spec.md](docs/hongyang/spec.md)，样本文件在 `docs/hongyang/samples/`。
> **演示日期：2026-09-13。开发窗口 9/10 – 9/12。**

## 1. 项目是什么

给衡阳诚远商业管理有限公司（弘阳广场）做的财务 Agent 演示：

- **底座**：dsh（DeepSeek Harness，本仓库）。它是一个"全插件"的 Cordis agent 运行时：模型适配、工具注册、会话日志、agent loop 全是插件，从 cordis.yml 组合。**底座逻辑不改**，只换壳（品牌）和加插件。
- **我们做的**：一组 `hy-*` 插件（业务口径 / 导入 / 认领 / 钉钉入口 / 收入日报表 / 凭证 / 看板），全部放在 `packages/hongyang/` 下，通过 `--patch` 覆盖层挂进 `web` profile。
- **主产物链**：上报或流水 → 认领拆分 → 收入日报表（34 列 xlsx）→ 凭证（金蝶云星空 21 列 xlsx）。
- **两个入口进同一个 agent**：财务在浏览器（`dsh web`），运营在手机钉钉机器人（Stream 模式，插件内长连接）。

## 2. 目录结构（只列跟 demo 相关的）

```
deepseek-harness/
├── AGENTS.md                      上游工程规范（必读：Conventions 一节）
├── docs/hongyang/                 本 demo 的需求与样本
│   ├── spec.md
│   └── samples/                   建行流水 xls / 凭证 xlsx / 收入日报表格式 xlsx / 应收表截图 / 付款截图
├── docs/architecture.md           底座架构，改 packages/ 前先读
├── docs/cookbook/adding-a-tool.md 工具怎么写（含 UI 卡片三层分离）
├── docs/user/develop/basic/       插件入门教程（index / tool / config / publish）
├── docs/subsystems/               各子系统说明（tools / system-prompt / skills / slots / attachment / storage …）
├── apps/cli/                      `dsh` 启动器；`pnpm dsh web` 从这里起
├── apps/web/                      浏览器前端壳（不能单独 vite dev，见 §6）
├── packages/
│   ├── bundle/base/cordis.patch.yml     web/headless 共用的插件清单（工具、模型、存储都在这里挂）
│   ├── bundle/web-app/cordis.patch.yml  浏览器应用层（端口、品牌槽位、客户端模块）
│   ├── core/tools/                      工具注册表 + defineTool DSL
│   ├── core/system-prompt/              system prompt 分段组装（ctx.systemPrompt.section）
│   ├── core/agent-loop/                 agent loop（不要改）
│   ├── llm/llm/                         LLM 能力接口 LlmAdapter / ctx.llm
│   ├── llm/llm-deepseek/                DeepSeek 直连适配器（唯一 fetch 点）
│   ├── llm/llm-pi-ai/                   多 provider 适配器（Anthropic / OpenAI 兼容网关走这里）
│   ├── skill/skill-filesystem/          SKILL.md 扫描
│   ├── attachment/attachment-local/     上传文件落盘
│   ├── storage/storage-sqlite/          node:sqlite 打开/版本约定的参考实现
│   ├── client/ui-tool/                  tool 卡片槽位 tool.call.toolview
│   ├── client/ui-brand-official/        品牌槽位包（换壳时替换）
│   ├── todo/tool-todo/                  最简单的单工具插件范例，照抄骨架
│   └── hongyang/                        ← 我们的插件都放这里（待建）
│       ├── finance-core/                业务口径 skill + 费项/税率/科目表 + calc_tax 等
│       ├── finance-db/                  SQLite 数据层（merchant / receivable / transaction / allocation / voucher_line）
│       ├── tool-import/                 import_bank_xls / import_receivable_xlsx …
│       ├── tool-claim/                  run_claim / list_pending / confirm_claim / learn_payer
│       ├── dingtalk/                    钉钉 Stream 机器人 + parse_payment_screenshot / parse_report_text
│       ├── tool-daily-report/           build / export / compare 收入日报表
│       ├── tool-voucher/                build / export / compare 凭证
│       ├── tool-dashboard/              receivable_summary / merchant_balance / list_overdue
│       ├── ui-brand-hongyang/           品牌槽位包（替换 ui-brand-official）
│       └── ui-finance/                  待认领表格等客户端卡片（React，注册到 tool.call.toolview）
└── hongyang.cordis.yml                  演示用 --patch 覆盖层（待建）：insert 上面所有插件
```

## 3. 插件怎么写

### 3.1 一个插件就是一个 npm 包

- 包名 `@deepseek-ai/dsh-hy-<name>`，放 `packages/hongyang/<name>/`，ESM，`src/index.ts` 用**具名导出**：`name` / `inject` / `Config` / `apply`，**不要 default export**（混用会丢 inject，见 docs/postmortem/0001）。
- `@deepseek-ai/cordis` 和被 inject 的服务包都写在 `peerDependencies` + `devDependencies`，照抄 `packages/todo/tool-todo/package.json`。
- 新包要注册进 `tsconfig.host.json`（客户端包进 `tsconfig.client.json`），流程见 `docs/cookbook/adding-a-package.md`。
- 挂载：在 `hongyang.cordis.yml` 里 `- insert:` 一行 `{ id, name, config }`，启动时 `pnpm dsh web --patch ./hongyang.cordis.yml`。配置项一律走 `Config`（schemastery），不许在代码里写死可调参数。
- 交付时打包成 bundle（`package.json` 里 `dsh.bundle.patch`），客户用 `dsh plugin --profile <name> add <pkg>` 安装。这就是"平台 + 插件分发"的实证。

### 3.2 工具（tool）

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'hy-tool-claim'
export const inject = ['tools', 'hyFinanceDb']          // 声明了才能用 ctx.xxx

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'confirm_claim',
    description: '把一笔待认领收款确认到某商户，写 allocation 并记住付款人映射',
    parameters: {                                          // 自有 DSL，编译成受限 JSON Schema
      txn_id: { type: 'string', required: true },
      merchant_id: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { /* … */ } },
      render: (_args, value) => [{ type: 'text', text: `已认领 ${value.merchant} …` }],  // 模型看到的
      presentationMeta: (_args, value) => ({ /* 给前端卡片用的、可回放的 JSON */ }),
    },
    async execute(args, exec) { /* 确定性代码，写 SQLite */ },
    presentCall: args => ({ card: 'generic', title: '确认认领', kind: 'other', rawInput: args }),
  }))
}
```

- 参数/输出 schema 是 `packages/core/tools/src/schema.ts` 的 DSL（`string|number|integer|boolean|array|object|oneOf`，对象必须写 `additionalProperties`，必填写 `required: true`），不是 zod。
- `execute` 返回的值会被校验、冻结、写进 `tool/result` 日志；`render` 决定模型看到什么；`presentationMeta` 决定前端卡片能拿到什么。三者分离，presenter 必须是纯函数。
- 注册的工具自动进 system prompt 的 tools 列表，不用额外声明。

### 3.3 业务口径注入 system prompt

用 `ctx.systemPrompt.section({ name, order, text })`（`inject: ['systemPrompt']`），例子见 `packages/shell/tool-bash/src/index.ts:235`。费项/税率/科目表、摘要模板、术语表都以 section 注入，这是"让 dsh 懂财务"的机制。

SKILL.md 是**另一套**机制：放在 `.dsh/skills/<name>/SKILL.md`（项目级）或 `$DSH_HOME/skills/`，按需由 `skill` 工具或用户 `/name` 载入，不是常驻 system prompt。演示只需要常驻口径，用 section 即可；SKILL.md 可选。

### 3.4 需要模型的地方：直接调 `ctx.llm.stream()`

`inject: ['llm']`，构造 `GenerateOptions`（可带 `system` 和 `ImageBlock`），用 `BlockAssembler` 折叠输出。范例 `packages/session/session-title-llm/src/index.ts:254-289`。
- 图片：走 `ctx.attachments` 存成 `ImageAttachmentRef` 再放进消息；模型必须声明 image 模态。
- **没有 JSON mode / response_format**。结构化抽取的做法：prompt 里要求只输出 JSON，然后用 zod 严格解析，解析失败就当"没认出"进待认领队列。

### 3.5 前端卡片（带按钮的表格）

- Host 侧不管卡片；前端从 `tool/call` + `tool/result.meta` 自己派生。
- 客户端模块：包里加 `dsh.client` 声明和 `./client` 导出，`src/client/index.ts` 里 `ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: '<工具名>', locale: NS, inject: sessionId => ({ confirm: (...) => ctx.remote.hyClaim.confirm(sessionId, ...) }) }, PendingClaimsTable))`。范例 `packages/client/ui-tool/src/client/tool/toolviews/todo-row.tsx:69-77`。
- 按钮回传：Host 侧写一个 `extends TypertRemoteService` 的服务，方法标 `@Remote('confirm')`，里面写库并 `agent.inject(createUserMessage(...))` 让模型下一轮知道用户点了什么。范例 `packages/extensions/cordis-host-runner/src/index.ts:479-489, 1150-1157`。
- 所有 UI 文案走 locale 字典（`verify-client-ui-i18n` 会拒绝硬编码）。
- 改了客户端代码要重新 `pnpm run build:web`，或另开终端跑 `pnpm run dev:web`。

### 3.6 数据层

- 用 Node 内建 `node:sqlite`（`DatabaseSync`），**不装 better-sqlite3**。
- `hy-finance-db` 插件自己开一个库文件，路径从 cordis.yml 配：`path: !!js dshHomePath('hongyang/finance.db')`。open 序列（建目录 0o700、pragma、`user_version` 校验与打戳）照抄 `packages/storage/storage-sqlite/src/schema.ts:42-107`。
- 导出 `HY_FINANCE_SCHEMA_VERSION`，版本不符**拒绝打开**（业务数据是权威数据）。连接关闭挂 `ctx.effect()` disposer。
- 以 Service 类形式 `ctx.provide` 成 `hyFinanceDb`，其他 `hy-*` 插件 `inject: ['hyFinanceDb']`。
- 不要用 `ctx.storageDomain`（KV/JSON，无事务无索引，全量进内存）。

## 4. 开发规范（demo 专用，叠加在 AGENTS.md 之上）

1. **模型不碰钱。** 金额、税额（`tax = round(incl/(1+r)*r, 2)`）、跨月分摊、拆分顺序、凭证借贷行、合计，全部在工具的确定性 TypeScript 里算，并有单元测试。模型只做：截图识别、文本抽取、模糊匹配商户、对话。模型输出的任何金额只作为"候选"，必须和流水或应收表里的数对上才落库。
2. **凭证从日报表生成，日报表从 allocation 生成。** 不允许工具直接从流水跳到凭证。
3. **认领三层匹配的置信度是数据，不是模型自述。** L1 精确 1.0 / L2 备注解析 0.7–0.9 / L3 金额建议进队列 / 未命中挂暂收款 `2203.01.05`。
4. **付款人映射（payer_mapping）只在人工确认后写 confirmed=true**，之后才允许自动认领。
5. **费项枚举以 `收入日报表格式.xlsx` 第 3 行 22 个金额列为准**，列序固定；科目编码未确认的标 TBD，演示时不出现在凭证里。
6. 导出 xlsx 与样本**列名列序完全一致**（日报表 34 列，凭证 21 列），比对工具逐行 diff。
7. 工具返回的 `render` 文本要短、可读；大表用 `presentationMeta` 给卡片，或导出文件后用 `present` 工具交付。
8. 演示路径上的每个工具都要有一条真样本跑通的测试（`docs/hongyang/samples/`）。
9. 底座代码（`packages/core`、`packages/llm`、agent-loop）**不改**。换壳只改品牌槽位包、locale 字典、构建期标题、system prompt 身份句。
10. 提交前至少 `pnpm run typecheck` 和相关包的 vitest；不要跑全量套件。

## 5. 换壳清单（去 dsh / DeepSeek 痕迹）

| 表面 | 位置 | 做法 |
|---|---|---|
| 浏览器标题 | `scripts/client-build-environment.ts:22`、`apps/web/index.html:8`、`apps/web/vite.config.ts:12,25` | 四处同步改成 `弘阳广场 · AI 财务助手`（vite 用精确字符串替换，漏一处静默失效） |
| PWA 名 / 图标 | `apps/web/public/manifest.webmanifest:3-4`、`apps/web/public/favicon.svg` | 改名、换 svg（保留 dark-mode media query，e2e 有断言） |
| 侧栏 logo / 字标 | `packages/client/ui-brand-official/`，挂载在 `packages/bundle/web-app/cordis.patch.yml:259-260` | 新建 `ui-brand-hongyang` 替换该行；同时改 `FishLogo.tsx` / `BrandWordmark.tsx` / `HeroShell.tsx` 的 fallback |
| 侧栏名 fallback | `packages/client/locale/src/locales/{en,zh}.ts` 的 `brand.localBuild` | 改字典值 |
| 启动闪屏 `HARNESS` | `packages/client/web/src/boot-page.ts:37,40,92` | 硬编码，直接改 |
| 内测声明 / 引导弹窗 | `packages/client/ui-settings-models/src/client/locales.ts:95-100,202-207` | 改字典值 |
| system prompt 身份句 | `packages/core/system-prompt/src/index.ts:423`；`packages/bundle/web-app/src/index.ts:139,246` | 改成"你是弘阳广场 AI 财务助手"；或 config `includeHarnessIdentity: false` 后自己注 section |
| `skill-badge`（会往产出物贴 DeepSeek 徽章） | `packages/bundle/base/cordis.patch.yml` 里的 skill-badge 行 | 从 patch 层 disabled 掉 |
| 气泡里的模型名 | 来自 provider `displayName` 和模型目录 `name` | 用 pi-ai 自定义 provider 时把模型 `name` 写成"财务助手" |
| CLI help | `apps/cli/src/args.ts:134`、`packages/bundle/web-app/src/startup.ts:49` | 演示不露终端可不改 |

没有登录页、404/500 页、页脚、关于页，这几项不用找。

## 6. 本地运行

```sh
cd deepseek-harness
corepack enable                      # 仓库 pin pnpm@11.7.0；本机自带的 pnpm 9 不能用
pnpm --version                       # 应为 11.7.0；node 需 ^22.19 或 >=24
pnpm install
pnpm run build                       # native addon + host/client lib + web dist，首次必跑
pnpm dsh web --patch ./hongyang.cordis.yml   # 单进程：后端 + 静态前端，http://127.0.0.1:3080，自动开浏览器
pnpm run dev:web                     # 可选，另开终端：改客户端代码时增量重建（不能与 pnpm run build 并发）
```

- `apps/web` 不能单独 `vite dev`，会直接报错。
- `dsh --profile web --dump-config` 查看最终插件树，确认 `hy-*` 行都在。
- 模型配置：浏览器里 设置 → Models → Add provider → `anthropic`（或 Add a custom provider 填 OpenAI 兼容网关，协议 `anthropic-messages` / `openai-completions`）。写入 `$DSH_HOME/settings.yaml` 与 `$DSH_HOME/.credentials.yaml`，改完下一次请求生效，不用重启。默认 provider/model 在 `packages/bundle/base/cordis.patch.yml:75-79`。
- 数据目录 `$DSH_HOME`，默认 `~/.dsh`：`sessions/`（会话日志）、`attachments/v1/files/<sha256>/<原文件名>`（上传文件）、`settings.yaml`、`profiles/`。演示前清库就是删 `~/.dsh/hongyang/`。

环境变量：

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 可放根 `.env`；用 Anthropic 时可以不设 |
| `DEEPSEEK_BASE_URL` | 只能 export，不能放 `.env` |
| `DSH_HOME` | 数据根目录，只能 export |
| `DSH_PERMISSION_MODE` | 默认 `workspace-write`；演示可设 `danger-full-access` 免审批弹窗 |
| `DSH_TELEMETRY_DISABLED=1` | 关遥测 |
| `HY_DINGTALK_APP_KEY` / `HY_DINGTALK_APP_SECRET` | 钉钉机器人凭据，由 `hy-dingtalk` 插件 Config 用 `!!js process.env.…` 读 |

用户在浏览器拖入的文件：模型收到一段带绝对只读路径的文本句柄，`import_*` 工具接收该路径。xls/xlsx 不受类型限制，但仓库**没有**解析库，`hy-tool-import` 需自带（建议 SheetJS `xlsx`，同时支持旧 `.xls`）。

## 7. 排期（今天 2026-09-10）

| 日期 | 交付 |
|---|---|
| 9/10 | 环境跑通（pnpm 11、build、dsh web）；换壳；`hy-finance-db` + `hy-finance-core`（口径 section、费项表、calc_tax）；`hy-tool-import` 导真流水 |
| 9/11 | `hy-tool-claim` 三层匹配 + 待认领卡片（客户端模块 + `@Remote` 确认）；`hy-dingtalk` Stream 接入 + 两个 parse 工具 |
| 9/12 | 日报表 / 凭证 生成、导出、比对；看板；真数据替换；演示脚本走 3 遍 |
| 9/13 | 演示 |
