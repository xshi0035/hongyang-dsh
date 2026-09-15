import type { DatabaseSync } from 'node:sqlite'
import { listMerchants } from '../db/repo.ts'
import { FEE_RULES, feeTypesFromText } from '../../rules/fee-types.ts'
import { formatCents } from '../../rules/tax.ts'
import { parsePaymentText, registerParsedPayment, type ParsedPayment, type RegisterResult } from './payment.ts'

/** Merchant candidates and payment completeness without any database writes. */
export interface PaymentPreview {
  candidates: { shopNo: string; name: string; brand: string }[]
  summary: string
  ready: boolean
}

/**
 * Preview a conversation without creating a financial transaction.
 * @param db - Open finance database.
 * @param text - User payment text or accumulated conversation draft.
 * @returns Merchant candidates, summary, and amount/fee readiness.
 */
export function previewPayment(db: DatabaseSync, text: string): PaymentPreview {
  const candidates = paymentCandidates(db, text)
  return previewFields(candidates, text)
}

/**
 * Find merchant candidates only in the supplied merchant hints.
 * @param db - Open finance database.
 * @param text - Merchant hints to match against shop numbers, names and brands.
 * @returns Matching merchant candidates without writes.
 */
export function paymentCandidates(db: DatabaseSync, text: string): PaymentPreview['candidates'] {
  const tokens: string[] = text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/gu) ?? []
  const query = text.toLowerCase()
  return listMerchants(db).filter(m =>
    (tokens.includes(m.shopNo.toLowerCase()) && (!/^\d+$/u.test(m.shopNo) || text.includes(`编号 ${m.shopNo}`)))
    || [m.name, ...m.brand.split(/[\/,、|；;]+/u)].some(value => value.trim().length > 1 && query.includes(value.trim().toLowerCase())))
    .map(m => ({ shopNo: m.shopNo, name: m.name, brand: m.brand }))
}

function previewFields(candidates: PaymentPreview['candidates'], text: string): PaymentPreview {
  let summary = '金额待补充'
  let ready = false
  try {
    const parsed = parsePaymentText(text)
    const fees = feeTypesFromText(text)
    summary = `${formatCents(parsed.amount)} 元；${parsed.feeType === undefined ? '费项待补充' : FEE_RULES[parsed.feeType].label}；日期 ${parsed.date}`
    ready = fees.length === 1
    if (fees.length > 1) summary += '；存在多个费项，请取消后按笔发送'
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('需要正数金额')) throw error
  }
  return { candidates, summary, ready }
}

/**
 * Validate an exact, previously offered merchant and commit one payment.
 * @param db - Open finance database.
 * @param text - User payment text or accumulated conversation draft.
 * @param shopNo - Selected shop number.
 * @returns Saved receipt and allocation status; invalid selection throws.
 */
export function confirmPayment(db: DatabaseSync, text: string, shopNo: string): RegisterResult {
  return registerParsedPayment(db, preparePayment(db, text, shopNo), text)
}

/** Validate a selected text draft without writing financial rows.
 * @param db - Open finance database.
 * @param text - Accumulated draft text.
 * @param shopNo - Selected candidate.
 * @returns Validated fields with the exact shop number.
 */
export function preparePayment(db: DatabaseSync, text: string, shopNo: string): ParsedPayment {
  const preview = previewPayment(db, text)
  const selected = preview.candidates.filter(m => m.shopNo === shopNo)
  if (!preview.ready || selected.length !== 1) throw new Error('信息不完整或编号不在候选中，请先补充商户名称并核对候选编号')
  const parsed = parsePaymentText(text)
  return { ...parsed, merchant: shopNo }
}
