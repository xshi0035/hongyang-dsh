/**
 * Merchant matching for one receipt: who paid, and for what. Three layers,
 * each yielding scored suggestions the engine ranks:
 *
 * 1. exact — a confirmed payer mapping, or the payer name equal to a merchant's
 *    contracting party or brand after company-suffix normalization;
 * 2. remark — a brand, merchant name, or shop number mentioned in the bank
 *    remark, plus the fee types and months it names;
 * 3. amount — the amount equal (±1 yuan) to a merchant's unpaid receivable.
 *
 * Nothing here writes; the engine decides what to book.
 * @module @deepseek-ai/dsh-hy-finance/provider/claim/match
 */

import type { DatabaseSync } from 'node:sqlite'
import { feeTypesFromText, type FeeType } from '../../rules/fee-types.ts'
import type { MerchantId } from '../../service/identifiers.ts'
import type { Merchant } from '../../service/types.ts'
import { listMerchants } from '../db/repo.ts'

/** One ranked candidate merchant for a receipt. */
export interface Suggestion {
  readonly merchantId: MerchantId
  readonly shopNo: string
  readonly name: string
  readonly brand: string
  /** 0..1; ≥ 0.85 is booked automatically. */
  readonly confidence: number
  /** Why, in the finance clerk's words. */
  readonly reason: string
  /** Fee types the remark named, in order of appearance. */
  readonly feeTypes: readonly FeeType[]
  /** Months the remark named as ISO `YYYY-MM`. */
  readonly months: readonly string[]
}

/** What matching needs to know about one receipt. */
export interface ClaimInput {
  readonly payerName: string
  readonly payerAccount: string
  readonly remark: string
  /** Cents. */
  readonly amount: number
  /** ISO date of the receipt, for resolving `5-6月` to a year. */
  readonly date: string
}

/** Company-form suffixes and decorations that never distinguish two payers. */
const SUFFIXES = /（个体工商户）|\(个体工商户\)|个体工商户|股份有限公司|有限责任公司|有限公司|公司|\s+/g

/**
 * Normalize a party name for equality: strip company suffixes, brackets, and whitespace.
 * @param name - raw name.
 * @returns the comparison key; empty when nothing remains.
 */
export function nameKey(name: string): string {
  return name.replace(SUFFIXES, '').replace(/[()（）·・]/g, '').trim()
}

/** Generic tails a brand carries in the sheet but people drop in remarks and chat. */
const BRAND_TAILS = /(亲子乐园|乐园|专柜|柜台|专卖店|旗舰店|体验店|门店|餐厅|火锅|烧烤|超市|便利店|店|馆)$/

/**
 * Text forms under which a merchant may be mentioned: the brand and name as
 * written, without generic tails, and without 的 (人们写“愤怒弹珠”，表里是“愤怒的弹珠”).
 * Keys shorter than two characters are dropped.
 */
function mentionKeys(m: Merchant): string[] {
  const keys = new Set<string>()
  for (const raw of [m.brand, m.name]) {
    const text = raw.trim()
    if (text.length === 0) continue
    for (const form of [text, text.replace(BRAND_TAILS, ''), text.replace(/的/g, ''), text.replace(BRAND_TAILS, '').replace(/的/g, '')]) {
      if (form.length >= 2) keys.add(form)
    }
  }
  return [...keys]
}

/** Merchant lookups prepared once per run. */
export class MerchantIndex {
  readonly merchants: readonly Merchant[]
  private readonly byKey = new Map<string, Merchant[]>()
  private readonly mentionables: { text: string; merchant: Merchant }[] = []

  constructor(merchants: readonly Merchant[]) {
    this.merchants = merchants
    for (const m of merchants) {
      for (const key of new Set([nameKey(m.name), nameKey(m.brand)])) {
        if (key.length < 2) continue
        this.byKey.set(key, [...this.byKey.get(key) ?? [], m])
      }
      for (const text of mentionKeys(m)) this.mentionables.push({ text, merchant: m })
    }
    // Longest mention first so `开心哈乐` wins over `哈乐`.
    this.mentionables.sort((a, b) => b.text.length - a.text.length)
  }

  /** Load every merchant from the database. */
  static load(db: DatabaseSync): MerchantIndex {
    return new MerchantIndex(listMerchants(db))
  }

  /** Merchants whose name or brand equals the key. */
  byName(name: string): Merchant[] {
    return this.byKey.get(nameKey(name)) ?? []
  }

  /** Merchants whose shop number equals, or ends with, `-<shopNo>` / `<shopNo>`. */
  byShop(shopNo: string): Merchant[] {
    const wantedAll = shopNo.trim().toUpperCase()
    if (wantedAll.length === 0) return []
    const wantedParts = wantedAll.split(/[,，、;；]/).map(p => p.trim()).filter(p => p.length > 0)
    return this.merchants.filter((m) => {
      const full = m.shopNo.toUpperCase()
      if (full === wantedAll) return true
      const parts = full.split(/[,，、]/).map(p => p.trim())
      return wantedParts.every(w => parts.some(p => p === w || p.endsWith(`-${w}`) || p.replace(/^\d+F-/, '') === w))
    })
  }

  /** Merchants whose brand or name appears inside free text, longest mention first, each merchant once. */
  mentionedIn(text: string): { merchant: Merchant; mention: string }[] {
    const hits: { merchant: Merchant; mention: string }[] = []
    let scan = text.replace(/的/g, '')
    for (const { text: mention, merchant } of this.mentionables) {
      const index = scan.indexOf(mention)
      if (index < 0 || hits.some(h => h.merchant.id === merchant.id)) continue
      hits.push({ merchant, mention })
      scan = scan.slice(0, index) + ' '.repeat(mention.length) + scan.slice(index + mention.length)
    }
    return hits
  }

