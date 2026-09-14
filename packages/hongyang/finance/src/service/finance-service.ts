import { previewPayment, confirmPayment } from '../provider/register/conversation.ts'
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
import { resolveConfig, type Config, type ResolvedConfig } from '../config.ts'
import { openFinanceDatabase } from '../provider/db/schema.ts'
import { importFile, type ImportOutcome } from '../provider/import/index.ts'
import { splitSettlements, type SplitResult } from '../provider/split/settlement.ts'
import { confirmClaim, learnPayer, listPending, runClaims, type ClaimRunResult, type ConfirmResult, type PendingItem, type UnlabelledPos } from '../provider/claim/engine.ts'
import type { Split } from '../provider/claim/allocate.ts'
import { buildDailyReport, compareDailyReport, exportDailyReport, type CompareResult, type DailyReport } from '../provider/report/daily-report.ts'
import { listMerchants } from '../provider/db/repo.ts'
import { buildVoucher } from '../provider/voucher/build.ts'
import { merchantBalance, overdue, receivableSummary, todayReceipts, type MerchantBalance, type OverdueRow, type ReceivableSummary, type ReceiptToday } from '../provider/query/dashboard.ts'
import { registerPaymentFromImage, type PaymentImageExtraction } from '../provider/register/image.ts'
import { parsePaymentText, registerPayment, type RegisterResult } from '../provider/register/payment.ts'
import type { AllocationOrigin, FinanceCounts, ImportKind, Merchant } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Hongyang finance domain: master data, receipts, claims, reports, vouchers. */
    hyFinance: HyFinanceService
  }
}

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
  constructor(ctx: Context, config: Config) {
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
  reconfigure(config: Config): void {
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

  /** Run the claim engine over everything unbooked. */
  runClaims(): ClaimRunResult {
    return runClaims(this.db())
  }

  /** The pending queue with suggestions. */
  listPending(): { pending: PendingItem[]; unlabelledPos: UnlabelledPos[] } {
    return listPending(this.db())
  }

  /**
   * Book one queued item to a shop.
   * @param itemId - `txn:<id>` or `ptx:<id>`.
   * @param shopNo - shop number; empty books suspense.
   * @param splits - explicit splits in cents.
   * @param origin - who confirmed.
   */
  confirmClaim(itemId: string, shopNo: string, splits: readonly Split[] | undefined, origin: AllocationOrigin): ConfirmResult {
    return confirmClaim(this.db(), itemId, shopNo, splits, origin)
  }

  /** Remember a payer → shop mapping. */
  learnPayer(payerName: string, shopNo: string): Merchant {
    return learnPayer(this.db(), payerName, shopNo)
  }

  /** Build one day's income report from allocations. */
  buildDailyReport(date: string): DailyReport {
    return buildDailyReport(this.db(), date)
  }

  /** Write a built report as xlsx into `dir`. */
  exportDailyReport(report: DailyReport, dir: string): Promise<string> {
    return exportDailyReport(report, dir)
  }

  /** Compare a built report with the ledger rows of its day. */
  compareDailyReport(report: DailyReport): CompareResult {
    return compareDailyReport(this.db(), report, this.config.compareToleranceCents)
  }

  buildVoucher(date: string) { return buildVoucher(this.db(), date, this.config) }

  receivableSummary(): ReceivableSummary { return receivableSummary(this.db()) }
  merchantBalance(query: string): MerchantBalance[] { return merchantBalance(this.db(), query) }
  overdue(days: number, today: string): OverdueRow[] { return overdue(this.db(), days, today) }
  todayReceipts(date: string): ReceiptToday[] { return todayReceipts(this.db(), date) }
  previewPayment(text: string) { return previewPayment(this.db(), text) }
  confirmPayment(text: string, shopNo: string) { return confirmPayment(this.db(), text, shopNo) }
  parsePayment(text: string) { return parsePaymentText(text) }
  registerPayment(text: string): RegisterResult { return registerPayment(this.db(), text) }
  /**
   * Validate screenshot fields and register through the shared provider.
   * @param extraction - untrusted vision extraction, validated again before writes.
   * @returns committed receipt or pending allocation; invalid evidence throws without writing.
   */
  registerPaymentFromImage(extraction: PaymentImageExtraction): RegisterResult {
    return registerPaymentFromImage(this.db(), extraction, { companyName: this.config.companyName })
  }

  /** Every merchant, for pickers. */
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
