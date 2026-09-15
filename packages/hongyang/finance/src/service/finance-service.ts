/**
 * Finance Service Definition and Provider in one class: `ctx.hyFinance`. Owns
 * the SQLite handle for the plugin's lifetime and exposes the domain
 * operations the tools, the DingTalk bridge, and the HTTP routes consume.
 * The provider modules under `provider/` implement each operation against the
 * handle this class owns; nothing else opens the database.
 * @module @deepseek-ai/dsh-hy-finance/service/finance-service
 */

import type { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import { resolveConfig, type Config as HyFinanceConfig, type ResolvedConfig } from '../config.ts'
import { openFinanceDatabase } from '../provider/db/schema.ts'
import { importFile, type ImportOutcome } from '../provider/import/index.ts'
import { splitSettlements, type SplitResult } from '../provider/split/settlement.ts'
import { confirmClaim, learnPayer, listPending, runClaims, type ClaimRunResult, type ConfirmResult, type PendingItem, type UnlabelledPos } from '../provider/claim/engine.ts'
import type { Split } from '../provider/claim/allocate.ts'
import { buildDailyReport, compareDailyReport, exportDailyReport, type CompareResult, type DailyReport } from '../provider/report/daily-report.ts'
import { listMerchants } from '../provider/db/repo.ts'
import { voucherQueue, saveVoucherDraft, type VoucherQueue } from '../provider/voucher/queue.ts'
import { buildVoucher, type VoucherBuild } from '../provider/voucher/build.ts'
import { merchantBalance, overdue, receivableSummary, todayReceipts, type MerchantBalance, type OverdueRow, type ReceivableSummary, type ReceiptToday } from '../provider/query/dashboard.ts'
import { previewPaymentImage, confirmPaymentImage, registerPaymentFromImage, type PaymentImageExtraction } from '../provider/register/image.ts'
import { parsePaymentText, registerPayment, type ParsedPayment, type RegisterResult } from '../provider/register/payment.ts'
import { assertPaymentNotDuplicate } from '../provider/register/duplicate.ts'
import { submitPayment, type PaymentSubmission, type PaymentSubmissionInput } from '../provider/register/submission.ts'
import { previewPayment, confirmPayment, type PaymentPreview } from '../provider/register/conversation.ts'
import { listActivity, localDay, recordActivity, type ActivityInput } from '../provider/activity/log.ts'
import { workbenchSummary, type WorkbenchSummary, type WorkbenchTodoSource } from '../provider/query/workbench.ts'
import { formatCents } from '../rules/tax.ts'
import { FEE_RULES } from '../rules/fee-types.ts'
import type { ActivityActor, ActivityEntry, AllocationOrigin, FinanceCounts, ImportKind, Merchant } from './types.ts'

/** Actor recorded when a caller does not identify itself: an agent tool in the web session. */
const TOOL_ACTOR: ActivityActor = { kind: 'tool', id: '' }

/** A plugin-owned to-do counter shown on the workbench (for example DingTalk drafts awaiting confirmation). */
export interface WorkbenchTodoProvider {
  readonly id: string
  readonly label: string
  count(): number
}

/**
 * The finance domain service. Constructed by the root plugin; the database
 * opens during `[Service.init]` and closes with the fiber.
 */
export class HyFinanceService extends Service {
  /** Resolved plugin configuration; replaced when the settings section changes. */
  config: ResolvedConfig
  private handle: DatabaseSync | undefined
  private readonly todoProviders = new Map<string, WorkbenchTodoProvider>()

  /**
   * @param ctx - owning context.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: HyFinanceConfig) {
    super(ctx, 'hyFinance')
    this.config = resolveConfig(config)
  }

  /** Open the database and register its disposal. */
  protected async [Service.init](): Promise<void> {
    const db = await openFinanceDatabase(this.config.dbPath)
    this.handle = db
    this.ctx.effect(() => () => {
      db.close()
      this.handle = undefined
    }, 'hy-finance: close database')
  }

  /**
   * The open database. Provider modules borrow it for one operation at a time.
   * @returns the handle.
   * @throws when called before init or after disposal.
   */
  db(): DatabaseSync {
    if (this.handle === undefined) throw new Error('hy-finance: database is not open')
    return this.handle
  }

  /**
   * Replace the live configuration (settings section change).
   * @param config - the new validated configuration.
   */
  reconfigure(config: HyFinanceConfig): void {
    this.config = resolveConfig(config)
  }

  /**
   * Import one client file; bank and platform statements also re-run
   * settlement splitting.
   * @param file - absolute path.
   * @param kind - explicit kind, or detected from the headers.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @returns the import outcome.
   */
  async importFile(file: string, kind?: ImportKind, actor: ActivityActor = TOOL_ACTOR): Promise<ImportOutcome> {
    const outcome = await importFile(this.db(), file, kind)
    this.log({
      actor, action: 'import_file', target: file,
      detail: outcome.duplicate ? `重复导入已跳过：${outcome.kind}` : `导入 ${outcome.kind}`,
    })
    return outcome
  }

  private log(input: ActivityInput): void {
    recordActivity(this.db(), input)
  }

  /**
   * Re-run settlement splitting over every pending Tenpay / UnionPay credit.
   * @returns matched and unmatched credits.
   */
  splitSettlements(): SplitResult {
    return splitSettlements(this.db())
  }

  /**
   * Run the claim engine over everything unbooked.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @returns Automatic bookings and the remaining review queue.
   */
  runClaims(actor: ActivityActor = TOOL_ACTOR): ClaimRunResult {
    const result = runClaims(this.db())
    this.log({
      actor, action: 'run_claims',
      detail: `自动认领：银行 ${String(result.bankAuto)}、停车 ${String(result.parkingAuto)}、POS ${String(result.posAuto)}；待人工 ${String(result.pending.length)}`,
    })
    return result
  }

  /**
   * The pending queue with suggestions.
   * @returns Pending receipts and POS rows needing merchant labels.
   */
  listPending(): { pending: PendingItem[]; unlabelledPos: UnlabelledPos[] } {
    return listPending(this.db())
  }

  /**
   * Book one queued item to a shop.
   * @param itemId - `txn:<id>` or `ptx:<id>`.
   * @param shopNo - shop number; empty books suspense.
   * @param splits - explicit splits in cents.
   * @param origin - who confirmed.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @returns Booked allocations and payer-mapping status.
   */
  confirmClaim(
    itemId: string, shopNo: string, splits: readonly Split[] | undefined, origin: AllocationOrigin, actor: ActivityActor = TOOL_ACTOR,
  ): ConfirmResult {
    const result = confirmClaim(this.db(), itemId, shopNo, splits, origin)
    const cents = result.allocations.reduce((sum, allocation) => sum + allocation.amountInclTax, 0)
    this.log({
      actor, action: 'confirm_claim', target: itemId, amount: cents,
      detail: `认领 ${itemId} → ${result.merchant === undefined ? '暂收款' : `${result.merchant.shopNo} ${result.merchant.name}`}：${result.booked}`,
    })
    return result
  }

  /**
   * Remember a payer → shop mapping.
   * @param payerName - Payer name matched exactly.
   * @param shopNo - Selected shop number.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @returns The merchant associated with the stored mapping.
   */
  learnPayer(payerName: string, shopNo: string, actor: ActivityActor = TOOL_ACTOR): Merchant {
    const merchant = learnPayer(this.db(), payerName, shopNo)
    this.log({ actor, action: 'learn_payer', target: payerName, detail: `记住付款人 ${payerName} → ${merchant.shopNo} ${merchant.name}` })
    return merchant
  }

  /**
   * Build one day's income report from allocations.
   * @param date - Receipt date in YYYY-MM-DD form.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @returns Daily report rows and integer-cent totals.
   */
  buildDailyReport(date: string, actor: ActivityActor = TOOL_ACTOR): DailyReport {
    const report = buildDailyReport(this.db(), date)
    this.log({
      actor, action: 'build_report', target: date, amount: report.grandTotal,
      detail: `生成 ${date} 收入日报：${String(report.rows.length)} 行，合计 ${formatCents(report.grandTotal)} 元`,
    })
    return report
  }

  /**
   * Write a built report as xlsx into `dir`.
   * @param report - Generated daily report for review or export.
   * @param dir - Destination directory, created when absent.
   * @returns Absolute path to the written XLSX workbook.
   */
  exportDailyReport(report: DailyReport, dir: string): Promise<string> {
    return exportDailyReport(report, dir)
  }

  /**
   * Compare a built report with the ledger rows of its day.
   * @param report - Generated daily report for review or export.
   * @returns Matched rows and discrepancies within the configured tolerance.
   */
  compareDailyReport(report: DailyReport): CompareResult {
    return compareDailyReport(this.db(), report, this.config.compareToleranceCents)
  }

  /**
   * Build a voucher proposal without saving a formal voucher.
   * @param date - Receipt date in YYYY-MM-DD form.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @param receiptIds - Explicit selection to save as a durable draft; omitted for full-day diagnostics.
   * @returns Proposed voucher lines and validation findings.
   */
  buildVoucher(date: string, actor: ActivityActor = TOOL_ACTOR, receiptIds?: readonly string[]): VoucherBuild {
    if (receiptIds !== undefined) return saveVoucherDraft(this.db(), date, receiptIds, this.config, actor)
    const voucher = buildVoucher(this.db(), date, this.config)
    this.log({
      actor, action: 'build_voucher', target: date,
      detail: `生成 ${date} 凭证草稿：${String(voucher.lines.length)} 行，${voucher.checks.balanced ? '借贷平衡' : '借贷不平'}`,
    })
    return voucher
  }

  /** Read full-day voucher coverage and unselected receipts.
   * @param date - Reporting day.
   * @returns Allocated, drafted and unclaimed coverage.
   */
  voucherQueue(date: string): VoucherQueue { return voucherQueue(this.db(), date) }

  /**
   * Aggregate positive open receivables after relief and linked allocations.
   * @returns Owing merchant count and positive balances grouped by fee.
   */
  receivableSummary(): ReceivableSummary { return receivableSummary(this.db()) }
  /**
   * Find positive merchant balances by shop, name, or brand substring.
   * @param query - Substring matched against shop number, merchant name, or brand.
   * @returns Matching positive merchant balances, largest first.
   */
  merchantBalance(query: string): MerchantBalance[] { return merchantBalance(this.db(), query) }
  /**
   * Find merchants with positive receivables due before the cutoff.
   * @param days - UTC days subtracted from the reference date.
   * @param today - Reference date in YYYY-MM-DD form.
   * @returns Owing merchants and oldest qualifying due dates.
   */
  overdue(days: number, today: string): OverdueRow[] { return overdue(this.db(), days, today) }
  /**
   * Group booked allocations by source for one receipt date.
   * @param date - Receipt date in YYYY-MM-DD form.
   * @returns Source totals in integer cents and distinct receipt counts.
   */
  todayReceipts(date: string): ReceiptToday[] { return todayReceipts(this.db(), date) }
  /**
   * Inspect a payment draft without writing financial rows.
   * @param text - User payment text or accumulated conversation draft.
   * @returns Merchant candidates, summary, and amount/fee readiness.
   */
  previewPayment(text: string): PaymentPreview {
    const preview = previewPayment(this.db(), text)
    if (preview.ready) assertPaymentNotDuplicate(this.db(), parsePaymentText(text).txnNo)
    return preview
  }
  /**
   * Validate an offered merchant and register the draft payment.
   * @param text - User payment text or accumulated conversation draft.
   * @param shopNo - Selected shop number.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @returns Saved receipt and allocation status; invalid selection throws.
   */
  confirmPayment(text: string, shopNo: string, actor: ActivityActor = TOOL_ACTOR): RegisterResult {
    const result = confirmPayment(this.db(), text, shopNo)
    this.logRegistration('confirm_payment', actor, result)
    return result
  }

  private logRegistration(action: 'register_payment' | 'confirm_payment', actor: ActivityActor, result: RegisterResult): void {
    const fee = result.parsed.feeType === undefined ? '费项待补充' : FEE_RULES[result.parsed.feeType].label
    const merchant = result.merchantShopNo === undefined ? '商户待补充' : `${result.merchantShopNo} ${result.merchantName ?? ''}`
    this.log({
      actor, action, target: result.transactionId, amount: result.parsed.amount,
      detail: `${result.booked ? '登记' : '记录待补充'} ${merchant} ${fee} ${formatCents(result.parsed.amount)} 元`,
    })
  }
  /**
   * Extract payment fields without writing financial rows.
   * @param text - User payment text or accumulated conversation draft.
   * @returns Parsed amount, date, merchant, fee, and reference.
   */
  parsePayment(text: string): ParsedPayment { return parsePaymentText(text) }
  /**
   * Parse and save a payment, allocating when merchant and fee resolve.
   * @param text - User payment text or accumulated conversation draft.
   * @param actor - Who performed the operation; recorded in the audit trail.
   * @returns Saved receipt and allocation status.
   */
  registerPayment(text: string, actor: ActivityActor = TOOL_ACTOR): RegisterResult {
    const result = registerPayment(this.db(), text)
    this.logRegistration('register_payment', actor, result)
    return result
  }
  /**
   * Preview validated screenshot fields without writing a payment.
   * @param extraction - Untrusted screenshot fields.
   * @param text - Accumulated user hints.
   * @returns Candidate amount, merchants and readiness for confirmation.
   */
  previewPaymentImage(extraction: PaymentImageExtraction, text: string): PaymentPreview {
    const preview = previewPaymentImage(this.db(), extraction, text, { companyName: this.config.companyName })
    assertPaymentNotDuplicate(this.db(), extraction.transactionNo ?? '')
    return preview
  }

  /**
   * Revalidate screenshot evidence and commit a user-selected shop.
   * @param extraction - Original screenshot fields.
   * @param text - Accumulated user hints.
   * @param shopNo - Exact candidate selected by the user.
   * @param actor - Operator recorded in the audit trail.
   * @returns Committed registration; invalid drafts throw without writing.
   */
  confirmPaymentImage(extraction: PaymentImageExtraction, text: string, shopNo: string, actor: ActivityActor = TOOL_ACTOR): RegisterResult {
    const result = confirmPaymentImage(this.db(), extraction, text, shopNo, { companyName: this.config.companyName })
    this.logRegistration('register_payment', actor, result)
    return result
  }

  /**
   * Validate and register screenshot evidence directly.
   * @param extraction - Untrusted screenshot fields.
   * @param actor - Operator recorded in the audit trail.
   * @returns Saved receipt or pending allocation.
   */
  registerPaymentFromImage(extraction: PaymentImageExtraction, actor: ActivityActor = TOOL_ACTOR): RegisterResult {
    const result = registerPaymentFromImage(this.db(), extraction, { companyName: this.config.companyName })
    this.logRegistration('register_payment', actor, result)
    return result
  }

  /** Submit a DingTalk draft for workbench review without booking money.
   * @param input - Stable draft id, selected shop, and original evidence.
   * @returns Durable submission awaiting a workbench decision.
   */
  submitPayment(input: PaymentSubmissionInput): PaymentSubmission {
    return submitPayment(this.db(), input, { companyName: this.config.companyName })
  }

  /**
   * Contribute a to-do counter to the workbench, for example drafts another transport holds.
   * @param provider - Stable id, label, and a counter read on every workbench request.
   * @returns Disposer removing the counter.
   */
  registerTodoProvider(provider: WorkbenchTodoProvider): () => void {
    this.todoProviders.set(provider.id, provider)
    return () => { this.todoProviders.delete(provider.id) }
  }

  /**
   * The audit trail of one local day, newest first.
   * @param day - `YYYY-MM-DD`; defaults to today in the finance time zone.
   * @returns Recorded operations.
   */
  activity(day: string = localDay()): ActivityEntry[] {
    return listActivity(this.db(), day)
  }

  /**
   * Everything the workbench page shows for one local day.
   * @param date - `YYYY-MM-DD`; defaults to today in the finance time zone.
   * @returns Receipts, registrations, to-dos, and the audit trail.
   */
  workbench(date: string = localDay()): WorkbenchSummary {
    const extraTodos: WorkbenchTodoSource[] = [...this.todoProviders.values()].map((provider) => {
      let count = 0
      try { count = provider.count() } catch { count = 0 }
      return { id: provider.id, label: provider.label, count }
    })
    return workbenchSummary(this.db(), date, { overdueDays: 30, extraTodos })
  }

  /**
   * Every merchant, for pickers.
   * @returns Current merchant master records.
   */
  merchants(): Merchant[] {
    return listMerchants(this.db())
  }

  /**
   * Row counts across the main tables.
   * @returns the counts.
   */
  counts(): FinanceCounts {
    const db = this.db()
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    return {
      batches: count('SELECT COUNT(*) AS n FROM import_batch'),
      merchants: count('SELECT COUNT(*) AS n FROM merchant'),
      receivables: count('SELECT COUNT(*) AS n FROM receivable'),
      transactions: count('SELECT COUNT(*) AS n FROM "transaction"'),
      pending: count('SELECT COUNT(*) AS n FROM "transaction" WHERE status = \'pending\''),
      platformTxns: count('SELECT COUNT(*) AS n FROM platform_txn'),
      allocations: count('SELECT COUNT(*) AS n FROM allocation'),
    }
  }
}