  /** Shop numbers that look like `5002A` / `B1-1003` / `3F-3026` inside free text. */
  shopsMentionedIn(text: string): Merchant[] {
    const out: Merchant[] = []
    for (const m of text.matchAll(/\b([A-Z]?\d{1,2}F?-?\d{3,4}[A-Z]{0,2})\b/gi)) {
      for (const merchant of this.byShop(m[1] ?? '')) if (!out.includes(merchant)) out.push(merchant)
    }
    return out
  }
}

/**
 * Months named in a remark: `5-6月`, `4月`, `2026年4月`; resolved against the receipt's year.
 * @param remark - free text.
 * @param date - ISO receipt date.
 * @returns ISO `YYYY-MM` list.
 */
export function monthsInRemark(remark: string, date: string): string[] {
  const year = date.slice(0, 4)
  const out = new Set<string>()
  for (const m of remark.matchAll(/(?:(\d{4})年)?(\d{1,2})(?:[-–~至](\d{1,2}))?月/g)) {
    const y = m[1] ?? year
    const from = Number(m[2])
    const to = Number(m[3] ?? m[2])
    for (let month = from; month <= to && month <= 12; month++) out.add(`${y}-${String(month).padStart(2, '0')}`)
  }
  return [...out]
}

/** Payer mapping lookup. */
export function mappedMerchant(
  db: DatabaseSync, payerName: string, payerAccount: string,
): { merchantId: MerchantId; confirmed: boolean } | undefined {
  const row = db.prepare(`SELECT merchant_id, confirmed FROM payer_mapping
    WHERE payer_name = ? AND (payer_account = ? OR payer_account = '') ORDER BY confirmed DESC, payer_account DESC LIMIT 1`)
    .get(payerName, payerAccount) as { merchant_id: string; confirmed: number } | undefined
  return row === undefined ? undefined : { merchantId: row.merchant_id as MerchantId, confirmed: row.confirmed === 1 }
}

/** Merchants with an unpaid receivable equal to the amount within one yuan. */
function byUnpaidAmount(db: DatabaseSync, amount: number): { merchantId: MerchantId; feeType: FeeType; period: string }[] {
  return (db.prepare('SELECT merchant_id, fee_type, period FROM receivable WHERE amount_unpaid BETWEEN ? AND ? ORDER BY period')
    .all(amount - 100, amount + 100) as { merchant_id: string; fee_type: string; period: string }[])
    .map(r => ({ merchantId: r.merchant_id as MerchantId, feeType: r.fee_type as FeeType, period: r.period }))
}

/**
 * Rank candidate merchants for one receipt.
 * @param db - open database (payer mappings and receivables).
 * @param index - merchant index.
 * @param input - the receipt.
 * @returns suggestions, best first; empty when nothing matched.
 */
export function suggest(db: DatabaseSync, index: MerchantIndex, input: ClaimInput): Suggestion[] {
  const feeTypes = feeTypesFromText(input.remark)
  const months = monthsInRemark(input.remark, input.date)
  const found = new Map<MerchantId, Suggestion>()
  const add = (m: Merchant, confidence: number, reason: string): void => {
    const prev = found.get(m.id)
    if (prev !== undefined && prev.confidence >= confidence) return
    found.set(m.id, { merchantId: m.id, shopNo: m.shopNo, name: m.name, brand: m.brand, confidence, reason, feeTypes, months })
  }
  const merchantById = new Map(index.merchants.map(m => [m.id, m]))

  // 1. exact
  const mapped = mappedMerchant(db, input.payerName, input.payerAccount)
  if (mapped !== undefined) {
    const m = merchantById.get(mapped.merchantId)
    if (m !== undefined) add(m, mapped.confirmed ? 1 : 0.9, mapped.confirmed ? '付款人映射（已确认）' : '付款人映射（历史）')
  }
  const exact = index.byName(input.payerName)
  if (exact.length === 1 && exact[0] !== undefined) add(exact[0], 0.95, '对方户名与商户名一致')
  else for (const m of exact) add(m, 0.7, '对方户名与商户名一致，但多个铺位同名')

  // 2. remark
  const mentioned = index.mentionedIn(input.remark)
  const shops = index.shopsMentionedIn(input.remark)
  for (const m of shops) add(m, 0.9, '备注写明铺位号')
  if (mentioned.length === 1 && mentioned[0] !== undefined) {
    add(mentioned[0].merchant, feeTypes.length > 0 ? 0.88 : 0.8, `备注提到“${mentioned[0].mention}”`)
  } else {
    for (const { merchant, mention } of mentioned) add(merchant, 0.6, `备注提到“${mention}”`)
  }

  // 3. amount
  const unpaid = byUnpaidAmount(db, input.amount)
  const distinct = [...new Map(unpaid.map(u => [u.merchantId, u])).values()]
  for (const u of distinct) {
    const m = merchantById.get(u.merchantId)
    if (m === undefined) continue
    const prev = found.get(m.id)
    if (prev !== undefined) {
      // Amount agreement strengthens an existing candidate.
      found.set(m.id, { ...prev, confidence: Math.min(1, prev.confidence + 0.1), reason: `${prev.reason}；金额等于其${u.period.slice(0, 7)}未收` })
    } else if (distinct.length <= 3) {
      add(m, 0.6, `金额等于其 ${u.period.slice(0, 7)} 未收（${u.feeType}）`)
    }
  }
  return [...found.values()].sort((a, b) => b.confidence - a.confidence)
}
