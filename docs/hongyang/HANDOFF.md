---
description: "Historical Hongyang development handoff with a link to the current implementation state."

kind: "reference"
---

# Hongyang Plaza AI finance assistant · historical handoff

English | [中文](HANDOFF.zh.md)

Historical snapshot from 2026-09-11, preserved for background. Startup, branches, acceptance numbers, and open work have changed; use the [2026-09-14 handoff](CLAUDE_HANDOFF_2026-09-14.md) for current work. The deletion, uninstall, and commit instructions below are historical records, not authorization to execute them.

For the developer taking over the project (or Codex). Snapshot: evening of 2026-09-11. Demo date: **2026-09-13**.

Read in order: this page → [spec.md](spec.md) (requirements) → [design.md](design.md) (design) → `packages/hongyang/finance/README.md` → run the acceptance script (§7). **Understand the running system before changing code.**

---

## 1. The problem

Customer: Hengyang Hongyang Plaza, a shopping complex with more than 300 merchants, operated by the legal entity “衡阳诚远商业管理有限公司”. Its accounting system is Kingdee Cloud Galaxy. Contacts: Zhou Xiao (coordination), Director He (receipt registration), and Hua Xinyu (accounting).

**Customer pain:** receipts arrive through several channels (two CCB accounts, Ping An Bank, UnionPay POS, and two WeChat merchant accounts). Director He manually identifies each payment's merchant, fee, and billing period and enters it in a 34-column daily income spreadsheet. Hua Xinyu then enters Kingdee vouchers from that report. Most POS receipts lack a payment note, so only the on-site operations staff know the payer's merchant.

**Demo goals** (the eight-step script is in spec §4):

1. Operations sends a payment screenshot and a short message through DingTalk → the robot replies “registered”.

2. Finance uploads bank transactions → most are claimed automatically, the remainder need card confirmation, and payer mappings are remembered.

3. “Generate the April 3 income report” → a 34-column xlsx, previewed in Univer inside the conversation and compared row by row with Director He's ledger.

4. “Generate April 3 vouchers” → 21-column Galaxy vouchers, with tax-rate validation and comparison against customer vouchers.

5. “How much does 愤怒弹珠 still owe?” → a direct answer.

**Rule:** the model understands intent, chooses tools, and explains results. Deterministic code calculates amounts, tax, splits, and voucher lines (`packages/hongyang/finance/src/provider/`). The model performs no financial arithmetic.

---

## 2. Customer materials and their purpose

The files are under `docs/hongyang/samples/` (ignored by Git, containing real customer data; **do not commit or distribute**). A copy is in the demo workspace `/Users/shixin/Desktop/sampel/`.

| File | Content | System role | Importer |
|---|---|---|---|
| `建行流水_2026-04-01_08.xls` | 46 receipts in CCB account 2038 and one in 2035, April 1–8 | **Primary transactions.** Counterparty selects channel: 财付通 = WeChat settlement, 银联商务 = POS settlement, 捷停车 = parking, 抖音 = ignored, 衡阳诚远 = ignored internal transfer, others = corporate/personal transfer | `import/bank-ccb.ts` |
| `微信小程序1693395706_*.csv` | 402 orders for merchant account 706, electricity top-up mini-app, GBK encoding | Splits Tenpay settlements by merchant. Product name `商户:趣捞鱼-3033 电表:1` directly identifies merchant and shop | `import/platform.ts` importWechat |
| `微信小程序1723333380_*.csv` | 2,157 orders for merchant account 380, all parking | Splits Tenpay settlement; records parking without assigning merchants | Same as above |
| `pos扫码 2026.4.1-2026.4.30.xlsx` | 814 UnionPay transactions; row 1 is a summary, row 2 contains headers | Splits UnionPay settlements. 699 of 814 transactions have no note and need operations reports or manual claims | `import/platform.ts` importUnionPayPos |
| `充值记录(2026.4.1-30).xls` | 449 meter top-ups with merchant/shop, meter number, and payment method | Cross-reference from electricity orders to merchants; stored but not used in calculations | `import/platform.ts` importRecharge |
| `4月结算账单列表-平安银行.xlsx` | 21 daily parking-system settlements | Not imported; parking uses 捷停车 credits in the CCB statement | None |
| `租费应收明细表.xlsx` | July 2025–April 2026; 2,111 rent rows and 1,138 utility rows | **Merchant master data** (shop, signatory, brand, floor) plus receivable/received/unpaid amounts by period; used by claims matching | `import/receivable.ts` |
| `2026.4.1-4.30收入日报表.xlsx` | Director He's manual ledger: 792 rows, 35 columns, including an extra 代收款 column | **Reference answer:** daily-report comparison baseline | `import/reference.ts` importLedger |
| `凭证_2026-04-01_08.xlsx` | 134 Galaxy voucher rows, April 1–8 | **Reference answer:** voucher comparison baseline | `import/reference.ts` importVoucherXlsx |
| `收入日报表格式.xlsx` | Customer output format, 34 columns | Report export layout; column order is in `rules/fee-types.ts` | None |
| `应收表_截图.png`, `付款截图_银联商务.jpg` | Screenshots | The payment screenshot is an input example for DingTalk extraction | None |

