import type { DatabaseSync } from 'node:sqlite'
import z from 'zod'
import { FEE_TYPE_ALIASES } from '../../rules/fee-types.ts'
import { toCents } from '../../rules/tax.ts'
import { registerParsedPayment, type RegisterResult } from './payment.ts'

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
  const fields = extractionSchema.parse(extraction)
  const payee = fields.payee?.trim()
  if (!payee) throw new Error('付款截图收款方未识别，请补充清晰截图')
  if (payee !== options.companyName.trim()) throw new Error('付款截图收款方不是配置的公司主体')
  const amountText = fields.amountText.trim()
  if (!/^[¥￥]?\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?\s*元?$/u.test(amountText)) {
    throw new Error('付款截图金额格式无法确认')
  }
  const amount = toCents(amountText)
  if (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('付款截图需要正数金额')
  const date = fields.paymentDate?.trim()
  if (!date || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/u.test(date)) {
    throw new Error('付款截图支付时间未识别，请补充日期和时间')
  }
  const datePart = date.slice(0, 10)
  const timestamp = Date.parse(datePart + 'T00:00:00Z')
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== datePart
    || (date.length > 10 && (Number(date.slice(11, 13)) > 23 || Number(date.slice(14, 16)) > 59
      || (date.length > 16 && Number(date.slice(17, 19)) > 59)))) throw new Error('付款截图支付时间无效')
  const feeType = FEE_TYPE_ALIASES.find(([alias]) => alias === fields.feeText?.trim())?.[1]
  return registerParsedPayment(db, {
    amount, date, merchant: fields.merchantText?.trim() ?? '', feeType, txnNo: fields.transactionNo?.trim() ?? '',
  }, JSON.stringify(fields))
}
