/**
 * Pure JSON types shared by the Host tools and the browser cards. Nothing here
 * imports Node or React: the client bundle compiles this file too. The Host
 * projects these into `tool/result` metadata; the client reducer reads them
 * back, so they are the replayable contract of every card.
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

/** One ranked merchant candidate for a queued receipt. */
export interface SuggestionWire {
  readonly shopNo: string
  readonly name: string
  readonly brand: string
  /** 0..1. */
  readonly confidence: number
  readonly reason: string
}

/** One queued receipt. Amounts are yuan strings with two decimals. */
export interface PendingItemWire {
  readonly itemId: string
  readonly kind: 'bank' | 'pos'
  readonly date: string
  /** Chinese source label, e.g. `银行转账2038`. */
  readonly source: string
  readonly amount: string
  readonly payerName: string
  readonly remark: string
  readonly suggestions: readonly SuggestionWire[]
}

/** Unlabelled POS orders per settlement day. */
export interface UnlabelledPosWire {
  readonly date: string
  readonly count: number
  readonly amount: string
}

/** One row the engine booked without a person. */
export interface AutoBookedWire {
  readonly itemId: string
  readonly payerName: string
  readonly amount: string
  readonly shopNo: string
  readonly name: string
  readonly booked: string
  readonly confidence: number
}

/** Metadata `finance_claim` persists on its result for the pending-claims card. */
export interface ClaimMetaWire {
  readonly card: 'hy-finance/claims'
  readonly action: 'run' | 'list' | 'confirm' | 'learn'
  readonly pending: readonly PendingItemWire[]
  readonly unlabelledPos: readonly UnlabelledPosWire[]
  /** Rows the engine booked in this call (run only). */
  readonly autoBooked: readonly AutoBookedWire[]
  /** Confirmed item (confirm only). */
  readonly confirmed?: { itemId: string; shopNo: string; name: string; booked: string }
}

/** One ledger-comparison difference. */
export interface DiffRowWire {
  readonly kind: 'missing' | 'extra' | 'amount'
  readonly shopNo: string
  readonly merchantName: string
  readonly source: string
  readonly reportAmount: string
  readonly ledgerAmount: string
  readonly note: string
}

/** Metadata `finance_daily_report` persists on its result for the report card. */
export interface ReportMetaWire {
  readonly card: 'hy-finance/report'
  readonly reportId: string
  readonly date: string
  readonly rows: number
  readonly grandTotal: string
  readonly totals: readonly { fee: string; amount: string }[]
  readonly bySource: readonly { source: string; count: number; amount: string }[]
  readonly xlsxPath?: string | undefined
  readonly compare?: {
    readonly ledgerRows: number
    readonly matched: number
    readonly missing: number
    readonly extra: number
    readonly amountDiffs: number
    readonly reportTotal: string
    readonly ledgerTotal: string
    readonly diffs: readonly DiffRowWire[]
  } | undefined
}

/**
 * Serializable voucher proposal metadata consumed by the client review card.
 */
export interface VoucherMetaWire {
  readonly card: 'hy-finance/voucher'
  readonly coverage?: {
    totalCount: number
    totalAmount: string
    selectedCount: number
    selectedAmount: string
    remainingCount: number
    remainingAmount: string
  }
  readonly receiptIds?: readonly string[]
  readonly voucherId: string
  readonly date: string
  readonly lines: number
  readonly balanced: boolean
  readonly warnings: readonly string[]
  readonly voucherLines: readonly {
    lineNo: number
    summary: string
    subject: string
    subjectName: string
    debit: string
    credit: string
    warning?: string
  }[]
  readonly xlsxPath?: string | undefined
  readonly compare?: {
    matched: number
    diffs: readonly { line: number; expected: unknown; actual: unknown }[]
  } | undefined
}

/** Request body of `POST /api/hy-finance/claim/confirm`. */
export interface ConfirmRequestWire {
  readonly sessionId: string
  readonly itemId: string
  readonly shopNo: string
}

/** Response of the confirm route. */
export type ConfirmResponseWire =
  | {
    readonly ok: true
    readonly itemId: string
    readonly shopNo: string
    readonly name: string
    readonly booked: string
    readonly learned: boolean
  }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** One merchant for the card's picker. */
export interface MerchantWire {
  readonly shopNo: string
  readonly name: string
  readonly brand: string
}

/** One row of the workbench audit trail. Amounts are yuan strings. */
export interface ActivityWire {
  readonly id: string
  readonly at: string
  readonly actorKind: 'web' | 'dingtalk' | 'tool' | 'import' | 'engine'
  readonly actor: string
  readonly action: string
  readonly target: string
  readonly amount?: string | undefined
  readonly detail: string
}

/** Response of `GET /api/hy-finance/workbench?date=YYYY-MM-DD`. Amounts are yuan strings. */
export interface WorkbenchWire {
  readonly voucherQueue: {
    readonly allocatedAmount: string
    readonly draftedCount: number
    readonly draftedAmount: string
    readonly pendingCount: number
    readonly pendingAmount: string
    readonly unclaimedCount: number
    readonly unclaimedAmount: string
    readonly receipts: readonly {
      receiptId: string
      shopNo: string
      merchantName: string
      source: string
      amount: string
      fees: string
      remark: string
      voucherId: string | undefined
    }[]
  }
  readonly pendingReviews: readonly {
    readonly id: string
    readonly submittedAt: string
    readonly shopNo: string
    readonly merchantName: string
    readonly summary: string
    readonly text: string
    readonly paymentDate: string
    readonly transactionNo: string
    readonly duplicateMessage: string | undefined
  }[]
  readonly date: string
  readonly receipts: readonly { source: string; count: number; amount: string }[]
  readonly registrations: readonly {
    at: string
    source: string
    shopNo: string
    merchantName: string
    fee: string
    amount: string
    origin: string
    status: string
    transactionId: string
  }[]
  readonly registrationTotal: { count: number; amount: string }
  readonly todos: {
    pendingClaims: number
    pendingClaimsAmount: string
    unlabelledPos: number
    overdueMerchants: number
    overdueAmount: string
    reportBuilt: boolean
    voucherBuilt: boolean
    extra: readonly { id: string; label: string; count: number }[]
  }
  readonly activity: readonly ActivityWire[]
}

/** Path prefix of the card routes on the shared API channel. */
export const HY_FINANCE_API = '/api/hy-finance'