### Three verified settlement rules used by the code

1. **Tenpay settlement equals the previous day's WeChat “settled order amount − fee” total.** All 16 matched to the cent. Note `MMDD_商户号` identifies the merchant account.

2. **UnionPay settlement equals POS settlement amounts within the note's date range** (for example `0403-0406费50.98元`). One day can have two credits split by fee tier; reconcile the grouped date range.

3. **Director He's ledger uses one merchant/payment per row**, with fees in separate columns and possible negative offsets. A single payment can occupy two rows for different billing periods.

Three April 1 settlement credits require March 31 details. The customer did not provide the March 31 statements, so this is a data gap.

---

## 3. Code location and execution

### Repository and environment

- Repository: `/Users/shixin/Desktop/广场dsh/deepseek-harness`, a DeepSeek Harness (dsh) fork. `origin` is private `github.com/xshi0035/hongyang-dsh`, branch `hongyang-demo`; `upstream` is official DeepSeek, and `master` is unchanged.

- Follow upstream engineering rules in [AGENTS.md](../../AGENTS.md) when changing the platform, and project rules in [CLAUDE.md](../../CLAUDE.md).

- Use Corepack pnpm 11.7.0 at `/opt/homebrew/bin/pnpm`; `~/.npm-global/bin/pnpm` on PATH is 9.x and causes errors.

- Isolated data directory: `DSH_HOME=~/.dsh-hongyang`; another project owns `~/.dsh`. The proxy is in `~/.dsh-hongyang/.env` (`HTTPS_PROXY=http://127.0.0.1:7897`); OpenAI requests time out without it.

- Model: the settings page has an OpenAI provider (pi-ai); the demo uses GPT-6 Astra.

### Startup

```bash
cd /Users/shixin/Desktop/广场dsh/deepseek-harness
export PATH=/opt/homebrew/bin:$PATH DSH_HOME=$HOME/.dsh-hongyang
pnpm dsh web --no-open        # 打印带 token 的 URL，必须用它打开；根路径 401 是正常的
```

The Claude desktop app's `dsh-web` entry in `广场dsh/.claude/launch.json` runs this command.

### Applying code changes

- **Host** (everything under `src/` except `client/`): source launch loads `src/` through tsx, so **restart the service** without a build.

- **Client** (`src/client/`): run `pnpm run build` (approximately 90 seconds for the repository), then restart.

- Run focused type checking with `node ./node_modules/typescript/bin/tsc -b packages/hongyang/finance/tsconfig.host.json` (or `tsconfig.client.json`).

- Before a commit, lefthook runs oxlint (including max-len 140) and third-party notices; lint failures block the commit.

### Package structure (`packages/hongyang/finance`, named `@deepseek-ai/dsh-hy-finance`)

The Univer-style package separates Cordis roles internally. Mount: the final `hy-finance` row in `packages/bundle/web-app/cordis.patch.yml`; aliases are in root `tsconfig.base.json`; the `tsconfig.host.json` and `tsconfig.client.json` aggregates each reference their compiler face.

```text
src/
  index.ts                  根插件：挂 service、tools、skills、settings、webServer；常驻 system prompt 身份段
  config.ts                 Config（dbPath、autoOpenCards、compareToleranceCents、outputTaxSubject13/3、companyName）
  rules/fee-types.ts        22 个费项（列序=日报表）、税率、预收科目、中文别名解析、冲抵优先级
  rules/tax.ts              整数分运算，tax = round(incl/(1+r)*r, 2)
  rules/summary.ts          凭证摘要模板
  service/finance-service.ts  ctx.hyFinance：持 SQLite 句柄，所有操作的门面
  service/types.ts, identifiers.ts, errors.ts
  provider/db/schema.ts     11 张表，PRAGMA user_version = 2，版本不符拒绝启动
  provider/db/repo.ts       行访问
  provider/import/*         七个导入器 + kind 自动识别（index.ts）
  provider/split/settlement.ts  T+1 日结拆分
  provider/claim/match.ts   三层匹配 → Suggestion[]
  provider/claim/allocate.ts    拆分登记 + 税额
  provider/claim/engine.ts  runClaims / listPending / confirmClaim / learnPayer
  provider/report/daily-report.ts  日报表构建、exceljs 导出、四轮比对
  tools/definitions/*       finance_status / finance_import / finance_claim / finance_daily_report
  webServer/plugin.ts       GET /api/hy-finance/merchants, POST /api/hy-finance/claim/confirm（卡片用）
  skills/plugin.ts          三份 SKILL.md 的按需加载
  settings/plugin.ts        设置命名空间 hy-finance
  shared/wire.ts            Host/Client 共享 JSON 类型（卡片元数据）
  client/                   设置卡、待认领卡片、日报表卡片（tool.call.toolview 键 finance_claim / finance_daily_report）
skills/hy-finance, hy-daily-report, hy-voucher   业务口径技能
tests/import.smoke.ts       真实数据验收脚本
```

