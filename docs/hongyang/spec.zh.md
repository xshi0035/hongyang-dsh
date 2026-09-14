---
description: "弘阳演示需求历史记录，附当前实现状态入口。"

kind: "reference"
---

# 衡阳弘阳广场 · 财务 Agent Demo 开发规划（v2）

[English](spec.md) | 中文

这是 2026 年 9 月的历史演示规划。下文包名、拟议 API、排期和验收目标代表规划意图，不代表已验证交付。当前实现以 [2026-09-14 交接文档](CLAUDE_HANDOFF_2026-09-14.zh.md) 及包 README 为准。

> 截止：2026-09-13 演示 | 开发窗口：9/9 晚 – 9/12

> 底座：dsh（agent 运行时，本质不变）| 我们做：插件（业务口径 + 工具 + artifact）| 输入口：钉钉机器人

> 客户主体：衡阳诚远商业管理有限公司 | 财务系统：金蝶云星空 | 对接：周晓、贺红富（登记）、华新玉（做账）

> 样本：建行流水 xls（2035/2038 两个 sheet）、星空凭证 xlsx（21 列）、**收入日报表格式 xlsx（34 列，客户指定最终产物）**、运营应收表截图

**样本文件**（本目录 `samples/`）：

| 文件 | 说明 |
|---|---|
| `samples/建行流水_2026-04-01_08.xls` | 建行账户流水，2026-04-01 ~ 04-08，2035/2038 两个 sheet |
| `samples/凭证_2026-04-01_08.xlsx` | 金蝶云星空导出凭证，2026-04-01 ~ 04-08，21 列，客户人工做账结果 |
| `samples/收入日报表格式.xlsx` | 贺部长手工登记的收入日报表格式，34 列，客户指定最终产物 |
| `samples/应收表_截图.png` | 运营部应收表（账期 / 铺位号 / 商户 / 品牌 / 费项 / 应收 / 已收 / 未收） |
| `samples/付款截图_银联商务.jpg` | 运营部手机拍的银联商务支付成功页，钉钉上报 `parse_payment_screenshot` 的输入样例 |

---

## 0. 产品形态（先对齐，不再跑偏）

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

- dsh 不改逻辑，只换壳（去 dsh / DeepSeek 痕迹，名字叫"弘阳 AI 财务助手"）+ 换模型 provider

- 一切业务能力都是插件，通过 dsh-platform 分发安装——这就是"平台 + 插件"卖点的实证

- 钉钉机器人和浏览器会话进的是同一个 agent、同一套工具、同一个库

- **主产物链**：上报/流水 → 认领拆分 → **收入日报表**（贺部长现在手工做的 34 列表，按日一张）→ 凭证（从日报表生成）。日报表是客户指定的最终产物格式，见 `samples/收入日报表格式.xlsx`

---

## 1. 底座两处改动

### 1.1 换壳（去痕迹）

grep 清单：产品名 / title / favicon / logo / 登录页品牌 / 页脚 / 关于 / 版本 / GitHub 链接 / package.json / 404·500 文案 / console.log / 对话气泡里的模型名。统一换成"弘阳广场 · AI 财务助手"，模型名显示"财务助手"。

不动：路由、session 机制、tool 调用协议、artifact 渲染。

### 1.2 模型 Provider 抽象
```ts
// Illustrative planning type; the running implementation uses the dsh LLM service.
interface ModelProvider {
  chat(messages: readonly unknown[], tools?: readonly unknown[]): Promise<unknown>
  vision(image: Uint8Array, prompt: string): Promise<string>
  extract<T>(text: string, schema: { parse(value: unknown): T }): Promise<T>
}
```
原则：模型只做识别、抽取、对话；金额、税、分摊、凭证全部由工具里的确定性代码算。**模型不碰钱。**

---

## 2. 数据模型（插件共享 SQLite）

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

## 3. 插件清单（6 个 dsh 插件）

