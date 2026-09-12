import type { DatabaseSync } from 'node:sqlite'
import { FEE_RULES, FEE_TYPE_ALIASES, type FeeType } from '../../rules/fee-types.ts'
import { formatCents, toCents } from '../../rules/tax.ts'
import { newId, type MerchantId, type TransactionId } from '../../service/identifiers.ts'
import { listMerchants, transaction } from '../db/repo.ts'
import { allocate } from '../claim/allocate.ts'

export interface ParsedPayment {
  readonly amount: number
  readonly date: string
  readonly merchant: string
  readonly feeType: FeeType | undefined
  readonly txnNo: string
}
export interface RegisterResult {
  readonly transactionId: TransactionId
  readonly parsed: ParsedPayment
  readonly merchantShopNo: string | undefined
  readonly merchantName: string | undefined
  readonly booked: boolean
  readonly pending: boolean
}

function dateOf(text: string): string {
  const match = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/)
  if (match === null) return new Date().toISOString().slice(0, 10)
  const [, year, month, day] = match
  return [year ?? '', month?.padStart(2, '0') ?? '', day?.padStart(2, '0') ?? ''].join('-')
}
function amountOf(text: string): number {
  const match = text.match(/(?:¥|￥)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:元|块)/)
    ?? text.match(/(?:金额|收款)[：:\s]*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
  const amount = toCents(match?.[1] ?? '')
  if (amount === undefined || amount <= 0) throw new Error('付款登记需要正数金额，例如“电费 500 元”')
  return amount
}
function feeOf(text: string): FeeType | undefined {
  return [...FEE_TYPE_ALIASES].sort((a, b) => b[0].length - a[0].length).find(([alias]) => text.includes(alias))?.[1]
}
function merchantOf(text: string, fee: FeeType | undefined): string {
  const withoutDate = text.replace(/20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[日]*/, '').replace(/(?:¥|￥)?[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*(?:元|块)/, '')
  const withoutReference = withoutDate.replace(/(?:交易|订单)?单号[：:\s]*[A-Za-z0-9_-]+/, '')
  const aliases = FEE_TYPE_ALIASES.filter(([, type]) => type === fee).map(([alias]) => alias)
  const withoutFee = aliases.reduce((value, alias) => value.replace(alias, ''), withoutReference)
  return withoutFee.replace(/收款|付款|收到|支付|金额[：:\s]*/g, '').trim().replace(/[，,。；;]+$/, '')
}
function findMerchant(db: DatabaseSync, text: string): { id: MerchantId; shopNo: string; name: string } | undefined {
  const needle = text.trim()
  if (needle === '') return undefined
  const merchants = listMerchants(db)
  const found = merchants.find(m => needle.includes(m.shopNo) || needle.includes(m.name)
    || (m.brand.length > 1 && needle.includes(m.brand)))
  return found === undefined ? undefined : { id: found.id, shopNo: found.shopNo, name: found.name }
}

export function parsePaymentText(text: string): ParsedPayment {
  const feeType = feeOf(text)
  const amount = amountOf(text)
  return { amount, date: dateOf(text), merchant: merchantOf(text, feeType), feeType, txnNo: text.match(/(?:单号|订单号|交易号)[：:\s]*([A-Za-z0-9_-]+)/)?.[1] ?? '' }
}

export function registerPayment(db: DatabaseSync, text: string): RegisterResult {
  const parsed = parsePaymentText(text)
  return registerParsedPayment(db, parsed, text)
}

/**
 * Save an already parsed payment atomically with its allocation.
 * @param db - finance database owned by the service.
 * @param parsed - provider-validated payment fields.
 * @param evidence - original text or structured extraction for review.
 * @returns saved receipt and allocation status.
 */
export function registerParsedPayment(db: DatabaseSync, parsed: ParsedPayment, evidence: string): RegisterResult {
  return transaction(db, () => {
    const merchant = findMerchant(db, parsed.merchant)
    const id = newId<TransactionId>('txn')
    db.prepare('INSERT INTO "transaction" (id,source,channel,txn_time,amount,payer_name,remark,txn_no,status,confidence,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, 'dingtalk', 'transfer', parsed.date, parsed.amount, parsed.merchant, evidence, parsed.txnNo, 'pending', merchant === undefined ? 0 : 0.9, evidence)
    if (merchant !== undefined && parsed.feeType !== undefined) {
      allocate(db, { transactionId: id, merchantId: merchant.id, amount: parsed.amount, splits: [{ feeType: parsed.feeType, amount: parsed.amount }], origin: 'dingtalk' })
      db.prepare('UPDATE "transaction" SET status=?,merchant_id=? WHERE id=?').run('manual', merchant.id, id)
    }
    return {
      transactionId: id, parsed, merchantShopNo: merchant?.shopNo, merchantName: merchant?.name,
      booked: merchant !== undefined && parsed.feeType !== undefined,
      pending: merchant === undefined || parsed.feeType === undefined,
    }
  })
}

/**
 * Format a committed registration for the web and DingTalk consumers.
 * @param result - provider result; amounts are integer cents.
 * @returns user-visible registration or pending-review message.
 */
export function registrationSummary(result: RegisterResult): string {
  const amount = formatCents(result.parsed.amount)
  if (!result.booked) return `已记录 ${amount} 元，请补充商户名和费项后确认。`
  const fee = result.parsed.feeType === undefined ? '' : FEE_RULES[result.parsed.feeType].label
  return `已登记：${result.merchantShopNo ?? ''} ${result.merchantName ?? ''} ${fee} ${amount} 元。`
}
