# Hongyang finance plugin design

English | [中文](design.zh.md)

Historical design snapshot, 2026-09-11; benchmark: the package structure and UI conventions of `dsh-univer-office` 0.2.14. The feature list and file tree below are design targets, not a completion report. Current status is in the [Claude handoff](CLAUDE_HANDOFF_2026-09-14.md).

## 1. Design choice

Two npm packages under `packages/hongyang/` are workspace packages loaded by a source-based `dsh web` launch:

| Package | Name | Responsibility |
|---|---|---|
| `packages/hongyang/finance` | `@deepseek-ai/dsh-hy-finance` | Finance master data, imports, claims, allocation, daily reports, vouchers, and queries; Host tools, skills, settings, and browser cards |
| `packages/hongyang/dingtalk` | `@deepseek-ai/dsh-hy-dingtalk` | DingTalk Stream robot entry: receive text and pictures, register through the finance service, and reply |

Like Univer, each package is layered by Cordis role, with the root plugin mounting roles in separate fibers. Models perform recognition, extraction, and conversation. Deterministic providers calculate amounts, taxes, allocations, and voucher lines (**models do not handle monetary calculation**).

## 2. Required user capabilities

These targets correspond to the eight-step demo script.

1. Finance staff drop a CCB XLS statement into chat and ask to import and claim it. Tools import, split settlements, and run three-level matching. A **pending-claims card** at the turn tail shows unmatched counts and suggestions.
2. A user selects and confirms a merchant on the card. The system writes the allocation and remembers the payer for later matching by name.
3. WeChat and POS statements split settlement receipts into individual entries. Electricity orders identify merchants from “商户:xx-铺位”; POS entries without notes remain pending.
4. Operations staff send a payment screenshot and a sentence in DingTalk. The robot replies with the registered merchant, fee, and amount, or asks for the merchant when it cannot identify one.
5. A request for the April 3 income report generates a 34-column XLSX, compares it row by row with the customer ledger, and shows a **daily-report card** with totals, sources, and discrepancy counts. Univer opens the comparison alongside the report.
6. A request for April 3 vouchers generates 21-column Kingdee Cloud Galaxy vouchers from the report, validates tax rates and output-tax accounts, and shows an exportable **voucher card**.
7. Queries such as “愤怒弹珠还欠多少” and “欠费超过 30 天的有哪些” receive direct answers and tables.
8. A Hongyang finance settings card exposes the database path, tax-account mappings, unresolved accounts, DingTalk credentials, and automatic card expansion.

## 3. Proposed finance package structure

