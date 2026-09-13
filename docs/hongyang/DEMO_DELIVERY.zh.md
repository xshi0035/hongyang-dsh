---
description: "弘阳财务演示交付：启动、能力、开发清单和结构。"
kind: "reference"
---

# 弘阳 Demo 交付说明

[English](DEMO_DELIVERY.md) | 中文

## 概述

本交付面向同事本地演示和继续开发，分支为 `test`。能力状态以 2026-09-13 交付时点为准；它不是正式记账或最终凭证验收通过的声明。Git 保存代码和客户样本；真实密钥及运行数据放在另外提供的私密交付包中。

## 目录

- [交付内容](#delivery)
- [启动步骤](#startup)
- [能力与开发清单](#capabilities)
- [项目结构](#structure)
- [演示流程](#demo)
- [开发备注](#dev-note)

<a id="delivery"></a>
## 交付内容

- `hongyang-test.bundle`：可离线克隆的 Git 仓库和 `test` 分支。
- 仓库内 `demo/sample.tar.gz`：完整 sample 目录，含原始账单、生成表格和历史数据库备份；先解压再作为工作区使用。归档附有 SHA-256 校验值。
- 仓库内 `docs/hongyang/samples/`：smoke 所需原始样本。
- `hongyang-test-private.tar.gz`：本地配置 `.env.local`、弘阳数据目录 `home/`，包含密钥、模型设置、插件清单、会话、附件及一致性备份的财务数据库。只发给获准接收这些资料的同事，不上传公共仓库。
- 私密包不包含 `node_modules` 和本机依赖符号链接；同事需安装适配其操作系统的依赖。

<a id="startup"></a>
## 启动步骤

以下是 macOS/Linux 操作顺序；需要 Node.js 22.19+（或 24+）、pnpm 11.7.0，以及项目原生组件所需的构建环境。跨机器完整冷启动尚未验收，不应省略依赖安装。

```bash
git clone -b test hongyang-test.bundle hongyang-demo
cd hongyang-demo
tar -xzf demo/sample.tar.gz
mkdir .demo-home
tar -xzf ../hongyang-test-private.tar.gz -C .demo-home
cp .demo-home/.env.local .env.local
export DSH_HOME="$PWD/.demo-home/home"
pnpm install --frozen-lockfile
pnpm run build
```

在 `DSH_HOME/profiles/web` 安装插件清单中的依赖，再返回仓库启动。如同事电脑未使用 7897 端口代理，应按其网络配置调整 `DSH_HOME/.env`，不能照搬原机器代理地址。钉钉 API 域名保留在 `NO_PROXY` 中。

```bash
(cd "$DSH_HOME/profiles/web" && pnpm install --frozen-lockfile)
DINGTALK_CLIENT_ID='' DINGTALK_CLIENT_SECRET='' node --env-file=.env.local --import tsx/esm apps/cli/src/bin.ts web --no-open
```

上述命令保留 Web 演示、暂不连接共享钉钉机器人。需要联调时先协调原机器人服务停止，再去掉两个空环境变量。首次打开终端打印的带 token 链接；重启后重新使用新链接。`pnpm dev:web` 只是前端构建监听器，不能代替 Web 服务。

在网页添加解压后的 `sample` 为工作区。旧会话保留的是原机器绝对路径；请新建演示会话并选择本机 sample，旧表格卡片不要作为跨机文件入口。Univer 如需查看表格，应由 agent 调用插件打开现有文件。

<a id="capabilities"></a>
## 能力与开发清单

| 模块 | 交付状态 | 能力与限制 |
|---|---|---|
| 弘阳界面与数据隔离 | 已验证本机启动 | 弘阳品牌、sample 工作区、独立 DSH_HOME；不能误启默认目录 |
| 导入与日结拆分 | smoke 通过 | 商户、应收、银行、微信、POS、充值、日报及凭证基准导入；19 笔日结匹配、3 笔未匹配 |
| 查询与认领 | 已实现 | 应收、商户余额、逾期、当日收款查询；待认领确认与费用分配；不应按金额猜测无归属 POS |
| 日报与表格 | 已实现、本机展示过 | 4 月 3 日日报 12 行、60,885.18 元；台账仍有差异；Univer 插件已安装，自动打开及跨机路径需彩排 |
| 凭证 | 可生成，最终验收未通过 | 持久库客户基准 9 行，系统最近生成 35 行，借贷平衡，匹配 6 行、差异 32 项、3 行科目待确认；差异原因尚未完整分类 |
| 科目规则 | 部分客户确认已录入 | 租金 2203.01.01、经营服务费 2203.01.02、电费预收 2203.30、水费预收 2203.31；13%/3% 销项税 2221.01.02.13 / 2221.01.02.03；停车等细分类仍需核实 |
| 付款登记 | 文字已实现 | 图片 provider 可校验收款方、金额和日期；网页图片参数和机器人视觉客户端尚未接入实际启动入口 |
| 钉钉 | Stream 连接已验证 | 消息回复尚未完成手机验收；用户会话、持久去重、平台交易合并、多费项拆分仍未完成；现有内存去重不能保证重启后不重复记账 |

所有金额计算应由财务 provider 执行，模型只选择工具和解释结果。测试通过不等于客户凭证验收通过；客户原始基准不可为了消除差异而改写。

<a id="structure"></a>
## 项目结构

```text
apps/cli/                         dsh launcher
apps/web/                         Web frontend
packages/bundle/web-app/           Web plugin composition
packages/hongyang/finance/src/
  service/                        Finance service and database lifecycle
  provider/                       Import, split, claim, query, register, report, voucher
  rules/                          Fee, account, tax, and money rules
  tools/                          finance_* tools
  client/                         Settings and finance cards
packages/hongyang/dingtalk/src/    Stream, reply bridge, image adapters
docs/hongyang/                    Requirements, design, handoff, samples
demo/                            Sample archive and configuration template
```

架构路径是“Web／钉钉 → 工具或桥接 → HyFinanceService → provider → SQLite／Excel”，Univer 负责展示审阅。插件市场、Univer、ChatVoice 的安装清单保存在私密包的 profile 中。

<a id="demo"></a>
## 演示流程

1. 新会话输入：“查看当前财务数据库状态和待确认事项。”
2. 输入：“查询围辣转转火锅的应收和已登记收款，结果以工具为准。”
3. 输入：“生成 2026-04-03 收入日报，自动调用 Univer 打开供审阅。”
4. 输入：“生成 2026-04-03 凭证并对比客户 voucher_row，展示具体差异，自动用 Univer 打开表格。”
5. 明确说明仍有未分类差异；文字登记只在演示副本中测试，避免污染源数据库。图片登记和钉钉回复不列为已验收的展示承诺。

回归命令：`node --import tsx/esm packages/hongyang/finance/tests/import.smoke.ts`。固定样本基线为商户 318、应收 3203、日结匹配 19／未匹配 3；该脚本使用隔离数据库。

<a id="dev-note"></a>
## 开发备注

继续开发优先级：凭证差异逐项追溯与未确认科目 → Univer 跨机展示彩排 → 图片端到端接入 → 钉钉持久去重与会话 → 手机验收。部署用配置优先于演示提示词；不要让模型自行补科目或计算金额。

本次交付验证：sample 的 20 个有效文件逐字节校验通过，数据库备份 integrity_check 为 ok，导入 smoke 通过，新增双语文档配对检查通过。全量 `pnpm lint` 未通过：财务模块已有 10 处类型 lint 问题，涉及 settings-card、identifiers、config、read-sheet、status、claim 和 webServer/plugin；交付整理未修改这些源文件。
