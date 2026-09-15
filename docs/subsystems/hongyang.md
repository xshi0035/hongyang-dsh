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
| `PaymentSubmissionInput`, `PaymentSubmission` | [Payment review queue](../../packages/hongyang/finance/src/provider/register/submission.ts) |
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
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @returns the import outcome.
 */
async importFile(file: string, kind?: ImportKind, actor: ActivityActor = TOOL_ACTOR): Promise<ImportOutcome>

/**
 * Re-run settlement splitting over every pending Tenpay / UnionPay credit.
 * @returns matched and unmatched credits.
 */
splitSettlements(): SplitResult

/**
 * Run the claim engine over everything unbooked.
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @returns Automatic bookings and the remaining review queue.
 */
runClaims(actor: ActivityActor = TOOL_ACTOR): ClaimRunResult

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
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @returns Booked allocations and payer-mapping status.
 */
confirmClaim( itemId: string, shopNo: string, splits: readonly Split[] | undefined, origin: AllocationOrigin, actor: ActivityActor = TOOL_ACTOR, ): ConfirmResult

/**
 * Remember a payer → shop mapping.
 * @param payerName - Payer name matched exactly.
 * @param shopNo - Selected shop number.
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @returns The merchant associated with the stored mapping.
 */
learnPayer(payerName: string, shopNo: string, actor: ActivityActor = TOOL_ACTOR): Merchant

/**
 * Build one day's income report from allocations.
 * @param date - Receipt date in YYYY-MM-DD form.
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @returns Daily report rows and integer-cent totals.
 */
buildDailyReport(date: string, actor: ActivityActor = TOOL_ACTOR): DailyReport

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
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @param receiptIds - Explicit selection to save as a durable draft; omitted for full-day diagnostics.
 * @returns Proposed voucher lines and validation findings.
 */
buildVoucher(date: string, actor: ActivityActor = TOOL_ACTOR, receiptIds?: readonly string[]): VoucherBuild

/** Read full-day voucher coverage and unselected receipts.
 * @param date - Reporting day.
 * @returns Allocated, drafted and unclaimed coverage.
 */
voucherQueue(date: string): VoucherQueue

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
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @returns Saved receipt and allocation status; invalid selection throws.
 */
confirmPayment(text: string, shopNo: string, actor: ActivityActor = TOOL_ACTOR): RegisterResult

/**
 * Extract payment fields without writing financial rows.
 * @param text - User payment text or accumulated conversation draft.
 * @returns Parsed amount, date, merchant, fee, and reference.
 */
parsePayment(text: string): ParsedPayment

/**
 * Parse and save a payment, allocating when merchant and fee resolve.
 * @param text - User payment text or accumulated conversation draft.
 * @param actor - Who performed the operation; recorded in the audit trail.
 * @returns Saved receipt and allocation status.
 */
registerPayment(text: string, actor: ActivityActor = TOOL_ACTOR): RegisterResult

/**
 * Preview validated screenshot fields without writing a payment.
 * @param extraction - Untrusted screenshot fields.
 * @param text - Accumulated user hints.
 * @returns Candidate amount, merchants and readiness for confirmation.
 */
previewPaymentImage(extraction: PaymentImageExtraction, text: string): PaymentPreview

/**
 * Revalidate screenshot evidence and commit a user-selected shop.
 * @param extraction - Original screenshot fields.
 * @param text - Accumulated user hints.
 * @param shopNo - Exact candidate selected by the user.
 * @param actor - Operator recorded in the audit trail.
 * @returns Committed registration; invalid drafts throw without writing.
 */
confirmPaymentImage(extraction: PaymentImageExtraction, text: string, shopNo: string, actor: ActivityActor = TOOL_ACTOR): RegisterResult

/**
 * Validate and register screenshot evidence directly.
 * @param extraction - Untrusted screenshot fields.
 * @param actor - Operator recorded in the audit trail.
 * @returns Saved receipt or pending allocation.
 */
registerPaymentFromImage(extraction: PaymentImageExtraction, actor: ActivityActor = TOOL_ACTOR): RegisterResult

/** Submit a DingTalk draft for workbench review without booking money.
 * @param input - Stable draft id, selected shop, and original evidence.
 * @returns Durable submission awaiting a workbench decision.
 */
submitPayment(input: PaymentSubmissionInput): PaymentSubmission

/**
 * Contribute a to-do counter to the workbench, for example drafts another transport holds.
 * @param provider - Stable id, label, and a counter read on every workbench request.
 * @returns Disposer removing the counter.
 */
registerTodoProvider(provider: WorkbenchTodoProvider): () => void

/**
 * The audit trail of one local day, newest first.
 * @param day - `YYYY-MM-DD`; defaults to today in the finance time zone.
 * @returns Recorded operations.
 */
activity(day: string = localDay()): ActivityEntry[]

/**
 * Everything the workbench page shows for one local day.
 * @param date - `YYYY-MM-DD`; defaults to today in the finance time zone.
 * @returns Receipts, registrations, to-dos, and the audit trail.
 */
workbench(date: string = localDay()): WorkbenchSummary

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