Database: `~/.dsh-hongyang/hongyang/finance.db`. The historical procedure for a schema change was to increment `HY_FINANCE_SCHEMA_VERSION`, delete this file, and reimport, with no migration.

---

## 4. Completed work (four commits on `hongyang-demo`)

| Step | Commit | Acceptance result with real data |
|---|---|---|
| 1 Skeleton | `53ee9229ab` | The settings page shows 弘阳财务; database creation is automatic |
| 2 Imports and splitting | `ed3af15a13` | 47 transactions, 342→318 merchants after shop-number normalization, 3,203 receivables; 19 of 22 settlements match exactly, three lack March 31 details |
| 3 Claims and cards | `d4fe8e9cfc` | 12 of 18 transfers registered automatically, two unresolved and other internal transfers ignored; parking 4, WeChat electricity 87, POS notes 6; card confirmation → Host write → model context |
| 4 Reports, comparison, cards | `9d8f0d09fb` | April 3: 12 generated rows versus 14 ledger rows, 11 matched; reasons identified for three differences; xlsx opens through Univer in the conversation |

Branding, colors, Chinese copy, and dark theme were also completed and pushed.

---

## 5. Unfinished work by demo priority

### Step 5: Vouchers (P0; April 3 acceptance)

- `provider/voucher/build.ts`: input is the day's report rows. Follow sample order: debit 1002.02 bank total / debit 1012.08 POS total; per merchant/fee, credit advance receipts including tax → debit advance receipts tax → credit output VAT. Untaxed fees use one credit; unclaimed receipts credit 2203.01.05. Summaries use `rules/summary.ts`.

- Validate balanced debits/credits and matching fee tax rates/output-VAT accounts (9% only uses 2221.01.02.09); highlight mismatches. The 依沐裳 sample posts 9% rent tax to a 6% account.

- At this snapshot, 13% and 3% output-VAT accounts were unconfirmed (`config.outputTaxSubject13/3` empty), so electricity/water vouchers were drafts with unresolved items. Twelve advance-payment fee accounts also had `subject: null` in `FEE_RULES` and required the same treatment.

- `provider/voucher/export.ts`: 21-column xlsx; headings are in spec §3. `compare.ts` compares `voucher_row` by date, account, debit/credit direction, and amount.

- Tool: `finance_voucher { action: build|export|compare, date }`, metadata `card: 'hy-finance/voucher'`; add `VoucherToolView` using the two existing examples in `FinanceToolViews.tsx`.

- Inspect sample vouchers first: `sqlite3 ~/.dsh-hongyang/hongyang/finance.db "select date,voucher_no,line_no,summary,subject,debit,credit from voucher_row where date='2026-04-03' order by voucher_no,line_no"`.

### Step 6: Queries and registration (P1)

- `finance_query { kind: receivable_summary|merchant_balance|overdue|today, ... }`: SQL queries; find “愤怒弹珠” through fuzzy brand lookup with `MerchantIndex.mentionedIn`.

- `finance_register { text, image? }`: shared by DingTalk and Web. Use `ctx.llm.stream()` for image input, request JSON and validate with zod; extract amount, time, order number, and payee. Validate payee against `config.companyName`; extract merchant and fee/amount pairs from text. Write `transaction(source='dingtalk')`, attempt merging with `platform_txn` by transaction number or amount and a ±2-minute window; call `confirmClaim` for a matched merchant, otherwise request the merchant name. See the one-shot call in `packages/session/session-title-llm/src/index.ts:254`.

### Step 7: DingTalk (P1, required by the user)

- New `packages/hongyang/dingtalk` package (`@deepseek-ai/dsh-hy-dingtalk`), using npm `dingtalk-stream` 2.1.6; Stream needs no public callback server.

- Receive text/picture (download via downloadCode) → create/resume an agent session by DingTalk userId → call `finance_register` → return merchant/fee/amount confirmation or a follow-up question.

- The user supplies robot AppKey/AppSecret and a phone acting as operations. Credentials belong in `ctx.credentials` or a settings secret field, never Git.

### Step 8: Demo rehearsal

- Run the eight steps in `docs/hongyang/spec.md` §4 three times and record token usage. This snapshot measured about 240K for an import and 390K for a report, with over 90% cache hits; avoid unrelated tool calls.