每个插件 = `skill.md`（业务口径，注入 system prompt）+ `tools/`（函数）+ `artifacts/`（可选渲染模板）。

### hy-finance-core —— 业务口径（先做，其他插件都依赖它）

**skill.md 内容**（这是让 dsh "懂财务"的部分）：

- 公司主体、收款账户：银行 `1002.02` 建行…2038；POS/扫码 `1012.08`

- 费项 → 税率 → 科目表：

| fee_type | 中文 | 税率 | 预收科目 |
|---|---|---|---|
| rent | 租金 | 9% | 2203.01.01 |
| service | 经营服务费 | 6% | 2203.01.02 |
| promo | 推广费 | 6% | 2203.01.03 |
| multi_fixed / multi_ad | 多经-固定服务费 / 广告位 | 6% | TBD |
| electricity | 电费 | 13% | TBD |
| water | 水费 | 3% | TBD |
| decor_mgmt / garbage / cert | 装修管理费 / 垃圾清运费 / 证件工本费 | 6% | 2203.06 / 2203.11 / 2203.05 |
| deposit / earnest / guarantee | 押金 / 诚意金 / 质保金 | 无税 | 2241.04 / 2241.02 / 2241.05 |
| unclaimed | 暂收款 | 无税 | 2203.01.05 |
| multi_warehouse / fixed_spot / temp_spot | 多经-仓库 / 固定点位服务费 / 临时点位服务费 | 6% | TBD |
| water_post / elec_post / elec_pre | 后付水费 / 后付电费 / 预付电费 | 3% / 13% / 13% | TBD |
| parking / decor_deposit / fire_water / other / coupon | 停车费 / 装修押金 / 消防泄水费 / 其他 / 购券 | 按科目表 | TBD |

  费项枚举以 `收入日报表格式.xlsx` 第 3 行 22 个金额列为准（列序固定）：租金, 经营服务费, 宣传服务费-推广, 多经收入-仓库, 多经收入-广告位, 固定点位-服务费收入, 临时点位收入-服务费收入, 后付水费, 后付电费, 预付电费, 装修管理费, 垃圾清运费, 证件工本费, 停车费, 诚意金, 装修押金, 保证金, 暂收款, 消防泄水费, 其他, 购券

  销项税科目 `2221.01.02.06`（6%）`2221.01.02.09`（9%），13%/3% 待确认

- 摘要模板：`收到商户{费项}{期间}-{铺位号}&{商户名}`；暂收款：`收到暂收款项-{付款人}`

- 拆分规则：上报有明细按明细；否则按应收未收顺序 rent > service > promo > electricity > water；余额挂暂收款

- 分摊：跨月按自然月、按天数比例

- 税：`tax = round(incl / (1+r) * r, 2)`

- 收款渠道识别规则：对方户名含"财付通"→ 微信日结；"银联商务"→ POS 日结（备注解析手续费）；"捷停车"→ 停车费；"抖音"→ 忽略

- 术语：运营部 / 登记（贺部长）/ 做账（华新玉）/ 应收表 / 暂收款

**tools**：`get_fee_rules()` `get_account(fee_type)` `calc_tax(amount, fee_type)`

### hy-import —— 导入工具

`import_bank_xls(path)`：只读 sheet 建行2038、贷方>0；按渠道规则分类写 transaction

`import_wechat_bill(path, mch_id)`、`import_unionpos_bill(path)`：明细写 transaction(source=wechat/unionpos)，并与流水里的日结汇总对总额

`import_receivable_xlsx(path)`：upsert merchant + receivable

`import_register_xlsx(path)`：贺部长登记表，仅用于比对

对话触发："把这份流水导进来"（用户拖文件到会话）

### hy-claim —— 认领引擎

`run_claim(scope=today|all)`：三层匹配

- L1 精确：对方户名 ≈ 商户/品牌名（去公司后缀）；或 payer_mapping 命中 → conf 1.0

