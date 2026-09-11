/**
 * Daily settlement splitting. A Tenpay credit on day D pays out the WeChat
 * orders of day D−1 for the merchant account named in the bank remark
 * (`MMDD_商户号`); a UnionPay credit pays out the POS orders whose settlement
 * day falls in the remark's range (`MMDD-MMDD费x元`). When the detail rows sum
 * to the credit (to the cent), the credit becomes a `settlement` and its
 * money is represented by the linked `platform_txn` rows; otherwise it stays
 * `pending` with the difference reported for a person to look at.
 * @module @deepseek-ai/dsh-hy-finance/provider/split/settlement
 */

import type { DatabaseSync } from 'node:sqlite'
import type { TransactionId } from '../../service/identifiers.ts'
import { rowToTransaction, TRANSACTION_COLUMNS, transaction } from '../db/repo.ts'

/** Outcome for one settlement credit. */
export interface SettlementMatch {
  readonly transactionId: TransactionId
  readonly date: string
  readonly channel: 'tenpay' | 'unionpay'
  readonly account: string
  readonly amount: number
  readonly detailDays: string[]
  readonly detailRows: number
  readonly detailNet: number
  readonly matched: boolean
}

/** Result of one splitting pass. */
export interface SplitResult {
  readonly matched: SettlementMatch[]
  readonly unmatched: SettlementMatch[]
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function mmddToIso(year: string, mmdd: string): string {
  return `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`
}

/**
 * Link platform detail rows to every pending Tenpay / UnionPay credit.
 * @param db - open database.
 * @returns matched and unmatched credits.
 */
export function splitSettlements(db: DatabaseSync): SplitResult {
  const credits = (db.prepare(`SELECT ${TRANSACTION_COLUMNS} FROM "transaction" WHERE channel IN ('tenpay', 'unionpay') AND status IN ('pending', 'settlement') ORDER BY txn_time`)
    .all() as Record<string, unknown>[]).map(rowToTransaction)
  const matched: SettlementMatch[] = []
  const unmatched: SettlementMatch[] = []
  // Two UnionPay credits can share one settlement range (split by fee tier); group them.
  const groups = new Map<string, typeof credits>()
  for (const t of credits) {
    // UnionPay remarks differ only by the fee tier (`0407-0407费82.5元` / `…费53.61元`); the range is the group.
    const key = t.channel === 'tenpay' ? `t:${t.txnTime.slice(0, 10)}:${t.remark}` : `u:${/\d{4}-\d{4}/.exec(t.remark)?.[0] ?? t.remark}`
    groups.set(key, [...groups.get(key) ?? [], t])
  }
  transaction(db, () => {
    for (const group of groups.values()) {
      const first = group[0]
      if (first === undefined) continue
      const year = first.txnTime.slice(0, 4)
      let days: string[] = []
      let account = ''
      let platform: 'wechat' | 'pos'
      if (first.channel === 'tenpay') {
        platform = 'wechat'
        const m = /(\d{4})_(\d+)/.exec(first.remark)
        if (m !== null) { account = m[2] ?? ''; days = [shiftDay(mmddToIso(year, m[1] ?? ''), -1)] }
      } else {
        platform = 'pos'
        const m = /(\d{4})-(\d{4})/.exec(first.remark)
        if (m !== null) {
          let day = mmddToIso(year, m[1] ?? '')
          const end = mmddToIso(year, m[2] ?? '')
          while (day <= end) { days.push(day); day = shiftDay(day, 1) }
        } else {
          days = [shiftDay(first.txnTime.slice(0, 10), -1)]
        }
      }
      const total = group.reduce((sum, t) => sum + t.amount, 0)
      const rows = days.length === 0 ? [] : platform === 'wechat'
        ? db.prepare(`SELECT id, net FROM platform_txn WHERE platform = 'wechat' AND merchant_account = ? AND substr(txn_time, 1, 10) IN (${days.map(() => '?').join(',')}) AND (transaction_id IS NULL OR transaction_id = ?)`)
          .all(account, ...days, first.id) as { id: string; net: number }[]
        : db.prepare(`SELECT id, net FROM platform_txn WHERE platform = 'pos' AND substr(note, 1, 10) IN (${days.map(() => '?').join(',')}) AND (transaction_id IS NULL OR transaction_id = ?)`)
          .all(...days, first.id) as { id: string; net: number }[]
      const detailNet = rows.reduce((sum, r) => sum + r.net, 0)
      const ok = rows.length > 0 && detailNet === total
      const record = (t: typeof first, isMatched: boolean): SettlementMatch => ({
        transactionId: t.id, date: t.txnTime.slice(0, 10), channel: t.channel as 'tenpay' | 'unionpay', account,
        amount: t.amount, detailDays: days, detailRows: rows.length, detailNet, matched: isMatched,
      })
      if (ok) {
        const link = db.prepare('UPDATE platform_txn SET transaction_id = ? WHERE id = ?')
        for (const r of rows) link.run(first.id, r.id)
        const mark = db.prepare('UPDATE "transaction" SET status = \'settlement\', confidence = 1 WHERE id = ?')
        for (const t of group) { mark.run(t.id); matched.push(record(t, true)) }
      } else {
        for (const t of group) unmatched.push(record(t, false))
      }
    }
  })
  return { matched, unmatched }
}