- Historical cleanup plan: uninstall `dshmarket` and `dsh-find-plugin`, disable Univer telemetry, and clear test conversations from `~/.dsh-hongyang`.

### Smaller unfinished items

- Replace the DeepSeek thinking text “深度求索中...” in `packages/client/ui-chat/src/client/locale.ts:25` with “思考中...”.

- The user had not decided whether bubbles should show “财务助手” instead of GPT-6 Astra.

- `finance_status` listed unresolved accounts from `FEE_RULES` only, without using settings `outputTaxSubject13/3`; voucher implementation needed those values.

---

## 6. Known concerns to review before editing

**Business logic**

1. **Unpaid balance semantics.** Customer receivables are a retrospective snapshot with April receipts already marked paid. `allocate.ts` therefore derives open balance from local allocations (`allocation.receivable_id`) rather than imported received/unpaid fields. Default allocation runs from the newest period backwards; a multi-month payment can become several rent rows (奥龙鞋业 55743.60 covers three months), unlike the customer ledger. Explicit month notes such as “5-6月租金” narrow the allocation.

2. **Multiple legal entities under one brand.** 发发桌球 has two signatories, 湖南发发竞技 and 湖南亮点. Brand-only notes can select the wrong entity. A brand match scores 0.88 and auto-registers above 0.85; consider 0.7 and manual review for ambiguous brands.

3. **All WeChat electricity is recorded as prepaid** (`elec_pre` in `engine.ts`); some ledger entries may be postpaid and have not been checked.

4. **654 WeChat parking orders are registered individually** and aggregated into one report row per day. Vouchers also need aggregation.

5. **Manual fee splitting:** cards send only a shop number and code infers the fee; `finance_claim confirm` supports explicit `splits`, but the card has no corresponding input.

6. **157 POS transactions without notes** require DingTalk reporting (step 7) or one-by-one manual confirmation.

7. **Loose comparison keys:** the third of four matching rounds uses only source and amount; two merchants with equal amounts could be paired incorrectly. This did not occur in April 1/3 samples.

8. **捷停车 credits** use the arrival date locally, while the customer ledger may use the business date or another channel, producing generated-only differences.

**Code**

9. The confirmation route in `webServer/plugin.ts` relies on a login cookie and accepts a frontend `sessionId` without checking session ownership. The snapshot treated this as a local-demo limitation to fix before delivery.

10. Every build appends a `daily_report` row without cleanup, so `rows_json` grows.

11. `importRecharge` stores top-ups in `platform_txn` with `platform='wechat'` and `merchant_account='recharge'`; consumers exclude them with `<> 'recharge'`. This is temporary, and top-ups do not participate in calculations.

12. The snapshot had only `tests/import.smoke.ts`, no vitest cases. Repository-required composition tests were missing.

13. Each `tools/definitions/*.ts` file defined a structural `JsonValue` for `type: 'json'` outputs; replace it with `@deepseek-ai/dsh-util-values` and add the tsconfig reference.

14. Two client cards share `PendingClaimsCard.module.css`; its `--dsw-alias-*` tokens are appropriate, but the filename is misleading.

15. Configuration changes through `installSection` in `settings/plugin.ts` call `reconfigure`, but `dbPath` requires a restart, as the settings card explains.

16. Branding changed favicon expectations in `apps/web/tests/pwa-manifest.e2e.ts`; other upstream e2e tests had not run.

---

## 7. Acceptance script after backend changes

```bash
cd /Users/shixin/Desktop/广场dsh/deepseek-harness
node --import tsx/esm packages/hongyang/finance/tests/import.smoke.ts
```

The in-memory database runs eight imports → splitting → claims → April 1/3 report comparisons. These were the historical baseline numbers:

- `split matched 19 unmatched 3` (the three unmatched credits are April 1 and require March 31 details)

- `claims run: bankAuto 12, parkingAuto 4, wechatElectricity 87, posAuto 6, pending 18`

- `report 2026-04-03: matched 11 missing 3 extra 1 amount 0`

UI acceptance follows `docs/hongyang/spec.md` §4 in workspace `/Users/shixin/Desktop/sampel`.

---

## 8. Historical first instruction for Codex

> Read `docs/hongyang/HANDOFF.md`, then `docs/hongyang/spec.md`, `docs/hongyang/design.md`, and `packages/hongyang/finance/README.md`. Run `node --import tsx/esm packages/hongyang/finance/tests/import.smoke.ts`, compare its key figures with HANDOFF §7, and report differences. Read `packages/hongyang/finance/src/` and review the 16 concerns in HANDOFF §6 before changing code. Then implement step 5 vouchers as described in HANDOFF §5, comparing April 3 output line by line with customer data in `voucher_row`. Keep financial calculations in `provider/`. Run the smoke script after each step and commit passing work to `hongyang-demo`.
