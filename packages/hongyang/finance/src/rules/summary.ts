/**
 * Voucher summary (摘要) templates, copied from the client's Kingdee vouchers:
 * `收到商户{费项}{期间}-{铺位号}&{商户名}` for fees and
 * `收到暂收款项-{付款人}` for suspense receipts.
 * @module @deepseek-ai/dsh-hy-finance/rules/summary
 */

import { FEE_RULES, type FeeType } from './fee-types.ts'

/** Inputs of one fee summary line. */
export interface FeeSummaryInput {
  readonly feeType: FeeType
  /** ISO date `YYYY-MM-DD` of the period start, or `undefined` for period-less fees such as deposits. */
  readonly periodStart?: string | undefined
  /** ISO date `YYYY-MM-DD` of the period end. */
  readonly periodEnd?: string | undefined
  readonly shopNo: string
  readonly merchantName: string
}

/**
 * Render a period as the client writes it: `2026.4.1-2026.4.30`; a single
 * month collapses to `2026.4`.
 * @param start - ISO start date.
 * @param end - ISO end date.
 * @returns the period text, or empty when no dates are given.
 */
export function periodText(start: string | undefined, end: string | undefined): string {
  if (start === undefined || end === undefined) return ''
  const dot = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number)
    return `${String(y)}.${String(m)}.${String(d)}`
  }
  return `${dot(start)}-${dot(end)}`
}

/**
 * Summary of a fee receipt.
 * @param input - fee, period, shop, merchant.
 * @returns e.g. `收到商户租金2026.4.1-2026.4.30-5F-5008&邓家顺`.
 */
export function feeSummary(input: FeeSummaryInput): string {
  const period = periodText(input.periodStart, input.periodEnd)
  return `收到商户${FEE_RULES[input.feeType].label}${period}-${input.shopNo}&${input.merchantName}`
}

/**
 * Summary of a suspense (unclaimed) receipt.
 * @param payer - counterparty name from the bank statement.
 * @returns e.g. `收到暂收款项-张先涛`.
 */
export function suspenseSummary(payer: string): string {
  return `收到暂收款项-${payer}`
}
