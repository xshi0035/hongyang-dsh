import type { DatabaseSync } from 'node:sqlite'
import { registerPayment, type RegisterResult } from './payment.ts'

/** Untrusted fields returned by a vision model. The provider owns conversion and validation. */
export interface PaymentImageExtraction {
  amountText: string
  paymentDate?: string
  transactionNo?: string
  payee?: string
  merchantText?: string
  feeText?: string
}

export interface ImageRegistrationOptions {
  companyName: string
}

/** Convert a validated extraction into the same deterministic text registration path. */
export function registerPaymentFromImage(
  db: DatabaseSync,
  extraction: PaymentImageExtraction,
  options: ImageRegistrationOptions,
): RegisterResult {
  const payee = extraction.payee?.trim()
  if (payee && payee !== options.companyName) throw new Error('付款截图收款方不是配置的公司主体')
  const fields = [extraction.paymentDate, extraction.merchantText, extraction.feeText, extraction.amountText, extraction.transactionNo]
  return registerPayment(db, fields.filter((value): value is string => value !== undefined && value.trim() !== '').join(' '))
}
