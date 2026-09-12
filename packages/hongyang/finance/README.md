# @deepseek-ai/dsh-hy-finance

弘阳广场 AI 财务助手的财务领域插件：商户主数据、银行流水与平台对账单导入、日结拆分、收款认领、收入日报表、金蝶凭证、欠费查询。一个 npm 包，内部按 Cordis 角色分层（service / provider / tools / skills / settings / client）。

设计文档：[docs/hongyang/design.md](../../../docs/hongyang/design.md)。需求：[docs/hongyang/spec.md](../../../docs/hongyang/spec.md)。

## 组成

| 角色 | 位置 | 说明 |
|---|---|---|
| Service + Provider | `src/service/finance-service.ts`、`src/provider/` | `ctx.hyFinance`，持有 SQLite 句柄，实现全部领域操作 |
| Tools | `src/tools/` | `finance_status`、`finance_import`、`finance_claim`、`finance_daily_report`、`finance_voucher`、`finance_query`、`finance_register` |
| Skills | `skills/` | `hy-finance`、`hy-daily-report`、`hy-voucher` |
| Settings | `src/settings/` | 命名空间 `hy-finance` |
| Client | `src/client/` | 设置卡、工具行、回合尾部审阅卡片 |

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `dbPath` | `$DSH_HOME/hongyang/finance.db` | SQLite 文件 |
| `autoOpenCards` | `true` | 审阅卡片默认展开 |
| `compareToleranceCents` | `1` | 与台账比对的金额容差（分） |
| `outputTaxSubject13` / `outputTaxSubject3` | 空 | 13% 与 3% 销项税科目，待客户确认 |
| `companyName` | 衡阳诚远商业管理有限公司 | 收款方校验 |

## Model Experience

- 系统提示词常驻一段身份与规则（约 200 字）；三份技能按需加载。
- 工具返回结构化 JSON，金额为元的两位小数；模型不做算术。
- 日报表配对后逐费项比较，费项金额不同也计入金额差异；小计相等不能证明费项一致。
- 凭证按已确认的税率科目表生成；原币、借方和贷方导出金额均为元。显式指定账期的拆分仅关联同账期应收。
- 数据库是权威数据：`PRAGMA user_version` 不匹配即拒绝启动，不迁移。

## Known Limitations and Deferred Work

- 13% 与 3% 销项税科目未确认前，含电费或水费的凭证只生成草稿。
- 比对键依赖客户台账的日期与铺位号填写规范；台账缺日期的行无法匹配。
- 自动认领依据简略付款备注推断费项，可能与客户真实拆分不同；有凭据的人工纠正不代表自动认领验收通过。
- 回归验证：`node --import tsx/esm --test packages/hongyang/finance/tests/voucher-audit.test.ts`；真实样本验收仍使用 `tests/import.smoke.ts`。
