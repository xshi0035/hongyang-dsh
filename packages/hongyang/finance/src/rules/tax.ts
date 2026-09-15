/**
 * Money arithmetic. Every amount is carried as integer cents so that splitting
 * a tax-inclusive receipt into revenue and VAT never loses a fen; the only
 * rounding is the one the client's accountant performs, `round(incl / (1+r) * r, 2)`.
 * @module @deepseek-ai/dsh-hy-finance/rules/tax
 */

import { FEE_RULES, type FeeType, type TaxRate } from './fee-types.ts'

/** Integer cents; never a float. */
export type Cents = number

/**
 * Parse a spreadsheet or chat amount into cents.
 * @param value - a number, or text such as `29,650.92` / `¥200.0` / `-3911.04`.
 * @returns cents, or `undefined` when the value is not an amount.
 */
export function toCents(value: unknown): Cents | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : undefined
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[,，¥￥元\s]/g, '')
  if (text.length === 0 || !/^-?\d+(\.\d+)?$/.test(text)) return undefined
  return Math.round(Number(text) * 100)
}

/**
 * Format cents as the two-decimal string the client's sheets use.
 * @param cents - integer cents.
 * @returns e.g. `29650.92`; negative amounts keep their sign.
 */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Cents as a JavaScript number of yuan, for spreadsheet cells.
 * @param cents - integer cents.
 * @returns yuan with at most two decimals.
 */
export function toYuan(cents: Cents): number {
  return Math.round(cents) / 100
}

/**
 * VAT embedded in a tax-inclusive amount, rounded the way the accountant does.
 * @param inclusiveCents - tax-inclusive amount in cents.
 * @param rate - VAT rate.
 * @returns tax in cents; `0` for non-taxable fees.
 */
export function taxOf(inclusiveCents: Cents, rate: TaxRate): Cents {
  if (rate === 0) return 0
  return Math.sign(inclusiveCents) * Math.round(Math.abs(inclusiveCents) / (1 + rate) * rate)
}

/** Tax split of one allocation line. */
export interface TaxSplit {
  /** Tax-inclusive amount, cents. */
  readonly inclusive: Cents
  /** VAT rate applied. */
  readonly rate: TaxRate
  /** VAT, cents. */
  readonly tax: Cents
  /** Revenue net of VAT, cents. */
  readonly net: Cents
}

/**
 * Split a received fee into net revenue and VAT using the fee's rate.
 * @param feeType - which fee was received.
 * @param inclusiveCents - tax-inclusive amount in cents.
 * @returns the split.
 */
export function splitTax(feeType: FeeType, inclusiveCents: Cents): TaxSplit {
  const rate = FEE_RULES[feeType].taxRate
  const tax = taxOf(inclusiveCents, rate)
  return { inclusive: inclusiveCents, rate, tax, net: inclusiveCents - tax }
}
