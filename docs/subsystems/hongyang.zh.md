# 弘阳财务

[English](hongyang.md) | 中文

本文档记录[财务插件](../../packages/hongyang/finance/README.zh.md)和[钉钉桥接](../../packages/hongyang/dingtalk/README.zh.md)使用的财务记录与服务操作。财务服务在插件生命周期内持有一个 SQLite 连接；工具和传输适配器通过该服务导入数据、登记付款、分配收款、生成报表与凭证草稿。

## 记录与金额

[领域记录](../../packages/hongyang/finance/src/service/types.ts)区分商户、导入流水、平台明细、应收款和收款分配。商户的 `shopNo` 标识铺位；`name` 表示签约主体，`brand` 保留导入的品牌文本。这些名称不必相同。金额使用整数分，日期使用 `YYYY-MM-DD`，时间戳使用 ISO 8601。[标识符](../../packages/hongyang/finance/src/service/identifiers.ts)区分不同表中的记录。

收款分配将一笔流水的部分金额归到商户与费项，并可关联应收款。付款登记不代表银行到账已核实，也不代表会计凭证已过账。[费项规则](../../packages/hongyang/finance/src/rules/fee-types.ts)与[税额计算](../../packages/hongyang/finance/src/rules/tax.ts)负责确定性的分类和计算。

服务返回以下类型化结果，其声明位于构造结果的 provider 旁。

| 类型 | 声明归属 |
|---|---|
| `Merchant`, `ImportKind`, `AllocationOrigin`, `FinanceCounts` | [领域记录](../../packages/hongyang/finance/src/service/types.ts) |
| `ImportOutcome` | [文件导入](../../packages/hongyang/finance/src/provider/import/index.ts) |
| `SplitResult` | [结算拆分](../../packages/hongyang/finance/src/provider/split/settlement.ts) |
| `Split` | [分配输入](../../packages/hongyang/finance/src/provider/claim/allocate.ts) |
| `ClaimRunResult`, `PendingItem`, `UnlabelledPos`, `ConfirmResult` | [认领引擎](../../packages/hongyang/finance/src/provider/claim/engine.ts) |
| `DailyReport`, `CompareResult` | [日报表](../../packages/hongyang/finance/src/provider/report/daily-report.ts) |
| `VoucherBuild` | [凭证草稿](../../packages/hongyang/finance/src/provider/voucher/build.ts) |
| `ReceivableSummary`, `MerchantBalance`, `OverdueRow`, `ReceiptToday` | [看板查询](../../packages/hongyang/finance/src/provider/query/dashboard.ts) |
| `ParsedPayment`, `RegisterResult` | [付款登记](../../packages/hongyang/finance/src/provider/register/payment.ts) |
| `PaymentPreview` | [对话预览](../../packages/hongyang/finance/src/provider/register/conversation.ts) |
| `PaymentImageExtraction` | [图片凭据](../../packages/hongyang/finance/src/provider/register/image.ts) |

## 付款草稿与确认

[付款解析器](../../packages/hongyang/finance/src/provider/register/payment.ts)提取一笔付款的金额、日期、费项与商户线索。[对话 provider](../../packages/hongyang/finance/src/provider/register/conversation.ts)预览候选商户，不写入流水。确认操作要求有效金额、唯一费项以及预览候选中的准确铺位号，满足后才调用付款登记 provider。

[钉钉桥接](../../packages/hongyang/dingtalk/src/bridge.ts)持有临时对话草稿；财务服务持有已提交的流水与收款分配。草稿既不是持久化流水，也不是通用对话记忆。传输层的卡片变量和回调定义见[钉钉类型](../../packages/hongyang/dingtalk/src/types.ts)。

## 配置与生命周期

[配置](../../packages/hongyang/finance/src/config.ts)指定数据库路径、报表容差、卡片显示偏好、销项税科目和收款公司。[服务](../../packages/hongyang/finance/src/service/finance-service.ts)在初始化时打开数据库，在插件释放时关闭。在初始化之前或释放之后调用 `db()` 会抛出错误。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxhyfinance--hyfinanceservice"></a>

### `ctx.hyFinance` — `HyFinanceService`

The finance domain service. Constructed by the root plugin; the database opens during `[Service.init]` and closes with the fiber.