```text
packages/hongyang/finance/
  package.json                 # exports ".", "./client"; dsh.client { platform: web, inject: [...] }
  README.md / README.zh.md
  skills/
    hy-finance/SKILL.md        # 业务口径：费项/税率/科目/摘要模板/拆分规则/术语（frontmatter + 正文）
    hy-daily-report/SKILL.md   # 日报表 34 列口径与比对流程
    hy-voucher/SKILL.md        # 凭证行序、税额规则、校验点
  src/
    index.ts                   # 根组合插件：挂 provider、tools、skills、settings、webServer
    config.ts                  # Config schema：dbPath、taxTable、subjectCodes、autoOpenCards、compare 容差
    shared/wire.ts             # Host/Client 共享纯 JSON 类型（卡片模型、工具结构化结果）
    service/
      finance-service.ts       # Service Definition（ctx.hyFinance）
      types.ts                 # Merchant / Receivable / Transaction / Allocation / VoucherLine
      identifiers.ts           # Branded ids（MerchantId、TransactionId、AllocationId、BatchId）
      errors.ts                # 稳定领域错误码
    provider/
      plugin.ts                # Service Provider
      db/schema.ts             # node:sqlite，PRAGMA user_version = SCHEMA_VERSION，权威数据不迁移即拒绝
      db/repositories.ts       # 表访问，事务
      import/bank-ccb.ts       # 建行 xls：sheet 建行2038，贷方>0；渠道识别（财付通/银联商务/捷停车/抖音/对公/个人）
      import/wechat-csv.ts     # 微信对账单（GBK）：商户号→来源枚举；商品名解析"商户:名-铺位 电表:n"
      import/unionpay-pos.ts   # 银联 POS 对账单：清算时间、清算金额、付款附言
      import/recharge.ts       # 电表充值记录：商户-铺位、电表号、充值方式
      import/receivable.ts     # 租费应收明细表：主数据 upsert + 应收/已收/未收（租费 sheet + 水电 sheet）
      import/ledger.ts         # 贺部长台账（比对基准）
      import/voucher-xlsx.ts   # 客户凭证（比对基准）
      split/settlement.ts      # T+1 日结拆分：财付通=前一日微信净额，银联=前一日 POS 清算；差额挂待认领
      claim/engine.ts          # L1 户名精确 / L2 备注抽取+模糊 / L3 金额匹配 → pending
      claim/allocate.ts        # 拆分规则：明细优先，否则按未收顺序 rent>service>promo>elec>water，余额暂收款
      rules/fee-types.ts       # 22 个费项枚举（与日报表列序一致）、税率、科目
      rules/tax.ts             # tax = round(incl/(1+r)*r, 2)
      rules/summary.ts         # 摘要模板
      report/daily-report.ts   # 34 列日报表构建 + exceljs 导出（合计行公式）
      report/compare.ts        # 与台账逐行比对（键：日期+铺位+商户+来源+金额）
      voucher/build.ts         # 从日报表生成凭证行；税率↔销项税科目校验
      voucher/export.ts        # 21 列 xlsx
      voucher/compare.ts       # 与客户凭证比对
      query/dashboard.ts       # 应收汇总、商户余额、逾期、今日收款
      extract/receipt.ts       # 截图 + 一句话 → {金额、时间、单号、商户、费项[]}，走 ctx.llm.stream，结构化用 JSON 解析 + zod 校验
    tools/
      plugin.ts                # Tools Consumer
      presentation.ts          # 纯函数卡片投影（Host 侧）
      definitions/
        import.ts              # finance_import { file, kind? } → { batchId, kind, rows, split, claimed, pending }
        claim.ts               # finance_claim { action: run|list|confirm|learn, ... } → 结构化认领结果
        report.ts              # finance_daily_report { action: build|export|compare, date } → { reportId, rows, totals, xlsxPath, diff }
        voucher.ts             # finance_voucher { action: build|export|compare, date } → { voucherId, lines, checks, xlsxPath }
        query.ts               # finance_query { kind: receivable_summary|merchant_balance|overdue|today, ... }
        register.ts            # finance_register { text, image? } → 登记结果（钉钉与网页共用）
    skills/plugin.ts           # bundled Skill Provider：按需加载三份 SKILL.md
    settings/plugin.ts         # ctx.settings.installSection('hy-finance', Config)
    webServer/plugin.ts        # /hy-finance-api/*：卡片需要的状态读取与确认动作（同源 POST，会话授权）
    client/
      index.ts                 # 注册 locale、turn 投影、tool views、turn-tail 卡片、设置卡
      locales.ts               # zh / en
      turn-projection.ts       # 纯 reducer：从 tool/call、tool/result 恢复本回合的认领/日报表/凭证结果
      cards/PendingClaimsCard.tsx   # 待认领：每行商户下拉 + 拆分预览 + 确认；确认走 ctx.remote.hyFinance.confirm
      cards/DailyReportCard.tsx     # 合计、来源分布、比对差异徽章、"在 Univer 中打开"
      cards/VoucherCard.tsx         # 借贷平衡、校验标红、导出
      toolviews/*.tsx               # finance_* 每个工具的紧凑行
      settings/FinanceSettingsCard.tsx
```

## 4. Proposed SQLite data model (`$DSH_HOME/hongyang/finance.db`)

