import type { DatabaseSync } from 'node:sqlite'
import { FEE_RULES, FEE_TYPE_ALIASES, type FeeType } from '../../rules/fee-types.ts'
import { formatCents, toCents } from '../../rules/tax.ts'
import { newId, type MerchantId, type TransactionId } from '../../service/identifiers.ts'
import { listMerchants, transaction } from '../db/repo.ts'
import { allocate } from '../claim/allocate.ts'

/**
 * Parsed payment fields; amount is integer cents and fee may need clarification.
 */
export interface ParsedPayment {
  readonly amount: number
  readonly date: string
  readonly merchant: string
  readonly feeType: FeeType | undefined
  readonly txnNo: string
}
/**
 * Saved payment identity and its booked or pending allocation status.
 */
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
function chineseAmount(text: string): string | undefined {
  const hit = text.match(/([零〇一二两三四五六七八九十百千万点]+)元/u)?.[1]
  if (!hit) return undefined
  const digit: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  let total = 0; let section = 0; let number = 0
  for (const ch of hit) { if (digit[ch] !== undefined) number = digit[ch] ?? 0; else if (ch === '十' || ch === '百' || ch === '千' || ch === '万') { const unit = ({ 十: 10, 百: 100, 千: 1000, 万: 10000 } as Record<string, number>)[ch] ?? 1; if (unit === 10000) { total += (section + number) * unit; section = 0; number = 0 } else { section += (number || 1) * unit; number = 0 } } else if (ch === '点') return `${total + section + number}.0` }
  return String(total + section + number)
}
function amountOf(text: string): number {
  const values = [...text.matchAll(/(?<![\d.\-])(?:¥|￥)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:元|块)/gu)].map(match => match[1] ?? '')
  if (values.length === 0) { const labels = ['金额', '收款', ...FEE_TYPE_ALIASES.map(([alias]) => alias)].join('|'); const pattern = new RegExp(`(?:${labels})[：:\\s]*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)(?=$|[\\s，,。；;])`, 'gu'); values.push(...[...text.matchAll(pattern)].map(match => match[1] ?? '')) }
  if (values.length === 0) { const chinese = chineseAmount(text); if (chinese) values.push(chinese) }
  if (values.length > 1) throw new Error('检测到多个金额，请取消当前草稿后按每笔付款分别发送')
  const amount = toCents(values[0] ?? '')
  if (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('付款登记需要正数金额，例如“电费 500 元”')
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
  const exact = merchants.filter(m => m.shopNo === needle)
  if (exact.length === 1) return exact[0]
  const found = merchants.find(m => needle.includes(m.shopNo) || needle.includes(m.name)
    || (m.brand.length > 1 && needle.includes(m.brand)))
  return found === undefined ? undefined : { id: found.id, shopNo: found.shopNo, name: found.name }
}

/**
 * Parse one payment, rejecting absent, invalid, or multiple amounts.
 * @param text - User payment text or accumulated conversation draft.
 * @returns Parsed amount, date, merchant, fee, and transaction reference.
 */
export function parsePaymentText(text: string): ParsedPayment {
  const feeType = feeOf(text)
  const amount = amountOf(text)
  return { amount, date: dateOf(text), merchant: merchantOf(text, feeType), feeType, txnNo: text.match(/(?:单号|订单号|交易号)[：:\s]*([A-Za-z0-9_-]+)/)?.[1] ?? '' }
}

/**
 * Parse and save a payment, allocating when merchant and fee resolve.
 * @param db - Open finance database.
 * @param text - User payment text or accumulated conversation draft.
 * @returns Saved receipt and allocation status.
 */
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
    const id = newId('txn')
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
