/** Validate human fee allocation at the workbench JSON boundary. */
import { FEE_TYPES, type FeeType } from '../../rules/fee-types.ts'
import type { Split } from '../claim/allocate.ts'

/** Human allocation and its audit reason; amounts are integer cents. */
export interface PaymentReview { splits: Split[]; reason: string }

/** Validate a real ISO calendar date.
 * @param value - Input date.
 * @returns Whether the value is an actual YYYY-MM-DD day.
 */
export function validPaymentDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Parse an explicit allocation and require the original receipt total.
 * @param value - Untrusted review JSON.
 * @param amount - Original receipt amount in cents.
 * @returns Validated splits and reason.
 */
export function parsePaymentReview(value: unknown, amount: number): PaymentReview {
  if (value === null || typeof value !== 'object' || !('reason' in value) || typeof value.reason !== 'string' || !value.reason.trim()
    || !('splits' in value) || !Array.isArray(value.splits) || value.splits.length === 0) throw new Error('请填写分配依据并添加费项')
  const splits = value.splits.map((item: unknown): Split => {
    if (item === null || typeof item !== 'object' || !('feeType' in item) || typeof item.feeType !== 'string'
      || !FEE_TYPES.includes(item.feeType as FeeType) || !('amount' in item) || typeof item.amount !== 'number'
      || !Number.isSafeInteger(item.amount) || item.amount <= 0) throw new Error('费项必须有效，金额必须为正整数分')
    const start = 'periodStart' in item ? item.periodStart : undefined
    const end = 'periodEnd' in item ? item.periodEnd : undefined
    if ((start !== undefined || end !== undefined) && (typeof start !== 'string' || typeof end !== 'string'
      || !validPaymentDay(start) || !validPaymentDay(end) || start > end)) throw new Error('账期需要完整、有效且起止顺序正确')
    return { feeType: item.feeType as FeeType, amount: item.amount,
      ...(typeof start === 'string' && typeof end === 'string' ? { periodStart: start, periodEnd: end } : {}) }
  })
  if (splits.reduce((sum, item) => sum + item.amount, 0) !== amount) throw new Error('费项拆分合计必须等于原付款金额')
  return { splits, reason: value.reason.trim() }
}