- L2 备注解析：`extract()` 抽 {商户, 费项, 期间}，再模糊匹配 merchant → conf 0.7–0.9

  例：李栋"飞科5-6月租金"、黎玉"支付衡阳弘阳广场李宁店电费"、付勇"潮正和水费"、刘鑫"愤怒弹珠房租"、钟爱虹"开心哈乐4月租金"

- L3 金额：= 某商户某期未收 ±1 元 → 预填建议，仍进队列

- 未命中 → pending，挂暂收款。例：张先涛 3000（备注只有名字）、涂小兰 20062.56（无备注，人工认领后记住→炊牛大烩）

`list_pending()`：返回待认领列表 → 渲染 artifact `pending_claims_table`（每行下拉选商户 + 确认按钮）

`confirm_claim(txn_id, merchant_id, split?)`：写 allocation + payer_mapping(confirmed)

`learn_payer(payer, merchant)`

对话触发："认领一下今天的收款" "张先涛那笔是开心哈乐的"

### hy-dingtalk —— 钉钉输入口

钉钉企业内部机器人，**Stream 模式**（无需公网回调，本机就能演）；接收 text / picture（picture 走 downloadCode → 机器人消息文件下载接口取图）。

流程：收到消息 → 建/续一个 agent session（按钉钉 userId）→ agent 调：

- `parse_payment_screenshot(image)`：vision 抽 金额 / 支付时间 / 交易单号 / 收款方（校验为诚远公司）

- `parse_report_text(text)`：extract 抽 商户名 + [{fee_type, amount}]（"阿妹泡菜电费1000元，水费200"→ 两行）

- 写 transaction(source=dingtalk)，尝试按交易单号 / 金额+时间窗 ±2min 与 wechat/unionpos 明细合并

- 商户匹配成功 → 回复"已登记：围辣转转火锅 电费 500 ✔ 交易单号 …642"

- 匹配失败 → 回复"金额 500 已收到，没认出商户，请回复商户名"，用户回复后走 confirm_claim

- 只发图没文字 → 回复"请补一句：哪个商户、什么费"

演示前置：一个钉钉测试组织 + 机器人 AppKey/Secret；两部手机（一部当运营）。

### hy-daily-report —— 收入日报表（客户指定的最终产物）

`build_daily_report(date)`：把当日所有 allocation 汇成日报表，一商户一笔收款一行，费项金额落到对应列，小计 = 各费项之和，顶部合计行带公式。

`export_daily_report_xlsx(date)`：34 列与 `收入日报表格式.xlsx` 完全一致：

序号, 收款日期, 铺位号/点位号, 商户名称, 品牌, 收款金额小计, 收款来源, 款项起始期, 款项截止期, [22 个费项列], 备注, 是否已开票据, 票据号码, 开票日期

收款来源按 transaction.source 映射：银行转账2038 / POS收款 / 企业微信706 / 企业微信380 / 平安银行 / 银行转账2035

`compare_daily_report(date, client_xlsx)`：与贺部长手工登记表逐行比对 → artifact `report_diff`

对话触发："出今天的收入日报表" "跟贺部长登记的比一下"

artifact `daily_report_table`：可在表格里直接改费项金额/商户，改完回写 allocation

### hy-voucher —— 凭证（从日报表生成）

`build_voucher(date)`：输入 = 当日日报表；按日一张，行序照样本：
```
借 1002.02 银行收款合计 / 借 1012.08 POS 收款合计
每商户×每费项：贷 预收(含税) → 借 预收(税额) → 贷 销项税(税额)，摘要同模板
无税费项只一行贷；暂收款贷 2203.01.05
```
校验：费项税率与销项税科目一致，不一致标红（样本"依沐裳"租金 9% 税额挂 6% 科目即此类）

`export_voucher_xlsx(date)`：21 列与样本一致：日期,会计年度,期间,凭证字,凭证号,摘要,科目编码,科目全名,币别,原币金额,借方金额,贷方金额,制单,审核,过账,出纳,附件数,来源系统,业务类型,审核状态,作废状态

