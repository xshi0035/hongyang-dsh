import type { DatabaseSync } from 'node:sqlite'
import z from 'zod'
import { registerPayment, type RegisterResult } from './payment.ts'

/** Untrusted fields returned by a vision model. The provider owns conversion and validation. */
export interface PaymentImageExtraction {
  amountText: string
  paymentDate?: string | undefined
  transactionNo?: string | undefined
  payee?: string | undefined
  merchantText?: string | undefined
  feeText?: string | undefined
}

export interface ImageRegistrationOptions {
  companyName: string
}

const extractionSchema = z.object({
  amountText: z.string().min(1),
  paymentDate: z.string().optional(),
  transactionNo: z.string().optional(),
  payee: z.string().optional(),
  merchantText: z.string().optional(),
  feeText: z.string().optional(),
})

/** Parse model text without doing any financial conversion in the model layer. */
export function parsePaymentImageExtraction(raw: string): PaymentImageExtraction {
  const value = JSON.parse(raw) as unknown
  return extractionSchema.parse(value)
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
