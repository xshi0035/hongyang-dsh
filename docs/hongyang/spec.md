---
description: "Historical Hongyang demo requirements with a link to the current implementation state."

kind: "reference"
---

# Hengyang Hongyang Plaza · finance agent demo plan (v2)

English | [中文](spec.zh.md)

Historical demo plan from September 2026. Package names, proposed APIs, schedules, and acceptance targets below describe planning intent, not verified delivery. Use the [2026-09-14 handoff](CLAUDE_HANDOFF_2026-09-14.md) and package READMEs for the current implementation.

> Deadline: demo on 2026-09-13 | Development window: evening of September 9–12

> Foundation: dsh agent runtime, unchanged | Deliverables: plugins (business rules, tools, artifacts) | Input: DingTalk robot

> Customer entity: 衡阳诚远商业管理有限公司 | Accounting system: Kingdee Cloud Galaxy | Contacts: Zhou Xiao, He Hongfu (registration), Hua Xinyu (accounting)

> Samples: CCB xls (2035/2038 sheets), Galaxy vouchers (21 columns), **daily income report xlsx (34 columns, the customer's required output)**, operations receivables screenshot

**Sample files** (in this directory's `samples/`):

| File | Description |
|---|---|
| `samples/建行流水_2026-04-01_08.xls` | CCB transactions, April 1–8, 2026; 2035/2038 sheets |
| `samples/凭证_2026-04-01_08.xlsx` | Customer's manually prepared Kingdee Cloud Galaxy vouchers, April 1–8, 21 columns |
| `samples/收入日报表格式.xlsx` | Director He's 34-column daily income report, the required output format |
| `samples/应收表_截图.png` | Operations receivables: period, shop, merchant, brand, fee, due, received, unpaid |
| `samples/付款截图_银联商务.jpg` | Operations photo of a UnionPay payment-success page, input example for DingTalk `parse_payment_screenshot` |

---

## 0. Product form

```
运营部（手机钉钉）                      财务部（浏览器）
拍付款截图 + 打一句话                    打开"弘阳 AI 财务助手"（dsh 换壳）
        │                                        │ 对话："导入今天流水" "出4月3日凭证"
        ▼                                        ▼
  钉钉机器人（Stream 模式）  ──────►  dsh Agent Runtime  ◄──────  会话 UI + artifact
                                          │
                                   加载插件 hy-finance-*
                                   ┌──────┴───────┐
                                   业务口径(skill)  工具(tools)  artifact 模板
                                   费项/税率/科目   导入/认领/    待认领表格
                                   摘要模板/拆分规则 拆分/凭证     凭证预览/看板
                                          │
                                       SQLite
```

- Keep dsh logic and change branding to “弘阳 AI 财务助手”, removing dsh/DeepSeek branding; switch the model provider.

- Deliver every business capability as a plugin installed through dsh-platform, demonstrating platform-plus-plugin distribution.

- DingTalk and browser conversations should share the same agent, tools, and database.

- **Output sequence:** payment reports/statements → claims and splitting → **daily income report** (Director He's 34-column sheet, one per day) → vouchers generated from the report. The customer-required format is `samples/收入日报表格式.xlsx`.

---

## 1. Two platform changes

### 1.1 Branding

Search checklist: product name, title, favicon, logo, login branding, footer, about, version, GitHub links, package.json, 404/500 copy, console output, and model names in bubbles. Use “弘阳广场 · AI 财务助手” and display the model as “财务助手”.

Leave routes, sessions, tool-call protocol, and artifact rendering unchanged.

### 1.2 Model provider abstraction
```ts
// Illustrative planning type; the running implementation uses the dsh LLM service.
interface ModelProvider {
  chat(messages: readonly unknown[], tools?: readonly unknown[]): Promise<unknown>
  vision(image: Uint8Array, prompt: string): Promise<string>
  extract<T>(text: string, schema: { parse(value: unknown): T }): Promise<T>
}
```
The model only recognizes, extracts, and converses; deterministic tool code calculates amounts, tax, allocations, and vouchers. **The model performs no financial arithmetic.**

---

## 2. Data model (shared plugin SQLite)

```
merchant        id, shop_no("5002A"), name("炊牛大烩"), brand, floor
receivable      merchant_id, fee_type, period_start, period_end, due_date, amount_due, amount_received
payer_mapping   payer_name, payer_account?, merchant_id, confirmed(bool)
transaction     source(bank2038|bank2035|pingan|pos|wechat706|wechat380|dingtalk)  ← 对应日报表"收款来源"枚举, txn_time, amount, payer_name, remark, txn_no,
                status(auto|manual|pending), merchant_id?, confidence, raw
allocation      transaction_id, merchant_id, fee_type, period_start, period_end,
                amount_incl_tax, tax_rate, tax_amount
voucher_line    date, no, summary, account_code, account_name, debit, credit, allocation_id
```

---

## 3. Plugin plan (six dsh plugins)

Each planned plugin contains `skill.md` business rules for the system prompt, `tools/` functions, and optional `artifacts/` rendering templates.

### hy-finance-core — business rules, required by other plugins

**skill.md contents** (the financial rules dsh needs):

- Legal entity and receiving accounts: bank `1002.02` CCB …2038; POS/QR `1012.08`.

- Fee → tax rate → ledger account:

| fee_type | Label | Tax rate | Advance-payment account |
|---|---|---|---|
| rent | Rent | 9% | 2203.01.01 |
| service | Operating service fee | 6% | 2203.01.02 |
| promo | Promotion | 6% | 2203.01.03 |
| multi_fixed / multi_ad | Other operations: fixed service / advertising | 6% | TBD |
| electricity | Electricity | 13% | TBD |
| water | Water | 3% | TBD |
| decor_mgmt / garbage / cert | Decoration management / waste disposal / certificate cost | 6% | 2203.06 / 2203.11 / 2203.05 |
| deposit / earnest / guarantee | Deposit / earnest money / quality guarantee | Untaxed | 2241.04 / 2241.02 / 2241.05 |
| unclaimed | Unallocated receipts | Untaxed | 2203.01.05 |
| multi_warehouse / fixed_spot / temp_spot | Warehouse / fixed location service / temporary location service | 6% | TBD |
| water_post / elec_post / elec_pre | Postpaid water / postpaid electricity / prepaid electricity | 3% / 13% / 13% | TBD |
| parking / decor_deposit / fire_water / other / coupon | Parking / decoration deposit / fire-water discharge / other / coupons | Per account table | TBD |

  The fee enumeration follows the 22 amount columns stated in row 3 of `收入日报表格式.xlsx`, in fixed order: rent, operating service, promotion, warehouse, advertising, fixed location service, temporary location service, postpaid water, postpaid electricity, prepaid electricity, decoration management, waste disposal, certificates, parking, earnest money, decoration deposit, guarantee, unallocated receipts, fire-water discharge, other, coupons.

  Output-VAT accounts: `2221.01.02.06` (6%) and `2221.01.02.09` (9%); 13%/3% were unconfirmed in this plan.

- Summary template: `收到商户{费项}{期间}-{铺位号}&{商户名}`; unallocated receipts: `收到暂收款项-{付款人}`.

- Splitting: use supplied details first; otherwise offset receivables in rent > service > promo > electricity > water order; put the remainder in unallocated receipts.

- Allocation: use calendar months and day proportions across months.

- Tax: `tax = round(incl / (1+r) * r, 2)`.

- Channel rules: 财付通 counterparty → WeChat settlement; 银联商务 → POS settlement with fee parsed from the note; 捷停车 → parking; 抖音 → ignored.

- Terms: operations / registration (Director He) / accounting (Hua Xinyu) / receivables / unallocated receipts.

**tools**: `get_fee_rules()` `get_account(fee_type)` `calc_tax(amount, fee_type)`

### hy-import — import tools

`import_bank_xls(path)`: read only 建行2038 with positive credits; classify and write transactions by channel.

`import_wechat_bill(path, mch_id)`, `import_unionpos_bill(path)`: write detail transactions with source=wechat/unionpos and reconcile totals against bank settlement credits.

`import_receivable_xlsx(path)`: upsert merchants and receivables.

`import_register_xlsx(path)`: import Director He's ledger for comparison only.

Conversation trigger: “Import this statement”, after the user drops a file into the conversation.

### hy-claim — claim engine

`run_claim(scope=today|all)`: three matching levels.

- L1 exact: counterparty approximately matches merchant/brand after removing company suffixes, or matches payer_mapping → confidence 1.0.

- L2 notes: `extract()` obtains merchant, fee, and period, then fuzzy-matches merchants → confidence 0.7–0.9.

  Examples: 李栋 “飞科5-6月租金”, 黎玉 “支付衡阳弘阳广场李宁店电费”, 付勇 “潮正和水费”, 刘鑫 “愤怒弹珠房租”, 钟爱虹 “开心哈乐4月租金”.

- L3 amount: matches a merchant-period unpaid balance within one yuan → prefill a suggestion but retain manual review.

- No match → pending/unallocated receipts. Examples: 张先涛 3000 with only a name, 涂小兰 20062.56 without a note; after manual claim, remember the latter as 炊牛大烩.

`list_pending()`: return pending items → artifact `pending_claims_table`, with merchant dropdown and confirmation per row.

`confirm_claim(txn_id, merchant_id, split?)`: write allocation and confirmed payer_mapping.

`learn_payer(payer, merchant)`

Conversation triggers: “Claim today's receipts” and “Zhang Xiantao's payment belongs to 开心哈乐”.

### hy-dingtalk — DingTalk input

Enterprise internal DingTalk robot in **Stream mode**, requiring no public callback URL for a local demo; receives text/picture, using downloadCode and the robot file-download API for pictures.

Flow: receive a message → create/resume an agent session by DingTalk userId → the agent calls:

- `parse_payment_screenshot(image)`: vision extracts amount, payment time, transaction number, and payee, checked against the Chengyuan company.

- `parse_report_text(text)`: extract merchant plus fee/amount pairs; “阿妹泡菜电费1000元，水费200” produces two lines.

- Write transaction(source=dingtalk) and try merging WeChat/UnionPay details by transaction number or amount plus a ±2-minute window.

- Merchant match → reply “已登记：围辣转转火锅 电费 500 ✔ 交易单号 …642”.

- No match → say that amount 500 is captured and request the merchant name, then use confirm_claim after the reply.

- Image without text → ask for the merchant and fee.

Demo prerequisites: a DingTalk test organization, robot AppKey/Secret, and two phones, one acting as operations.

### hy-daily-report — daily income report, the required output

`build_daily_report(date)`: aggregate that day's allocations, one merchant/payment per row, each fee in its column, subtotal as the sum of fees, and formula-based totals at the top.

`export_daily_report_xlsx(date)`: the 34-column layout must match `收入日报表格式.xlsx`:

Sequence, receipt date, shop/location number, merchant name, brand, receipt subtotal, receipt source, period start, period end, [22 fee columns], note, receipt issued, receipt number, issue date.

Map receipt source from transaction.source: bank transfer 2038 / POS / enterprise WeChat 706 / enterprise WeChat 380 / Ping An Bank / bank transfer 2035.

`compare_daily_report(date, client_xlsx)`: compare Director He's manual ledger row by row → artifact `report_diff`.

Conversation triggers: “Generate today's income report” and “Compare it with Director He's ledger”.

Artifact `daily_report_table`: edit fee amounts/merchant directly and write changes back to allocations.

### hy-voucher — vouchers from the daily report

`build_voucher(date)`: input is the day's report; one voucher per day in sample order:
```
借 1002.02 银行收款合计 / 借 1012.08 POS 收款合计
每商户×每费项：贷 预收(含税) → 借 预收(税额) → 贷 销项税(税额)，摘要同模板
无税费项只一行贷；暂收款贷 2203.01.05
```
Validate fee tax rate against output-VAT account and highlight mismatches, such as 依沐裳's 9% rent tax posted to a 6% account.

`export_voucher_xlsx(date)`: 21 sample columns: date, fiscal year, period, voucher prefix, voucher number, summary, account code, full account name, currency, original amount, debit, credit, preparer, reviewer, posting, cashier, attachment count, source system, business type, review status, void status.

`compare_voucher(date, client_xlsx)`: compare customer vouchers row by row → artifact `voucher_diff`, highlighted side by side.

Conversation triggers: “Generate April 3 vouchers” and “Compare with our manual entries”.

### hy-dashboard — dashboard and queries

`receivable_summary(period)`, `merchant_balance(name)`, `list_overdue(days)`, `today_receipts()`

Artifact `finance_dashboard`: four headline values and an overdue table.

Conversation triggers: “How much does 愤怒弹珠 owe?”, “Who paid electricity today?”, and “Which debts are more than 30 days overdue?”.

---

## 4. Eight-minute demo script

| # | Who | Action | Customer sees |
|---|---|---|---|
| 1 | Operations, phone DingTalk | Photograph payment and enter “围辣转转火锅，电费500元” | Robot responds “registered” in three seconds |
| 2 | Operations | Send image with “张先涛 3000” | Robot asks which merchant → reply 开心哈乐 → registered |
| 3 | Finance, browser | Upload April statement and ask to import and claim | 46 transactions: 40 automatic, six pending in an artifact table |
| 4 | Finance | Select 炊牛大烩 for 涂小兰 and confirm | Mapping remembered for future automatic claims |
| 5 | Finance | Request April 3 income report | Matching 34-column layout, one payment per row, fee columns, side-by-side ledger comparison if available |
| 5b | Finance | Request April 3 vouchers and comparison | Generated from report, matching rows side by side, with one tax validation issue |
| 6 | Finance | Export | xlsx opens with 21 Galaxy columns |
| 7 | Finance | Ask how much 愤怒弹珠 owes | Direct answer and detail |
| 8 | — | Explain later bank connectivity, Kingdee API, historical cleanup, and plugin distribution | Scope and extension path |

---

## 5. Schedule

| Date | Deliverable | Acceptance |
|---|---|---|
| September 9 evening | Branding checklist; ModelProvider and Anthropic vision/extract; hy-finance-core skill.md | No dsh branding; screenshot amount extraction |
| September 10 | hy-import with real statements and fixtures; hy-claim L1/L2; pending artifact | 46 imported transactions, at least 35 automatic claims |
| September 11 | DingTalk Stream and two parse tools; claim L3/confirmation; tax and splitting tools using 22 fee columns | Phone image plus text receives “registered” |
| September 12 | Report generation/export/comparison; vouchers from reports with comparison/export; dashboard; real data and three rehearsals | April 3 report matches 34-column layout; vouchers match customer rows |
| September 13 | Demo | — |

---

## 6. Risks and contingencies

| Risk | Contingency |
|---|---|
| Customer uses WeChat instead of DingTalk | Demonstrate DingTalk and explain the enterprise WeChat adapter alternative; ask which channel they use |
| DingTalk Stream image-download API fails | Text-only robot; finance uploads images in the browser |
| Operations receivables unavailable | Derive merchant master data from voucher summaries `-{铺位号}&{商户名}` |
| WeChat/UnionPay statements unavailable | Keep settlement as one 1012.08 row and explain that statement details allow merchant splitting |
| 13%/3% account codes unknown | Keep placeholders and ask Director He before the demo |
| No on-site network | Local host plus hotspot, with a domestic provider option |
| “Is this just an LLM plus Excel?” | Show DingTalk intake, pending claims, payer mappings, and plugin distribution supporting multiple people, departments, and accumulated knowledge |