```ts cordis-catalog
/**
 * The open database. Provider modules borrow it for one operation at a time.
 * @returns the handle.
 * @throws when called before init or after disposal.
 */
db(): DatabaseSync

/**
 * Replace the live configuration (settings section change).
 * @param config - the new validated configuration.
 */
reconfigure(config: HyFinanceConfig): void

/**
 * Import one client file; bank and platform statements also re-run
 * settlement splitting.
 * @param file - absolute path.
 * @param kind - explicit kind, or detected from the headers.
 * @returns the import outcome.
 */
importFile(file: string, kind?: ImportKind): Promise<ImportOutcome>

/**
 * Re-run settlement splitting over every pending Tenpay / UnionPay credit.
 * @returns matched and unmatched credits.
 */
splitSettlements(): SplitResult

/**
 * Run the claim engine over everything unbooked.
 * @returns Automatic bookings and the remaining review queue.
 */
runClaims(): ClaimRunResult

/**
 * The pending queue with suggestions.
 * @returns Pending receipts and POS rows needing merchant labels.
 */
listPending(): { pending: PendingItem[]; unlabelledPos: UnlabelledPos[] }

/**
 * Book one queued item to a shop.
 * @param itemId - `txn:<id>` or `ptx:<id>`.
 * @param shopNo - shop number; empty books suspense.
 * @param splits - explicit splits in cents.
 * @param origin - who confirmed.
 * @returns Booked allocations and payer-mapping status.
 */
confirmClaim(itemId: string, shopNo: string, splits: readonly Split[] | undefined, origin: AllocationOrigin): ConfirmResult

/**
 * Remember a payer → shop mapping.
 * @param payerName - Payer name matched exactly.
 * @param shopNo - Selected shop number.
 * @returns The merchant associated with the stored mapping.
 */
learnPayer(payerName: string, shopNo: string): Merchant

/**
 * Build one day's income report from allocations.
 * @param date - Receipt date in YYYY-MM-DD form.
 * @returns Daily report rows and integer-cent totals.
 */
buildDailyReport(date: string): DailyReport

/**
 * Write a built report as xlsx into `dir`.
 * @param report - Generated daily report for review or export.
 * @param dir - Destination directory, created when absent.
 * @returns Absolute path to the written XLSX workbook.
 */
exportDailyReport(report: DailyReport, dir: string): Promise<string>

/**
 * Compare a built report with the ledger rows of its day.
 * @param report - Generated daily report for review or export.
 * @returns Matched rows and discrepancies within the configured tolerance.
 */
compareDailyReport(report: DailyReport): CompareResult

/**
 * Build a voucher proposal without saving a formal voucher.
 * @param date - Receipt date in YYYY-MM-DD form.
 * @returns Proposed voucher lines and validation findings.
 */
buildVoucher(date: string): VoucherBuild

/**
 * Aggregate positive open receivables after relief and linked allocations.
 * @returns Owing merchant count and positive balances grouped by fee.
 */
receivableSummary(): ReceivableSummary

/**
 * Find positive merchant balances by shop, name, or brand substring.
 * @param query - Substring matched against shop number, merchant name, or brand.
 * @returns Matching positive merchant balances, largest first.
 */
merchantBalance(query: string): MerchantBalance[]

/**
 * Find merchants with positive receivables due before the cutoff.
 * @param days - UTC days subtracted from the reference date.
 * @param today - Reference date in YYYY-MM-DD form.
 * @returns Owing merchants and oldest qualifying due dates.
 */
overdue(days: number, today: string): OverdueRow[]

/**
 * Group booked allocations by source for one receipt date.
 * @param date - Receipt date in YYYY-MM-DD form.
 * @returns Source totals in integer cents and distinct receipt counts.
 */
todayReceipts(date: string): ReceiptToday[]

/**
 * Inspect a payment draft without writing financial rows.
 * @param text - User payment text or accumulated conversation draft.
 * @returns Merchant candidates, summary, and amount/fee readiness.
 */
previewPayment(text: string): PaymentPreview

/**
 * Validate an offered merchant and register the draft payment.
 * @param text - User payment text or accumulated conversation draft.
 * @param shopNo - Selected shop number.
 * @returns Saved receipt and allocation status; invalid selection throws.
 */
confirmPayment(text: string, shopNo: string): RegisterResult

/**
 * Extract payment fields without writing financial rows.
 * @param text - User payment text or accumulated conversation draft.
 * @returns Parsed amount, date, merchant, fee, and reference.
 */
parsePayment(text: string): ParsedPayment

/**
 * Parse and save a payment, allocating when merchant and fee resolve.
 * @param text - User payment text or accumulated conversation draft.
 * @returns Saved receipt and allocation status.
 */
registerPayment(text: string): RegisterResult

/**
 * Validate screenshot fields and register through the shared provider.
 * @param extraction - untrusted vision extraction, validated again before writes.
 * @returns committed receipt or pending allocation; invalid evidence throws without writing.
 */
registerPaymentFromImage(extraction: PaymentImageExtraction): RegisterResult

/**
 * Every merchant, for pickers.
 * @returns Current merchant master records.
 */
merchants(): Merchant[]

/**
 * Row counts across the main tables.
 * @returns the counts.
 */
counts(): FinanceCounts
```

Source: [`packages/hongyang/finance/src/service/finance-service.ts`](../../packages/hongyang/finance/src/service/finance-service.ts)
<!-- END GENERATED cordis-surface -->
