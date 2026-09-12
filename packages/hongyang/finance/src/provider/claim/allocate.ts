/**
 * Booking a receipt against a merchant: explicit splits when the payer or the
 * operations desk said what the money is for, otherwise the unpaid
 * receivables in the client's priority order (rent, service, promotion,
 * electricity, water), with any remainder held as suspense (暂收款). Every
 * line gets its VAT split here; nothing downstream recomputes money.
 * @module @deepseek-ai/dsh-hy-finance/provider/claim/allocate
 */

import type { DatabaseSync } from 'node:sqlite'
import { ALLOCATION_PRIORITY, FEE_RULES, type FeeType } from '../../rules/fee-types.ts'
import { splitTax } from '../../rules/tax.ts'
import { FinanceError } from '../../service/errors.ts'
import { newId, type AllocationId, type MerchantId, type PlatformTxnId, type TransactionId } from '../../service/identifiers.ts'
import type { Allocation, AllocationOrigin } from '../../service/types.ts'

/** One explicit split of a receipt. */
export interface Split {
  readonly feeType: FeeType
  /** Cents; the splits must sum to the receipt. */
  readonly amount: number
  readonly periodStart?: string | undefined
  readonly periodEnd?: string | undefined
}

/** What to book. */
export interface AllocationRequest {
  readonly transactionId: TransactionId
  readonly platformTxnId?: PlatformTxnId | undefined
  readonly merchantId: MerchantId | undefined
  /** Cents to book. */
  readonly amount: number
  readonly splits?: readonly Split[] | undefined
  /** Fee types to try first when deriving splits from receivables. */
  readonly preferFees?: readonly FeeType[] | undefined
  /** Months (`YYYY-MM`) to prefer when deriving splits. */
  readonly preferMonths?: readonly string[] | undefined
  /** A fee to book the whole amount to when there is no merchant (parking, suspense). */
  readonly wholeFee?: FeeType | undefined
  readonly origin: AllocationOrigin
}

interface OpenRow {
  id: string
  fee_type: string
  period: string
  period_start: string | null
  period_end: string | null
  /** 减免后应收 minus what this system has already booked against the line. */
  open: number
}

function priorityOf(fee: FeeType, prefer: readonly FeeType[]): number {
  const p = prefer.indexOf(fee)
  if (p >= 0) return p
  const q = ALLOCATION_PRIORITY.indexOf(fee)
  return q >= 0 ? prefer.length + q : prefer.length + ALLOCATION_PRIORITY.length + 1
}

/**
 * Lines a payment can settle. The client's sheet already marks most lines as
 * received (it is a snapshot taken after the period), so "open" is measured
 * against this system's own bookings, not the sheet's 已收 column.
 */
function openLines(db: DatabaseSync, merchantId: MerchantId): OpenRow[] {
  return db.prepare(`SELECT r.id, r.fee_type, r.period, r.period_start, r.period_end,
      (r.amount_due - r.amount_relief) - COALESCE((SELECT SUM(a.amount_incl_tax) FROM allocation a WHERE a.receivable_id = r.id), 0) AS open
    FROM receivable r WHERE r.merchant_id = ? AND (r.amount_due - r.amount_relief) > 0`).all(merchantId) as unknown as OpenRow[]
}

/**
 * Derive splits from a merchant's receivable lines. Named months or fees
 * narrow the candidates; otherwise the latest period that still has open
 * lines is settled in the client's fee priority. Whatever the lines cannot
 * absorb is held as suspense.
 * @returns the derived splits, each carrying the line it settles.
 */
/** A split that knows which receivable line it settles. */
type LineSplit = Split & { receivableId?: string }

