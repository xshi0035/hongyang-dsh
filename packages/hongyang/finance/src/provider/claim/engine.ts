/**
 * The claim engine: decides, for every unbooked receipt, whether it can be
 * booked automatically, and keeps a queue of what a person must decide.
 *
 * Bank transfers go through the three matching layers; a top suggestion at
 * or above the automatic threshold is booked, the rest wait with their
 * suggestions. Platform details are booked by the merchant hint they carry
 * (WeChat electricity orders name the shop), parking credits and the parking
 * mini-program are booked to the parking fee without a merchant, and POS
 * orders wait for the operations desk unless their remark names a merchant.
 * @module @deepseek-ai/dsh-hy-finance/provider/claim/engine
 */

import type { DatabaseSync } from 'node:sqlite'
import { FEE_RULES, feeTypesFromText, type FeeType } from '../../rules/fee-types.ts'
import { FinanceError } from '../../service/errors.ts'
import type { MerchantId, PlatformTxnId, TransactionId } from '../../service/identifiers.ts'
import type { Allocation, AllocationOrigin, Merchant, Transaction } from '../../service/types.ts'
import { rowToTransaction, TRANSACTION_COLUMNS, transaction as inTransaction } from '../db/repo.ts'
import { allocate, describeAllocations, type Split } from './allocate.ts'
import { MerchantIndex, suggest, type Suggestion } from './match.ts'

/** Automatic booking threshold. */
export const AUTO_THRESHOLD = 0.85

/** A receipt awaiting a person, with the engine's suggestions. */
export interface PendingItem {
  /** `txn:<id>` for a bank credit, `ptx:<id>` for a platform order. */
  readonly itemId: string
  readonly kind: 'bank' | 'pos'
  readonly date: string
  readonly source: Transaction['source']
  /** Cents. */
  readonly amount: number
  readonly payerName: string
  readonly remark: string
  readonly suggestions: readonly Suggestion[]
}

/** POS orders without any remark, summarized per settlement day. */
export interface UnlabelledPos {
  readonly date: string
  readonly count: number
  /** Cents. */
  readonly amount: number
}

/** One row the engine booked without a person. */
export interface AutoBooked {
  readonly itemId: string
  readonly payerName: string
  readonly amount: number
  readonly shopNo: string
  readonly name: string
  readonly booked: string
  readonly confidence: number
}

/** Outcome of one engine run. */
export interface ClaimRunResult {
  readonly bankReviewed: number
  readonly bankAuto: number
  readonly parkingAuto: number
  readonly wechatElectricity: number
  readonly wechatParking: number
  readonly posAuto: number
  readonly pending: PendingItem[]
  readonly unlabelledPos: UnlabelledPos[]
  readonly autoBooked: AutoBooked[]
}

/** Outcome of one confirmation. */
export interface ConfirmResult {
  readonly itemId: string
  readonly merchant: Merchant | undefined
  readonly allocations: Allocation[]
  readonly booked: string
  readonly learned: boolean
}

interface PtxRow {
  id: string
  transaction_id: string | null
  platform: string
  merchant_account: string
  txn_time: string
  amount: number
  net: number
  note: string
  merchant_hint: string
  shop_no: string | null
}

function pendingBank(db: DatabaseSync): Transaction[] {
  return (db.prepare(`SELECT ${TRANSACTION_COLUMNS} FROM "transaction" WHERE status = 'pending' AND channel IN ('transfer', 'parking') ORDER BY txn_time`)
    .all() as Record<string, unknown>[]).map(rowToTransaction)
}

function unbookedDetails(db: DatabaseSync, platform: 'wechat' | 'pos'): PtxRow[] {
  return db.prepare(`SELECT p.id, p.transaction_id, p.platform, p.merchant_account, p.txn_time, p.amount, p.net, p.note, p.merchant_hint, p.shop_no
    FROM platform_txn p
    WHERE p.platform = ? AND p.merchant_account <> 'recharge' AND p.transaction_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM allocation a WHERE a.platform_txn_id = p.id)
    ORDER BY p.txn_time`).all(platform) as unknown as PtxRow[]
}

