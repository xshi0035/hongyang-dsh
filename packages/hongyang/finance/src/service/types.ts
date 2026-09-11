/**
 * Domain records as stored and as returned by the service. Amounts are
 * integer cents; dates are ISO `YYYY-MM-DD`; timestamps are ISO 8601.
 * @module @deepseek-ai/dsh-hy-finance/service/types
 */

import type { FeeType, TaxRate } from '../rules/fee-types.ts'
import type {
  AllocationId, BatchId, MerchantId, PlatformTxnId, ReceivableId, TransactionId,
} from './identifiers.ts'

/** Which client file an import batch came from. */
export type ImportKind =
  | 'bank_ccb' | 'wechat' | 'unionpay_pos' | 'recharge' | 'receivable' | 'ledger' | 'voucher' | 'pingan'

/** One imported file. */
export interface ImportBatch {
  readonly id: BatchId
  readonly kind: ImportKind
  readonly file: string
  readonly sha256: string
  readonly rows: number
  readonly importedAt: string
}

/** A tenant, keyed by shop number; the receivable sheet is the source of truth. */
export interface Merchant {
  readonly id: MerchantId
  /** Shop or spot number, e.g. `5F-5008`, `1F-1052`, `JYF1-009`. */
  readonly shopNo: string
  /** Contracting party as the receivable sheet names it (a person or a company). */
  readonly name: string
  readonly brand: string
  readonly floor: string
}

/** One receivable line: a fee due for a period. */
export interface Receivable {
  readonly id: ReceivableId
  readonly merchantId: MerchantId
  readonly feeType: FeeType
  /** Accounting period the sheet files it under, ISO first-of-month. */
  readonly period: string
  readonly periodStart: string | undefined
  readonly periodEnd: string | undefined
  readonly dueDate: string | undefined
  readonly amountDue: number
  readonly amountRelief: number
  readonly amountReceived: number
  readonly amountUnpaid: number
}

/** Where money arrived; mirrors the report's `收款来源` column. */
export type Source =
  | 'bank2038' | 'bank2035' | 'pingan' | 'pos' | 'wechat706' | 'wechat380' | 'dingtalk'

/** Chinese label of each {@link Source}, as the report prints it. */
export const SOURCE_LABELS: Readonly<Record<Source, string>> = {
  bank2038: '银行转账2038',
  bank2035: '银行转账2035',
  pingan: '平安银行',
  pos: 'POS收款',
  wechat706: '企业微信706',
  wechat380: '企业微信380',
  dingtalk: '钉钉上报',
}

/** Counterparty class of a bank credit, decided from the payer name. */
export type Channel = 'tenpay' | 'unionpay' | 'parking' | 'douyin' | 'internal' | 'transfer'

/** Claim state of a transaction. */
export type TransactionStatus =
  /** Matched by the engine with high confidence and allocated. */
  | 'auto'
  /** Allocated by a person (card confirmation or chat). */
  | 'manual'
  /** Awaiting a person. */
  | 'pending'
  /** A daily settlement whose money is represented by its platform detail rows. */
  | 'settlement'
  /** Deliberately not booked (e.g. Douyin marketing refunds). */
  | 'ignored'

/** One money movement into the company. */
export interface Transaction {
  readonly id: TransactionId
  readonly batchId: BatchId | undefined
  readonly source: Source
  readonly channel: Channel
  readonly txnTime: string
  readonly amount: number
  readonly payerName: string
  readonly payerAccount: string
  readonly remark: string
  readonly txnNo: string
  /** For a platform detail promoted to a transaction: the settlement it belongs to. */
  readonly parentId: TransactionId | undefined
  readonly status: TransactionStatus
  readonly merchantId: MerchantId | undefined
  readonly confidence: number
  readonly raw: string
}

/** One order from a WeChat or UnionPay statement, tied to the settlement that paid it out. */
export interface PlatformTxn {
  readonly id: PlatformTxnId
  readonly transactionId: TransactionId | undefined
  readonly platform: 'wechat' | 'pos'
  readonly merchantAccount: string
  readonly orderNo: string
  readonly txnTime: string
  readonly amount: number
  readonly fee: number
  readonly net: number
  readonly note: string
  /** Merchant hint parsed from the order (`商户:趣捞鱼-3033 电表:1`), when present. */
  readonly merchantHint: string
  readonly shopNo: string | undefined
  readonly merchantId: MerchantId | undefined
}

/** Who created an allocation. */
export type AllocationOrigin = 'engine' | 'user' | 'dingtalk' | 'import'

/** A slice of a transaction booked to one merchant, fee, and period. */
export interface Allocation {
  readonly id: AllocationId
  readonly transactionId: TransactionId
  readonly platformTxnId: PlatformTxnId | undefined
  readonly merchantId: MerchantId | undefined
  /** The receivable line this slice settles, when derived from one. */
  readonly receivableId: ReceivableId | undefined
  readonly feeType: FeeType
  readonly periodStart: string | undefined
  readonly periodEnd: string | undefined
  readonly amountInclTax: number
  readonly taxRate: TaxRate
  readonly taxAmount: number
  readonly origin: AllocationOrigin
  readonly createdAt: string
}

/** A remembered payer → merchant association. */
export interface PayerMapping {
  readonly payerName: string
  readonly payerAccount: string
  readonly merchantId: MerchantId
  readonly confirmed: boolean
  readonly learnedAt: string
}

/** Row counts the status tool and the settings card show. */
export interface FinanceCounts {
  readonly batches: number
  readonly merchants: number
  readonly receivables: number
  readonly transactions: number
  readonly pending: number
  readonly platformTxns: number
  readonly allocations: number
}