function deriveSplits(
  db: DatabaseSync, merchantId: MerchantId, amount: number, prefer: readonly FeeType[], months: readonly string[],
): LineSplit[] {
  let rows = openLines(db, merchantId).filter(r => r.open > 0)
  if (months.length > 0) rows = rows.filter(r => months.includes(r.period.slice(0, 7)))
  if (prefer.length > 0) rows = rows.filter(r => prefer.includes(r.fee_type as FeeType))
  // No month named: settle the newest period first, then walk back; a named
  // month keeps chronological order inside the named range.
  rows.sort((a, b) => (months.length === 0 ? b.period.localeCompare(a.period) : a.period.localeCompare(b.period))
    || priorityOf(a.fee_type as FeeType, prefer) - priorityOf(b.fee_type as FeeType, prefer))
  const splits: LineSplit[] = []
  let remaining = amount
  for (const r of rows) {
    if (remaining <= 0) break
    const take = Math.min(remaining, r.open)
    splits.push({
      feeType: r.fee_type as FeeType, amount: take, receivableId: r.id,
      periodStart: r.period_start ?? undefined, periodEnd: r.period_end ?? undefined,
    })
    remaining -= take
  }
  if (remaining > 0) {
    // A named fee with no receivable line (parking, deposits, promotion, a
    // prepayment) is still that fee, not suspense; only an unnamed remainder is held.
    const named = prefer[0]
    splits.push({ feeType: named !== undefined && rows.length === 0 ? named : 'unclaimed', amount: remaining })
  }
  return splits
}

/**
 * Book one receipt. Runs inside the caller's transaction.
 * @param db - open database.
 * @param request - what to book.
 * @returns the allocation rows written.
 * @throws {FinanceError} `AMOUNT_MISMATCH` when explicit splits do not sum to the amount.
 */
export function allocate(db: DatabaseSync, request: AllocationRequest): Allocation[] {
  let splits: readonly LineSplit[]
  if (request.splits !== undefined && request.splits.length > 0) {
    const sum = request.splits.reduce((s, x) => s + x.amount, 0)
    if (sum !== request.amount) {
      throw new FinanceError('AMOUNT_MISMATCH', `拆分合计 ${String(sum)} 分与收款 ${String(request.amount)} 分不相等`)
    }
    splits = request.merchantId === undefined ? request.splits : attachLines(db, request.merchantId, request.splits)
  } else if (request.merchantId === undefined) {
    splits = [{ feeType: request.wholeFee ?? 'unclaimed', amount: request.amount }]
  } else {
    splits = deriveSplits(db, request.merchantId, request.amount, request.preferFees ?? [], request.preferMonths ?? [])
  }
  const createdAt = new Date().toISOString()
  const insert = db.prepare(`INSERT INTO allocation
    (id, transaction_id, platform_txn_id, merchant_id, receivable_id, fee_type, period_start, period_end, amount_incl_tax, tax_rate, tax_amount, origin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const out: Allocation[] = []
  for (const s of splits) {
    const tax = splitTax(s.feeType, s.amount)
    const row: Allocation = {
      id: newId<AllocationId>('alc'),
      transactionId: request.transactionId,
      platformTxnId: request.platformTxnId,
      merchantId: request.merchantId,
      receivableId: (s.receivableId ?? undefined) as Allocation['receivableId'],
      feeType: s.feeType,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      amountInclTax: s.amount,
      taxRate: tax.rate,
      taxAmount: tax.tax,
      origin: request.origin,
      createdAt,
    }
    insert.run(
      row.id, row.transactionId, row.platformTxnId ?? null, row.merchantId ?? null, row.receivableId ?? null, row.feeType,
      row.periodStart ?? null, row.periodEnd ?? null, row.amountInclTax, row.taxRate, row.taxAmount, row.origin, row.createdAt,
    )
    out.push(row)
  }
  return out
}

/** Explicit splits respect supplied periods; otherwise settle the same fee oldest first. */
function attachLines(db: DatabaseSync, merchantId: MerchantId, splits: readonly Split[]): LineSplit[] {
  const open = openLines(db, merchantId).filter(r => r.open > 0).sort((a, b) => a.period.localeCompare(b.period))
  return splits.map((s) => {
    const line = open.find(r => r.fee_type === s.feeType && r.open >= s.amount
      && (s.periodStart === undefined || r.period_start === s.periodStart)
      && (s.periodEnd === undefined || r.period_end === s.periodEnd))
    if (line === undefined) return s
    line.open -= s.amount
    return {
      ...s, receivableId: line.id,
      periodStart: s.periodStart ?? line.period_start ?? undefined,
      periodEnd: s.periodEnd ?? line.period_end ?? undefined,
    }
  })
}

/** Human summary of an allocation set, e.g. `租金 29650.92 + 经营服务费 13446.00`. */
export function describeAllocations(rows: readonly Allocation[]): string {
  return rows.map(r => `${FEE_RULES[r.feeType].label} ${(r.amountInclTax / 100).toFixed(2)}`).join(' + ')
}