function toClaimInput(t: Transaction): { payerName: string; payerAccount: string; remark: string; amount: number; date: string } {
  return { payerName: t.payerName, payerAccount: t.payerAccount, remark: t.remark, amount: t.amount, date: t.txnTime.slice(0, 10) }
}

/** Resolve the merchant hint of a WeChat electricity order. */
function merchantForHint(index: MerchantIndex, shopNo: string | null, hint: string): Merchant | undefined {
  if (shopNo !== null) {
    const byShop = index.byShop(shopNo)
    if (byShop.length === 1) return byShop[0]
  }
  const name = hint.split('-')[0] ?? ''
  const byName = index.byName(name)
  if (byName.length === 1) return byName[0]
  if (shopNo !== null) {
    const byShop = index.byShop(shopNo)
    const intersect = byShop.filter(m => byName.includes(m))
    if (intersect.length === 1) return intersect[0]
    if (byShop.length > 0) return byShop[0]
  }
  return undefined
}

/**
 * Run the engine over everything unbooked.
 * @param db - open database.
 * @returns what was booked and what still waits.
 */
export function runClaims(db: DatabaseSync): ClaimRunResult {
  const index = MerchantIndex.load(db)
  const autoBooked: ClaimRunResult['autoBooked'] = []
  let bankAuto = 0
  let parkingAuto = 0
  let wechatElectricity = 0
  let wechatParking = 0
  let posAuto = 0
  const bank = pendingBank(db)
  inTransaction(db, () => {
    for (const t of bank) {
      if (t.channel === 'parking') {
        allocate(db, { transactionId: t.id, merchantId: undefined, amount: t.amount, wholeFee: 'parking', origin: 'engine' })
        markTransaction(db, t.id, 'auto', undefined, 1)
        parkingAuto++
        continue
      }
      const ranked = suggest(db, index, toClaimInput(t))
      const top = ranked[0]
      if (top === undefined || top.confidence < AUTO_THRESHOLD) continue
      const rows = allocate(db, {
        transactionId: t.id, merchantId: top.merchantId, amount: t.amount,
        preferFees: top.feeTypes, preferMonths: top.months, origin: 'engine',
      })
      markTransaction(db, t.id, 'auto', top.merchantId, top.confidence)
      bankAuto++
      autoBooked.push({ itemId: `txn:${t.id}`, payerName: t.payerName, amount: t.amount, shopNo: top.shopNo, name: top.name, booked: describeAllocations(rows), confidence: top.confidence })
    }
    // WeChat: 706 electricity orders → merchant by hint; 380 parking → parking fee, one line per settlement.
    const parkingBySettlement = new Map<string, number>()
    for (const p of unbookedDetails(db, 'wechat')) {
      const settlement = p.transaction_id as TransactionId
      if (p.merchant_account === '1723333380' || /停车/.test(p.note)) {
        parkingBySettlement.set(settlement, (parkingBySettlement.get(settlement) ?? 0) + p.amount)
        allocate(db, { transactionId: settlement, platformTxnId: p.id as PlatformTxnId, merchantId: undefined, amount: p.amount, wholeFee: 'parking', origin: 'engine' })
        wechatParking++
        continue
      }
      const merchant = merchantForHint(index, p.shop_no, p.merchant_hint)
      if (merchant === undefined) continue
      allocate(db, {
        transactionId: settlement, platformTxnId: p.id as PlatformTxnId, merchantId: merchant.id, amount: p.amount,
        splits: [{ feeType: 'elec_pre', amount: p.amount }], origin: 'engine',
      })
      db.prepare('UPDATE platform_txn SET merchant_id = ? WHERE id = ?').run(merchant.id, p.id)
      wechatElectricity++
    }
    // POS: a remark naming a merchant books automatically; the rest wait for the operations desk.
    for (const p of unbookedDetails(db, 'pos')) {
      const remark = p.note.split('|').slice(1).join('|')
      if (remark.trim() === '') continue
      const ranked = suggest(db, index, { payerName: '', payerAccount: '', remark, amount: p.amount, date: p.txn_time.slice(0, 10) })
      const top = ranked[0]
      if (top === undefined || top.confidence < AUTO_THRESHOLD) continue
      const rows = allocate(db, {
        transactionId: p.transaction_id as TransactionId, platformTxnId: p.id as PlatformTxnId, merchantId: top.merchantId,
        amount: p.amount, preferFees: top.feeTypes, preferMonths: top.months, origin: 'engine',
      })
      db.prepare('UPDATE platform_txn SET merchant_id = ? WHERE id = ?').run(top.merchantId, p.id)
      posAuto++
      autoBooked.push({ itemId: `ptx:${p.id}`, payerName: `POS ${remark}`, amount: p.amount, shopNo: top.shopNo, name: top.name, booked: describeAllocations(rows), confidence: top.confidence })
    }
  })
  const queue = listPending(db)
  return {
    bankReviewed: bank.length, bankAuto, parkingAuto, wechatElectricity, wechatParking, posAuto,
    pending: queue.pending, unlabelledPos: queue.unlabelledPos, autoBooked,
  }
}

