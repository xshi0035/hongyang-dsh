import type { DatabaseSync } from 'node:sqlite'
import { listMerchants } from '../db/repo.ts'
import { FEE_RULES, feeTypesFromText } from '../../rules/fee-types.ts'
import { formatCents } from '../../rules/tax.ts'
import { parsePaymentText, registerParsedPayment } from './payment.ts'

/** Preview a conversation without creating a financial transaction. */
export function previewPayment(db: DatabaseSync, text: string) {
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/gu) ?? []
  const candidates = listMerchants(db).filter(m =>
    (tokens.includes(m.shopNo.toLowerCase()) && (!/^\d+$/u.test(m.shopNo) || text.includes(`编号 ${m.shopNo}`)))
    || [m.name, m.brand].some(value => value.trim().length > 1 && text.toLowerCase().includes(value.toLowerCase())))
    .map(m => ({ shopNo: m.shopNo, name: m.name, brand: m.brand }))
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

/** Validate an exact, previously offered merchant and commit one payment. */
export function confirmPayment(db: DatabaseSync, text: string, shopNo: string) {
  const preview = previewPayment(db, text)
  const selected = preview.candidates.filter(m => m.shopNo === shopNo)
  if (!preview.ready || selected.length !== 1) throw new Error('信息不完整或编号不在候选中，请先补充商户名称并核对候选编号')
  const parsed = parsePaymentText(text)
  return registerParsedPayment(db, { ...parsed, merchant: shopNo }, text)
}
