import type { DatabaseSync } from 'node:sqlite'
import z from 'zod'
import { FEE_RULES, FEE_TYPE_ALIASES, feeTypesFromText } from '../../rules/fee-types.ts'
import { formatCents, toCents } from '../../rules/tax.ts'
import { parsePaymentText, registerParsedPayment, type ParsedPayment, type RegisterResult } from './payment.ts'

import { paymentCandidates, type PaymentPreview } from './conversation.ts'

/** Untrusted fields returned by a vision model. The provider owns conversion and validation. */
export interface PaymentImageExtraction {
  amountText: string
  paymentDate?: string | undefined
  transactionNo?: string | undefined
  payee?: string | undefined
  merchantText?: string | undefined
  feeText?: string | undefined
}

/**
 * Legal payee name used to validate payment screenshot evidence.
 */
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

/**
 * Parse model text without doing any financial conversion in the model layer.
 * @param raw - Untrusted JSON extraction text.
 * @returns Parsed evidence fields; malformed data throws.
 */
export function parsePaymentImageExtraction(raw: string): PaymentImageExtraction {
  const value = JSON.parse(raw) as unknown
  return extractionSchema.parse(value)
}

/**
 * Convert a validated extraction into the same deterministic text registration path.
 * @param db - Open finance database.
 * @param extraction - Screenshot fields validated before writes.
 * @param options - Delivery or validation settings for this operation.
 * @returns Saved receipt and allocation status.
 */
export function registerPaymentFromImage(
  db: DatabaseSync,
  extraction: PaymentImageExtraction,
  options: ImageRegistrationOptions,
): RegisterResult {
  const parsed = validateImage(extraction, options)
  return registerParsedPayment(db, parsed, JSON.stringify(extraction))
}

function validateImage(extraction: PaymentImageExtraction, options: ImageRegistrationOptions): ParsedPayment {
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
  return { amount, date, merchant: fields.merchantText?.trim() ?? '', feeType, txnNo: fields.transactionNo?.trim() ?? '' }
}

function imageDraft(
  extraction: PaymentImageExtraction, text: string, options: ImageRegistrationOptions,
): { parsed: ParsedPayment; hints: string; fees: ReturnType<typeof feeTypesFromText> } {
  const parsed = validateImage(extraction, options)
  let textAmount: number | undefined
  try { textAmount = parsePaymentText(text).amount } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('需要正数金额')) throw error
  }
  if (textAmount !== undefined && textAmount !== parsed.amount) throw new Error('文字金额与截图候选金额不一致，请取消后按笔重新发送并核对金额')
  const hints = [text, extraction.merchantText ?? ''].join('\n')
  const fees = feeTypesFromText([text, extraction.feeText ?? ''].join('\n'))
  return { parsed: { ...parsed, feeType: fees.length === 1 ? fees[0] : undefined }, hints, fees }
}

/**
 * Validate screenshot evidence and preview the combined draft without writes.
 * @param db - Open finance database.
 * @param extraction - Untrusted screenshot fields.
 * @param text - Accumulated user text, including merchant and fee hints.
 * @param options - Configured legal payee name.
 * @returns Candidates and candidate amount requiring explicit confirmation.
 */
export function previewPaymentImage(
  db: DatabaseSync, extraction: PaymentImageExtraction, text: string, options: ImageRegistrationOptions,
): PaymentPreview {
  const { parsed, hints, fees } = imageDraft(extraction, text, options)
  const fee = parsed.feeType === undefined ? '费项待补充' : FEE_RULES[parsed.feeType].label
  const warning = fees.length > 1 ? '；存在多个费项，请取消后按笔发送' : ''
  return {
    candidates: paymentCandidates(db, hints), ready: fees.length === 1,
    summary: `截图候选金额 ${formatCents(parsed.amount)} 元（请人工核对）；${fee}；日期 ${parsed.date}；收款方 ${extraction.payee?.trim() ?? ''}${warning}`,
  }
}

/**
 * Revalidate a screenshot draft and commit only an explicitly selected candidate.
 * @param db - Open finance database.
 * @param extraction - Original screenshot fields retained as evidence.
 * @param text - Accumulated user text.
 * @param shopNo - Exact shop number from the current candidates.
 * @param options - Configured legal payee name.
 * @returns Committed receipt and allocation; invalid drafts throw before writes.
 */
export function confirmPaymentImage(
  db: DatabaseSync, extraction: PaymentImageExtraction, text: string, shopNo: string, options: ImageRegistrationOptions,
): RegisterResult {
  return registerParsedPayment(db, preparePaymentImage(db, extraction, text, shopNo, options), JSON.stringify({ extraction, text }))
}

/** Validate a selected screenshot draft without writing financial rows.
 * @param db - Open finance database.
 * @param extraction - Original screenshot fields.
 * @param text - Accumulated user text.
 * @param shopNo - Selected candidate.
 * @param options - Legal payee configuration.
 * @returns Validated payment fields.
 */
export function preparePaymentImage(
  db: DatabaseSync, extraction: PaymentImageExtraction, text: string, shopNo: string, options: ImageRegistrationOptions,
): ParsedPayment {
  const preview = previewPaymentImage(db, extraction, text, options)
  if (!preview.ready || preview.candidates.filter(m => m.shopNo === shopNo).length !== 1) {
    throw new Error('信息不完整或编号不在候选中，请先补充商户名称并核对候选编号')
  }
  const { parsed } = imageDraft(extraction, text, options)
  return { ...parsed, merchant: shopNo }
}
