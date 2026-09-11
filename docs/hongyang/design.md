# 弘阳财务插件 · 设计文档

状态：待确认 | 日期：2026-09-11 | 对标：`dsh-univer-office` 0.2.14 的包结构与界面标准

## 1. 结论

两个 npm 包，都放在本仓库 `packages/hongyang/` 下，作为 workspace 包由 `dsh web` 源码启动直接加载：

| 包 | 名称 | 职责 |
|---|---|---|
| `packages/hongyang/finance` | `@deepseek-ai/dsh-hy-finance` | 财务领域全部能力：主数据、导入、认领、拆分、日报表、凭证、查询；Host 工具 + 技能 + 设置 + 浏览器卡片 |
| `packages/hongyang/dingtalk` | `@deepseek-ai/dsh-hy-dingtalk` | 钉钉 Stream 机器人入口：收文字和图片，调 finance 服务登记，回复结果 |

和 Univer 一样，一个包内部按 Cordis 角色分层，根插件在独立 fiber 里挂载各角色。模型只做识别、抽取、对话；金额、税额、拆分、凭证行全部由 provider 里的确定性代码计算（**模型不碰钱**）。

## 2. 必须交付的用户功能

对应演示脚本 8 步。

1. 财务在会话里拖入建行流水 xls，说"导进来并认领"：工具导入、日结拆分、三层认领，回合尾部出现**待认领卡片**，列出未命中的笔数与建议。
2. 用户在卡片里为某笔选商户并确认，系统写入分配并记住付款人；下次同名付款人自动命中。
3. 微信、POS 对账单拖入后，日结那一笔被拆成对账单明细；电费订单按"商户:xx-铺位"落到商户，POS 无附言的进待认领。
4. 运营在钉钉发付款截图加一句话，机器人回复"已登记：商户 费项 金额"；认不出商户就追问。
5. "出 4 月 3 日的收入日报表"：生成 34 列 xlsx，与贺部长台账逐行比对，出**日报表卡片**（合计、来源分布、差异数），差异明细在 Univer 里并排打开。
6. "出 4 月 3 日凭证"：从日报表生成 21 列星空凭证，税率与销项税科目校验，出**凭证卡片**，可导出 xlsx。
7. "愤怒弹珠还欠多少""欠费超过 30 天的有哪些"：查询工具直接回答，附表格。
8. 设置页有"弘阳财务"配置卡：数据库路径、税率科目表、待确认科目、钉钉凭据、卡片自动展开开关。

## 3. 包结构（finance）

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

## 4. 数据模型（SQLite，`$DSH_HOME/hongyang/finance.db`）

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

来源枚举与日报表"收款来源"列一一对应：银行转账2038 / 银行转账2035 / 平安银行 / POS收款 / 企业微信706 / 企业微信380。

## 5. 与真实数据对应的关键规则

- 建行 2038 贷方 46 笔（4/1–4/8）。对方户名含"财付通"→ 微信日结，备注 `MMDD_商户号` 指明商户号；含"银联商务"→ POS 日结，备注 `MMDD-MMDD费x元`；含"捷停车"→ 停车费；含"抖音"→ 忽略。
- 财付通到账 = 微信对账单**前一日** `应结订单金额 − 手续费` 之和（已核对 16 笔全部一致）。银联到账 = **前一日** POS 清算金额之和，可能拆成两笔到账。
- 微信 706 商户号 = 电费充值小程序，商品名 `商户:趣捞鱼-3033 电表:1` 直接给出商户与铺位；380 商户号全部是停车费，不拆商户。
- POS 814 笔中 699 笔付款附言为空，只能靠运营上报或人工认领。
- 台账粒度：一商户一笔收款一行，费项拆列，可有负数（暂收款冲销、诚意金转保证金）。

## 6. 工具结构化结果约定

每个工具返回一个可回放的 JSON 值，带稳定 id，客户端 reducer 只读这些字段，不解析自由文本：

```ts
interface ClaimRunResult {
  batchId: BatchId
  imported: number
  settlementsSplit: number
  autoClaimed: number
  pending: PendingItem[]          // { transactionId, amount, payerName, remark, suggestions: [{ merchantId, shopNo, name, reason, confidence }] }
}
interface DailyReportResult {
  reportId: string; date: string; rows: number; totals: Record<FeeType, number>
  bySource: Record<Source, number>; xlsxPath: string
  compare?: { matched: number; missing: number; extra: number; amountDiff: number; diffs: DiffRow[] }
}
```

## 7. 界面标准（照 Univer）

- 回合尾部卡片：紧凑 header（标题、日期或批次、状态徽章、折叠/全屏），body 为表格；历史回合默认折叠；不加外部 action footer，动作在卡片内。
- 待认领卡片每行：金额、付款人、备注、建议商户（置信度色标）、商户下拉、费项拆分预览、确认按钮；确认后行变为"已认领"并显示摘要。
- 所有文案走 locale 字典，zh 为默认。
- 颜色只用 `--dsw-alias-*` 语义 token，不写死颜色。

## 8. 依赖

- 读表：`xlsx`（SheetJS，读 xls/xlsx/csv）、`iconv-lite`（微信 CSV 为 GBK）
- 写表：`exceljs`（样式、公式、合并单元格）
- 钉钉：`dingtalk-stream`（Stream 模式，无需公网）
- 数据库：Node 内建 `node:sqlite`

## 9. 顺序

| 步 | 内容 | 验收 |
|---|---|---|
| 1 | 包骨架、Config、SQLite schema、service 定义、根插件挂进 web profile | `dsh web` 启动无报错，设置页出现"弘阳财务"卡 |
| 2 | 7 个导入器 + 日结拆分 | 46 笔入库，16 笔财付通与 6 笔银联拆成明细且金额对平 |
| 3 | 认领引擎 + finance_claim + 待认领卡片 | 46 笔中 ≥ 35 笔自动认领；卡片确认涂小兰→炊牛大烩后写入 payer_mapping |
| 4 | 日报表构建/导出/比对 + 卡片 | 4/3 日报表 14 行与台账逐行一致 |
| 5 | 凭证构建/导出/比对 + 卡片 | 4/3 凭证与客户凭证借贷、科目一致；税率校验点出"依沐裳" |
| 6 | 查询工具 + 登记工具（截图抽取） | "愤怒弹珠还欠多少"直接回答；拖截图能登记 |
| 7 | 钉钉 Stream 机器人 | 手机发图加文字，3 秒内回复"已登记" |
| 8 | 演示脚本走 3 遍，README | — |
