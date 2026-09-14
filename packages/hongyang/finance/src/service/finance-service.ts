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
import { buildVoucher, type VoucherBuild } from '../provider/voucher/build.ts'
import { merchantBalance, overdue, receivableSummary, todayReceipts, type MerchantBalance, type OverdueRow, type ReceivableSummary, type ReceiptToday } from '../provider/query/dashboard.ts'
import { registerPaymentFromImage, type PaymentImageExtraction } from '../provider/register/image.ts'
import { parsePaymentText, registerPayment, type ParsedPayment, type RegisterResult } from '../provider/register/payment.ts'
import { previewPayment, confirmPayment, type PaymentPreview } from '../provider/register/conversation.ts'
import type { AllocationOrigin, FinanceCounts, ImportKind, Merchant } from './types.ts'

/**
 * The finance domain service. Constructed by the root plugin; the database
 * opens during `[Service.init]` and closes with the fiber.
 */
export class HyFinanceService extends Service {
  /** Resolved plugin configuration; replaced when the settings section changes. */
  config: ResolvedConfig
  private handle: DatabaseSync | undefined

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
   * @returns the import outcome.
   */
  importFile(file: string, kind?: ImportKind): Promise<ImportOutcome> {
    return importFile(this.db(), file, kind)
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
   * @returns Automatic bookings and the remaining review queue.
   */
  runClaims(): ClaimRunResult {
    return runClaims(this.db())
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
   * @returns Booked allocations and payer-mapping status.
   */
  confirmClaim(itemId: string, shopNo: string, splits: readonly Split[] | undefined, origin: AllocationOrigin): ConfirmResult {
    return confirmClaim(this.db(), itemId, shopNo, splits, origin)
  }

  /**
   * Remember a payer → shop mapping.
   * @param payerName - Payer name matched exactly.
   * @param shopNo - Selected shop number.
   * @returns The merchant associated with the stored mapping.
   */
  learnPayer(payerName: string, shopNo: string): Merchant {
    return learnPayer(this.db(), payerName, shopNo)
  }

  /**
   * Build one day's income report from allocations.
   * @param date - Receipt date in YYYY-MM-DD form.
   * @returns Daily report rows and integer-cent totals.
   */
  buildDailyReport(date: string): DailyReport {
    return buildDailyReport(this.db(), date)
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
   * @returns Proposed voucher lines and validation findings.
   */
  buildVoucher(date: string): VoucherBuild { return buildVoucher(this.db(), date, this.config) }

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
  previewPayment(text: string): PaymentPreview { return previewPayment(this.db(), text) }
  /**
   * Validate an offered merchant and register the draft payment.
   * @param text - User payment text or accumulated conversation draft.
   * @param shopNo - Selected shop number.
   * @returns Saved receipt and allocation status; invalid selection throws.
   */
  confirmPayment(text: string, shopNo: string): RegisterResult { return confirmPayment(this.db(), text, shopNo) }
  /**
   * Extract payment fields without writing financial rows.
   * @param text - User payment text or accumulated conversation draft.
   * @returns Parsed amount, date, merchant, fee, and reference.
   */
  parsePayment(text: string): ParsedPayment { return parsePaymentText(text) }
  /**
   * Parse and save a payment, allocating when merchant and fee resolve.
   * @param text - User payment text or accumulated conversation draft.
   * @returns Saved receipt and allocation status.
   */
  registerPayment(text: string): RegisterResult { return registerPayment(this.db(), text) }
  /**
   * Validate screenshot fields and register through the shared provider.
   * @param extraction - untrusted vision extraction, validated again before writes.
   * @returns committed receipt or pending allocation; invalid evidence throws without writing.
   */
  registerPaymentFromImage(extraction: PaymentImageExtraction): RegisterResult {
    return registerPaymentFromImage(this.db(), extraction, { companyName: this.config.companyName })
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