```
import_batch    id, kind(bank|wechat|pos|recharge|receivable|ledger|voucher), file, sha256, rows, imported_at
merchant        id, shop_no, name, brand, floor, contract_from, contract_to
receivable      id, merchant_id, fee_type, period_start, period_end, due_date, amount_due, amount_relief, amount_received, amount_unpaid, source_row
payer_mapping   payer_name, payer_account?, merchant_id, confirmed, learned_at
transaction     id, batch_id, source(bank2038|bank2035|pingan|pos|wechat706|wechat380|dingtalk),
                txn_time, amount, payer_name, payer_account, remark, txn_no, channel(tenpay|unionpay|parking|douyin|transfer),
                parent_id?, status(auto|manual|pending|settlement), merchant_id?, confidence, raw
platform_txn    id, transaction_id(日结那笔), platform(wechat|pos), order_no, txn_time, amount, fee, net, note, merchant_hint, shop_no?
allocation      id, transaction_id, platform_txn_id?, merchant_id, fee_type, period_start, period_end,
                amount_incl_tax, tax_rate, tax_amount, created_by(engine|user|dingtalk), created_at
daily_report    id, date, built_at, rows_json, xlsx_path, compare_json
voucher         id, date, built_at, lines_json, checks_json, xlsx_path
```

Source enums correspond to the report’s receipt-source column: bank transfer 2038, bank transfer 2035, Ping An Bank, POS receipts, enterprise WeChat 706, and enterprise WeChat 380.

## 5. Rules inferred from the sample data

- The CCB 2038 sample has 46 credit entries for April 1–8. Counterparty names containing “财付通” identify WeChat settlements, with `MMDD_商户号` in the note; “银联商务” identifies POS settlements with `MMDD-MMDD费x元`; “捷停车” identifies parking; “抖音” is ignored.
- Tenpay receipts equal the **previous day’s** WeChat order settlement amounts minus fees (all 16 sample entries were checked). UnionPay receipts equal the **previous day’s** POS settlement amounts and may arrive in two receipts.
- WeChat merchant 706 is the electricity top-up mini-app; a product name such as `商户:趣捞鱼-3033 电表:1` identifies the merchant and shop. Merchant 380 contains parking charges and is not split by merchant.
- Of 814 POS entries, 699 lack payment notes and require operations reports or manual claims.
- Ledger granularity is one receipt per merchant per row, with separate fee columns. Negative amounts can represent suspense reversals or conversion of earnest money into deposits.

## 6. Structured tool results

Tools return replayable JSON with stable IDs. Client reducers consume structured fields rather than parsing prose. The current [shared wire types](../../packages/hongyang/finance/src/shared/wire.ts) own the claim and report fields:

```ts
export type {
  ClaimMetaWire,
  ReportMetaWire,
} from '@deepseek-ai/dsh-hy-finance'
```

## 7. Proposed UI conventions following Univer

- Turn-tail cards have a compact header with title, date or batch, status, collapse, and fullscreen controls, followed by a table. Historical turns default to collapsed. Actions stay within the card, without an external action footer.
- Each pending-claim row shows amount, payer, note, suggested merchants with confidence indicators, merchant selection, allocation preview, and confirmation. Confirmation changes the row to claimed and shows its summary.
- All UI copy comes from locale dictionaries, with Chinese as the default.
- Colors use semantic `--dsw-alias-*` tokens rather than fixed values.

## 8. Dependencies

- Spreadsheet reading: `xlsx` (SheetJS for XLS/XLSX/CSV) and `iconv-lite` (WeChat CSV uses GBK).
- Spreadsheet writing: `exceljs` for styles, formulas, and merged cells.
- DingTalk: `dingtalk-stream`, using Stream mode without a public callback endpoint.
- Database: Node's built-in `node:sqlite`.

## 9. Planned implementation order

| Step | Work | Acceptance target |
|---|---|---|
| 1 | Package skeleton, Config, SQLite schema, service definition, root plugin in Web profile | `dsh web` starts without errors and settings show Hongyang finance |
| 2 | Seven importers and settlement splitting | Import 46 receipts; split 16 Tenpay and 6 UnionPay settlements with equal totals |
| 3 | Claim engine, finance_claim, and pending-claims card | Automatically claim at least 35 of 46 receipts; confirming 涂小兰 → 炊牛大烩 writes payer_mapping |
| 4 | Report build, export, comparison, and card | All 14 April 3 ledger rows match |
| 5 | Voucher build, export, comparison, and card | April 3 debit, credit, and accounts match the customer vouchers; tax validation identifies 依沐裳 |
| 6 | Query and registration tools with screenshot extraction | Answer “愤怒弹珠还欠多少” and register a dropped screenshot |
| 7 | DingTalk Stream robot | Reply with a registration result within three seconds of a mobile text-and-image message |
| 8 | Rehearse the demo three times and complete the README | — |
