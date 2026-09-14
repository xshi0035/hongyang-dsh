---
description: "导入并认领弘阳收款，审阅收入日报表，准备金蝶凭证草稿。"
kind: "package-reference"
---

# @deepseek-ai/dsh-hy-finance

[English](README.md) | 中文

## 概述

财务用户可以导入商户应收、银行流水与支付平台对账单，审阅收款分配和收入日报表。本包支持报表与金蝶凭证草稿导出，并提供应收查询。每项金额、税额和拆分均由确定性 provider 代码计算。客户数据对账与钉钉卡片验收仍未完成；登记成功不等于已与银行流水对账。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

弘阳 Web profile 挂载本财务插件。通过其设置与会话工具导入文件、审阅待认领款项、生成报表及导出凭证草稿。[当前交接文档](../../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.zh.md) 记录已验证的启动方式与验收状态。

### 配置

[配置 schema](src/config.ts) 定义可接受的设置。数据库路径为空时在 `DSH_HOME` 下解析；更改数据库路径需要重启宿主。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dbPath` | `$DSH_HOME/hongyang/finance.db` | 配置字段为空时采用的 SQLite 数据库 |
| `autoOpenCards` | `true` | 审阅卡片默认展开 |
| `compareToleranceCents` | `1` | 比对金额容差，单位为分 |
| `outputTaxSubject13` / `outputTaxSubject3` | 空 | 已确认电费/水费销项税科目的可选覆盖值 |
| `companyName` | 衡阳诚远商业管理有限公司 | 付款图片校验期望的收款方 |

销项税覆盖值为空时使用[费项规则](src/rules/fee-types.ts) 中已确认的科目：13% 电费采用 `2221.01.02.13`，3% 水费采用 `2221.01.02.03`。其他费项缺少科目仍会阻止生成完整凭证。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[财务服务](src/service/finance-service.ts) 持有 SQLite 连接，将操作委派给 provider 模块。[工具](src/tools/plugin.ts) 将这些操作提供给 agent；[技能](src/skills/plugin.ts) 按需提供业务口径。[客户端视图](src/client/index.ts) 展示结构化结果和审阅动作。数据库是权威数据：schema 版本不兼容时拒绝启动，不会静默转换记录。

日报表比对在配对行后检查费项列；小计相等不代表分配相同。凭证导出的原币、借方与贷方金额单位均为元。显式指定账期的分配仅关联同账期应收。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [弘阳子系统](../../../docs/subsystems/hongyang.zh.md) — 财务服务与集成职责。
- [钉钉接入](../dingtalk/README.zh.md) — 会话草稿与传输限制。
- [当前交接文档](../../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.zh.md) — 已验证状态与未完成工作。
- [需求](../../../docs/hongyang/spec.zh.md) — 演示目标与历史规划。

<a id="model-experience"></a>
## 模型体验

### 财务身份与技能

#### 模型看到什么

根插件提供弘阳身份，并要求模型用财务工具完成算术。技能目录提供 `hy-finance`、`hy-daily-report` 和 `hy-voucher`；正文仅在请求时加载。这些文本描述公司主体、收款渠道、费项、税率规则、报表与凭证。

#### Token 影响

身份文本与技能描述增加提示词 token；按需加载的技能正文增加任务相关上下文。工具结果增加结构化财务记录，并以元展示格式化金额。具体 token 用量取决于任务与导入行数，本次修订未做测量。

#### KV Cache 影响

稳定的身份与技能文本可以在请求间保持不变。导入记录、查询结果与工具历史随任务变化；本包不控制也不保证提供方缓存复用。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 图片 provider 在写入前要求可核验的收款方、正数金额与有效支付时间，并保留交易单号。不完整证据不写库；商户或费项未解析时需要确认。网页图片登记与线上钉钉图片链路仍未接通。
- 部分费项没有已确认的预收科目。即使电费和水费销项税科目已配置，包含未决映射的凭证仍为草稿。
- 台账比对依赖客户日期与铺位号填写规范；缺少日期的行无法匹配。
- 自动费项分配根据简短付款备注推断意图。有证据的人工纠正不代表自动认领验收通过。
- 客户完整样本对账与真实卡片确认仍需验收；本地测试不能证明生产集成可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景</summary>

未发布 invariant companion：财务操作使用同一个 SQLite 权威来源，provider 测试覆盖计算与写入。组合验收和钉钉持久去重仍是当前交接文档中单独列出的工作。

</details>