function markTransaction(db: DatabaseSync, id: TransactionId, status: Transaction['status'], merchantId: MerchantId | undefined, confidence: number): void {
  db.prepare('UPDATE "transaction" SET status = ?, merchant_id = ?, confidence = ? WHERE id = ?').run(status, merchantId ?? null, confidence, id)
}

/**
 * The queue: bank transfers and remarked POS orders with suggestions, plus
 * unlabelled POS orders summarized per day.
 * @param db - open database.
 * @returns the queue.
 */
export function listPending(db: DatabaseSync): { pending: PendingItem[]; unlabelledPos: UnlabelledPos[] } {
  const index = MerchantIndex.load(db)
  const pending: PendingItem[] = []
  for (const t of pendingBank(db)) {
    pending.push({
      itemId: `txn:${t.id}`, kind: 'bank', date: t.txnTime.slice(0, 10), source: t.source, amount: t.amount,
      payerName: t.payerName, remark: t.remark, suggestions: suggest(db, index, toClaimInput(t)).slice(0, 3),
    })
  }
  const perDay = new Map<string, UnlabelledPos>()
  for (const p of unbookedDetails(db, 'pos')) {
    const [day = '', ...rest] = p.note.split('|')
    const remark = rest.join('|').trim()
    if (remark === '') {
      const prev = perDay.get(day)
      perDay.set(day, { date: day, count: (prev?.count ?? 0) + 1, amount: (prev?.amount ?? 0) + p.amount })
      continue
    }
    pending.push({
      itemId: `ptx:${p.id}`, kind: 'pos', date: p.txn_time.slice(0, 10), source: 'pos', amount: p.amount, payerName: '',
      remark, suggestions: suggest(db, index, { payerName: '', payerAccount: '', remark, amount: p.amount, date: p.txn_time.slice(0, 10) }).slice(0, 3),
    })
  }
  return { pending, unlabelledPos: [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date)) }
}

/**
 * Book one queued item to a merchant chosen by a person (or the DingTalk bridge).
 * @param db - open database.
 * @param itemId - `txn:<id>` or `ptx:<id>`.
 * @param shopNo - merchant shop number; empty books the whole amount as suspense.
 * @param splits - explicit fee splits; derived from receivables when omitted.
 * @param origin - who confirmed.
 * @returns what was booked.
 * @throws {FinanceError} `TRANSACTION_NOT_FOUND`, `MERCHANT_NOT_FOUND`, `ALREADY_ALLOCATED`, `AMOUNT_MISMATCH`.
 */
