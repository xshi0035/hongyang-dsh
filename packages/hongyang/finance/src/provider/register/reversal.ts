/** Reverse local payment registration with linked negative entries, preserving the original evidence. */
import type { DatabaseSync } from 'node:sqlite'
import { newId, type TransactionId } from '../../service/identifiers.ts'
import type { ActivityActor } from '../../service/types.ts'
import { transaction } from '../db/repo.ts'
import { recordActivity } from '../activity/log.ts'
import { validPaymentDay } from './review.ts'

/** Explicit reversal date, reason and reviewed allocation version. */
export interface PaymentReversalInput {
  transactionId: TransactionId
  date: string
  reason: string
  allocationIds: string[]
}

/** Workbench row for a booked DingTalk payment, including its reversal or drafting restriction. */
export interface ReversiblePayment {
  transactionId: TransactionId
  date: string
  shopNo: string
  merchantName: string
  amount: number
  allocationIds: string[]
  reversed: boolean
  reversalDate: string | undefined
  blocked: boolean
}

/** List booked DingTalk payments on their payment day, retaining reversed originals.
 * @param db - Finance database.
 * @param date - Original payment date.
 * @returns Original payments and current reversal eligibility.
 */
export function reversiblePayments(db: DatabaseSync, date: string): ReversiblePayment[] {
  const rows = db.prepare(`SELECT t.id,t.txn_time,t.amount,m.shop_no,m.name,r.effective_date
    FROM "transaction" t LEFT JOIN merchant m ON m.id=t.merchant_id
    LEFT JOIN payment_reversal r ON r.original_id=t.id
    WHERE t.source='dingtalk' AND t.amount>0 AND t.status='manual' AND substr(t.txn_time,1,10)=?
    ORDER BY t.rowid DESC`).all(date) as { id: string; txn_time: string; amount: number; shop_no: string; name: string; effective_date: string | null }[]
  return rows.map((row) => {
    const allocations = db.prepare('SELECT id,merchant_id FROM allocation WHERE transaction_id=? ORDER BY id').all(row.id)
    const blocked = allocations.some(a => db.prepare('SELECT 1 FROM voucher_receipt WHERE receipt_id=?').get(`${row.id}|${String(a.merchant_id ?? '')}`) !== undefined)
    return { transactionId: row.id as TransactionId, date: row.txn_time, shopNo: row.shop_no, merchantName: row.name, amount: row.amount,
      allocationIds: allocations.map(a => String(a.id)), reversed: row.effective_date !== null,
      reversalDate: row.effective_date ?? undefined, blocked,
    }
  })
}

/** Append a single full reversal; never delete the payment or silently undo a voucher draft.
 * @param db - Finance database.
 * @param input - Original payment, effective day, reviewed allocations and explanation.
 * @param actor - Workbench reviewer.
 * @returns The linked negative transaction; identical retries return the original result.
 */
export function reversePayment(db: DatabaseSync, input: PaymentReversalInput, actor: ActivityActor): TransactionId {
  if (!validPaymentDay(input.date) || !input.reason.trim()) throw new Error('请填写有效冲正日期和原因')
  return transaction(db, () => {
    const request = JSON.stringify(input)
    const prior = db.prepare('SELECT reversal_id,request_json FROM payment_reversal WHERE original_id=?').get(input.transactionId)
    if (prior !== undefined) {
      if (prior.request_json !== request) throw new Error('该付款已冲正，请刷新查看原冲正记录')
      return String(prior.reversal_id) as TransactionId
    }
    const original = db.prepare('SELECT * FROM "transaction" WHERE id=? AND source=\'dingtalk\' AND amount>0 AND status=\'manual\'').get(input.transactionId) as { txn_time: string; amount: number; payer_name: string; merchant_id: string | null } | undefined
    if (original === undefined) throw new Error('仅支持已入账的钉钉付款登记冲正')
    if (input.date < original.txn_time.slice(0, 10)) throw new Error('冲正日期不能早于原付款日期')
    const before = db.prepare('SELECT * FROM allocation WHERE transaction_id=? ORDER BY id').all(input.transactionId) as { id: string; platform_txn_id: string | null; merchant_id: string | null; receivable_id: string | null; fee_type: string; period_start: string | null; period_end: string | null; amount_incl_tax: number; tax_rate: number; tax_amount: number }[]
    if (before.length === 0 || before.some(a => a.platform_txn_id !== null)
      || before.reduce((sum, a) => sum + a.amount_incl_tax, 0) !== original.amount) throw new Error('原付款分配不完整，请先核对')
    if (JSON.stringify(before.map(a => a.id)) !== JSON.stringify([...input.allocationIds].sort())) throw new Error('分配已变化，请刷新后重新核对')
    if (before.some(a => db.prepare('SELECT 1 FROM voucher_receipt WHERE receipt_id=?').get(`${input.transactionId}|${a.merchant_id ?? ''}`) !== undefined)) throw new Error('原付款已有凭证草稿，请先填写原因撤回草稿')
    const id = newId('txn')
    const at = new Date().toISOString()
    db.prepare(`INSERT INTO "transaction"(id,source,channel,txn_time,amount,payer_name,remark,parent_id,status,merchant_id,raw)
      VALUES(?,'dingtalk','transfer',?,?,?,?,?,'manual',?,?)`).run(id, input.date, -original.amount, original.payer_name,
      `冲正 ${input.transactionId}；${input.reason}`, input.transactionId, original.merchant_id, JSON.stringify({ original: input.transactionId, reason: input.reason }))
    const insert = db.prepare(`INSERT INTO allocation(id,transaction_id,merchant_id,receivable_id,fee_type,period_start,period_end,amount_incl_tax,tax_rate,tax_amount,origin,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'user',?)`)
    for (const row of before) insert.run(newId('alc'), id, row.merchant_id, row.receivable_id, row.fee_type,
      row.period_start, row.period_end, -row.amount_incl_tax, row.tax_rate, -row.tax_amount, at)
    db.prepare('INSERT INTO payment_reversal(original_id,reversal_id,request_json,reason,effective_date,created_at) VALUES(?,?,?,?,?,?)')
      .run(input.transactionId, id, request, input.reason.trim(), input.date, at)
    recordActivity(db, { actor, action: 'reverse_payment', target: input.transactionId, amount: -original.amount,
      detail: `付款登记已冲正，原单保留；冲正日期 ${input.date}；负数流水 ${id}；原因：${input.reason}` })
    return id
  })
}