`compare_voucher(date, client_xlsx)`：与客户人工凭证逐行比对 → artifact `voucher_diff`（左右并排高亮）

对话触发："出 4 月 3 日的凭证" "跟我们自己录的比一下"

### hy-dashboard —— 看板与查询

`receivable_summary(period)`、`merchant_balance(name)`、`list_overdue(days)`、`today_receipts()`

artifact `finance_dashboard`（4 个数 + 欠费表）

对话触发："愤怒弹珠还欠多少" "今天谁交了电费" "欠费超过 30 天的有哪些"

---

## 4. 演示脚本（8 分钟）

| # | 谁 | 做什么 | 客户看到 |
|---|---|---|---|
| 1 | 运营（手机钉钉） | 拍截图 + 打"围辣转转火锅，电费500元" | 机器人 3 秒回"已登记" |
| 2 | 运营 | 只发一张图，备注"张先涛 3000" | 机器人问"哪个商户？"→ 回"开心哈乐" → 已登记 |
| 3 | 财务（浏览器） | 拖入 4 月流水："导进来并认领" | 46 笔，40 自动认领，6 待认领（artifact 表格） |
| 4 | 财务 | 在表格里把涂小兰选成炊牛大烩，确认 | 提示"已记住，下次自动" |
| 5 | 财务 | "出 4 月 3 日的收入日报表" | 34 列同格式，一行一笔，费项落列；若登记表已到则并排比对 |
| 5b | 财务 | "出 4 月 3 日凭证，跟我们录的比一下" | 从日报表生成，并排比对行行一致，税率校验点出一处 |
| 6 | 财务 | "导出" | xlsx 打开即星空 21 列 |
| 7 | 财务 | "愤怒弹珠还欠多少" | 直接回答 + 明细 |
| 8 | — | 收尾：交付阶段接银行直连 / 金蝶 API / 历史清理；插件走平台分发 | 边界与扩展路径 |

---

## 5. 排期

| 日期 | 交付 | 验收 |
|---|---|---|
| 9/9 晚 | 换壳 grep 清单过完；ModelProvider + anthropic 跑通 vision/extract；hy-finance-core skill.md 写完 | 页面无 dsh 字样；截图能抽出金额 |
| 9/10 | hy-import（真流水 + fixtures 对账单）；hy-claim L1/L2；pending 表格 artifact | 46 笔导入，≥35 笔自动认领 |
| 9/11 | hy-dingtalk Stream 接入 + 两个 parse 工具；hy-claim L3 + confirm；税/拆分工具（费项按 22 列枚举） | 手机发图+文字 → 机器人回"已登记" |
| 9/12 | hy-daily-report 生成/导出/比对；hy-voucher 从日报表生成/比对/导出；hy-dashboard；真数据替换；演示脚本走 3 遍 | 4/3 日报表 34 列格式一致；4/3 凭证与客户凭证逐行一致 |
| 9/13 | 演示 | — |

---

## 6. 风险与预案

| 风险 | 预案 |
|---|---|
| 客户没有钉钉（他们现在用微信） | 演示照做钉钉，说明企微是同一 handler 换适配器；开场先问一句他们用什么 |
| 钉钉 Stream 模式取图接口不通 | 退化：机器人只收文字，图片由财务在浏览器会话里拖入 |
| 运营应收表没到 | 从凭证摘要 `-{铺位号}&{商户名}` 反推商户主数据 |
| 微信/银联对账单没到 | 日结汇总保留为一行挂 1012.08，说明"接对账单后自动拆到商户" |
| 13%/3% 科目编码不确定 | 占位，演示前问贺部长 |
| 现场网络不通 | 本机 + 热点；provider 可切国产 |
| "这不就是大模型加 Excel" | 指钉钉入口 + 待认领队列 + 付款人映射库 + 插件分发：多人、多部门、持续积累，个人工具做不了 |
