/**
 * Pure JSON types shared by the Host tools and the browser cards. Nothing here
 * imports Node or React: the client bundle compiles this file too.
 * @module @deepseek-ai/dsh-hy-finance/shared/wire
 */

/** Row counts as `finance_status` returns them and the settings card shows them. */
export interface FinanceCountsWire {
  readonly batches: number
  readonly merchants: number
  readonly receivables: number
  readonly transactions: number
  readonly pending: number
  readonly platformTxns: number
  readonly allocations: number
}
