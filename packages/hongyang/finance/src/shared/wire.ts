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

/** Path prefix of the card routes on the shared API channel. */
export const HY_FINANCE_API = '/api/hy-finance'
