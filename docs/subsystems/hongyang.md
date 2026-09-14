# Hongyang finance

English | [中文](hongyang.zh.md)

This reference owns the finance records and service operations used by the [finance plugin](../../packages/hongyang/finance/README.md) and [DingTalk bridge](../../packages/hongyang/dingtalk/README.md). The finance service owns one SQLite connection for its plugin lifetime; tools and transport adapters use that service for imports, payment registration, allocation, reports, and voucher drafts.

## Records and amounts

The [domain records](../../packages/hongyang/finance/src/service/types.ts) distinguish merchants, imported transactions, platform detail rows, receivables, and allocations. A merchant's `shopNo` identifies a shop; `name` names the contracting party and `brand` carries the imported brand text. These names need not be equal. Amounts use integer cents, dates use `YYYY-MM-DD`, and timestamps use ISO 8601. [Identifiers](../../packages/hongyang/finance/src/service/identifiers.ts) distinguish records from different tables.

An allocation assigns part of a transaction to a merchant and fee, with an optional receivable reference. A registered payment is not proof of bank settlement or a posted accounting voucher. [Fee rules](../../packages/hongyang/finance/src/rules/fee-types.ts) and [tax arithmetic](../../packages/hongyang/finance/src/rules/tax.ts) own deterministic classification and calculation.

The service returns the following typed results. Their declarations remain beside the provider that constructs them.

| Types | Declaration owner |
|---|---|
| `Merchant`, `ImportKind`, `AllocationOrigin`, `FinanceCounts` | [Domain records](../../packages/hongyang/finance/src/service/types.ts) |
| `ImportOutcome` | [File import](../../packages/hongyang/finance/src/provider/import/index.ts) |
| `SplitResult` | [Settlement splitting](../../packages/hongyang/finance/src/provider/split/settlement.ts) |
| `Split` | [Allocation inputs](../../packages/hongyang/finance/src/provider/claim/allocate.ts) |
| `ClaimRunResult`, `PendingItem`, `UnlabelledPos`, `ConfirmResult` | [Claim engine](../../packages/hongyang/finance/src/provider/claim/engine.ts) |
| `DailyReport`, `CompareResult` | [Daily reports](../../packages/hongyang/finance/src/provider/report/daily-report.ts) |
| `VoucherBuild` | [Voucher drafts](../../packages/hongyang/finance/src/provider/voucher/build.ts) |
| `ReceivableSummary`, `MerchantBalance`, `OverdueRow`, `ReceiptToday` | [Dashboard queries](../../packages/hongyang/finance/src/provider/query/dashboard.ts) |
| `ParsedPayment`, `RegisterResult` | [Payment registration](../../packages/hongyang/finance/src/provider/register/payment.ts) |
| `PaymentPreview` | [Conversation preview](../../packages/hongyang/finance/src/provider/register/conversation.ts) |
| `PaymentImageExtraction` | [Image evidence](../../packages/hongyang/finance/src/provider/register/image.ts) |

## Payment drafts and confirmation

The [payment parser](../../packages/hongyang/finance/src/provider/register/payment.ts) extracts one payment's amount, date, fee, and merchant hint. The [conversation provider](../../packages/hongyang/finance/src/provider/register/conversation.ts) previews merchant candidates without writing a transaction. Confirmation requires a valid amount, exactly one fee, and an exact shop number from the preview candidates before it calls the payment registration provider.

The [DingTalk bridge](../../packages/hongyang/dingtalk/src/bridge.ts) owns temporary conversation drafts; the finance service owns committed transactions and allocations. A draft is neither a durable transaction nor general conversation memory. Transport card variables and callbacks are defined in the [DingTalk types](../../packages/hongyang/dingtalk/src/types.ts).

## Configuration and lifecycle

The [configuration](../../packages/hongyang/finance/src/config.ts) selects the database path, report tolerance, card display preference, output tax accounts, and receiving company. The [service](../../packages/hongyang/finance/src/service/finance-service.ts) opens the database during initialization and closes it when the plugin is disposed. Calling `db()` before initialization or after disposal throws.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