export function confirmClaim(
  db: DatabaseSync, itemId: string, shopNo: string, splits: readonly Split[] | undefined, origin: AllocationOrigin,
): ConfirmResult {
  const index = MerchantIndex.load(db)
  let merchant: Merchant | undefined
  if (shopNo.trim() !== '') {
    const found = index.byShop(shopNo)
    merchant = found.find(m => m.shopNo.toUpperCase() === shopNo.trim().toUpperCase()) ?? found[0]
    if (merchant === undefined) throw new FinanceError('MERCHANT_NOT_FOUND', `找不到铺位 ${shopNo}`)
  }
  const [kind, id = ''] = itemId.split(':')
  return inTransaction(db, () => {
    if (kind === 'txn') {
      const row = db.prepare(`SELECT ${TRANSACTION_COLUMNS} FROM "transaction" WHERE id = ?`).get(id) as Record<string, unknown> | undefined
      if (row === undefined) throw new FinanceError('TRANSACTION_NOT_FOUND', `收款 ${itemId} 不存在`)
      const t = rowToTransaction(row)
      if (t.status !== 'pending') throw new FinanceError('ALREADY_ALLOCATED', `收款 ${itemId} 已经认领过`)
      const hintFees = feeTypesFromText(t.remark)
      const rows = allocate(db, {
        transactionId: t.id, merchantId: merchant?.id, amount: t.amount, splits,
        preferFees: hintFees, origin, wholeFee: t.channel === 'parking' ? 'parking' : 'unclaimed',
      })
      markTransaction(db, t.id, 'manual', merchant?.id, 1)
      let learned = false
      if (merchant !== undefined && t.payerName.trim() !== '') {
        db.prepare(`INSERT INTO payer_mapping (payer_name, payer_account, merchant_id, confirmed, learned_at) VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(payer_name, payer_account) DO UPDATE SET merchant_id = excluded.merchant_id, confirmed = 1, learned_at = excluded.learned_at`)
          .run(t.payerName, t.payerAccount, merchant.id, new Date().toISOString())
        learned = true
      }
      return { itemId, merchant, allocations: rows, booked: describeAllocations(rows), learned }
    }
    if (kind === 'ptx') {
      const p = db.prepare('SELECT id, transaction_id, platform, merchant_account, txn_time, amount, net, note, merchant_hint, shop_no FROM platform_txn WHERE id = ?')
        .get(id) as unknown as PtxRow | undefined
      if (p === undefined || p.transaction_id === null) throw new FinanceError('TRANSACTION_NOT_FOUND', `明细 ${itemId} 不存在或尚未对上日结`)
      const already = db.prepare('SELECT 1 FROM allocation WHERE platform_txn_id = ?').get(p.id)
      if (already !== undefined) throw new FinanceError('ALREADY_ALLOCATED', `明细 ${itemId} 已经认领过`)
      const remark = p.note.split('|').slice(1).join('|')
      const rows = allocate(db, {
        transactionId: p.transaction_id as TransactionId, platformTxnId: p.id as PlatformTxnId, merchantId: merchant?.id,
        amount: p.amount, splits, preferFees: feeTypesFromText(remark), origin,
      })
      if (merchant !== undefined) db.prepare('UPDATE platform_txn SET merchant_id = ? WHERE id = ?').run(merchant.id, p.id)
      return { itemId, merchant, allocations: rows, booked: describeAllocations(rows), learned: false }
    }
    throw new FinanceError('INVALID_INPUT', `无法识别的条目 ${itemId}`)
  })
}

/**
 * Remember that a payer belongs to a merchant, without booking anything.
 * @param db - open database.
 * @param payerName - bank counterparty name.
 * @param shopNo - merchant shop number.
 * @returns the merchant.
 */
export function learnPayer(db: DatabaseSync, payerName: string, shopNo: string): Merchant {
  const merchant = MerchantIndex.load(db).byShop(shopNo)[0]
  if (merchant === undefined) throw new FinanceError('MERCHANT_NOT_FOUND', `找不到铺位 ${shopNo}`)
  db.prepare(`INSERT INTO payer_mapping (payer_name, payer_account, merchant_id, confirmed, learned_at) VALUES (?, '', ?, 1, ?)
    ON CONFLICT(payer_name, payer_account) DO UPDATE SET merchant_id = excluded.merchant_id, confirmed = 1, learned_at = excluded.learned_at`)
    .run(payerName, merchant.id, new Date().toISOString())
  return merchant
}

/**
 * Chinese label of a fee type, for tool text.
 * @param fee - Supported finance fee type.
 * @returns The configured fee label.
 */
export function feeLabel(fee: FeeType): string {
  return FEE_RULES[fee].label
}
