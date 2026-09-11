/**
 * Branded identifiers crossing the tool, wire, and database boundaries. A
 * bare string never stands in for one of these; the brand documents which
 * table the id addresses.
 * @module @deepseek-ai/dsh-hy-finance/service/identifiers
 */

/** Nominal brand helper local to this package. */
type Branded<B extends string> = string & { readonly __hyFinanceBrand: B }

/** Row id of `import_batch`. */
export type BatchId = Branded<'BatchId'>
/** Row id of `merchant`. */
export type MerchantId = Branded<'MerchantId'>
/** Row id of `receivable`. */
export type ReceivableId = Branded<'ReceivableId'>
/** Row id of `transaction`. */
export type TransactionId = Branded<'TransactionId'>
/** Row id of `platform_txn`. */
export type PlatformTxnId = Branded<'PlatformTxnId'>
/** Row id of `allocation`. */
export type AllocationId = Branded<'AllocationId'>
/** Row id of `daily_report`. */
export type ReportId = Branded<'ReportId'>
/** Row id of `voucher`. */
export type VoucherId = Branded<'VoucherId'>

/**
 * Mint a fresh id with a readable prefix, e.g. `txn_01J...`; the suffix is a
 * time-ordered random string so rows sort by creation.
 * @param prefix - table prefix.
 * @returns the id.
 */
export function newId<T extends Branded<string>>(prefix: string): T {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${time}${rand}` as T
}
