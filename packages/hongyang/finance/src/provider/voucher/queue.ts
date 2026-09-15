/** Durable receipt selection for voucher drafts; unselected and unclaimed money stays visible. */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '../db/repo.ts'
import { recordActivity } from '../activity/log.ts'
import { readDailyReport, type ReportRow } from '../report/daily-report.ts'
import { receiptDate } from '../report/receipt-date.ts'
import { buildVoucher, selectVoucherRows, type VoucherBuild, type VoucherLine } from './build.ts'
import type { ActivityActor } from '../../service/types.ts'
import type { VoucherId } from '../../service/identifiers.ts'

/** Receipt ready for drafting, or assigned to an existing draft. */
export interface VoucherReceipt extends ReportRow { voucherId: string | undefined }
/** Coverage of the entire reporting day, including receipts still awaiting allocation. */
export interface VoucherQueue {
  date: string
  receipts: VoucherReceipt[]
  allocatedAmount: number
  draftedCount: number
  draftedAmount: number
  pendingCount: number
  pendingAmount: number
  unclaimedCount: number
  unclaimedAmount: number
}

function fingerprint(row: ReportRow): string {
  return createHash('sha256').update(JSON.stringify({ receiptId: row.receiptId, date: row.date, amount: row.subtotal, fees: row.amounts, start: row.periodStart, end: row.periodEnd, cash: row.cashAccount })).digest('hex')
}

/** Read allocated, drafted and unclaimed receipts without generating a document.
 * @param db - Open database.
 * @param date - Reporting day.
 * @returns Full-day coverage and selectable receipt keys.
 */
export function voucherQueue(db: DatabaseSync, date: string): VoucherQueue {
  const report = readDailyReport(db, date)
  const assignments = new Map((db.prepare('SELECT receipt_id, voucher_id FROM voucher_receipt').all() as { receipt_id: string; voucher_id: string }[]).map(row => [row.receipt_id, row.voucher_id]))
  const receipts = report.rows.map(row => ({ ...row, voucherId: assignments.get(row.receiptId) }))
  const drafted = receipts.filter(row => row.voucherId !== undefined)
  const unclaimed = db.prepare(`SELECT txn_time, channel, remark, amount FROM "transaction" t
    WHERE status='pending' AND channel NOT IN ('tenpay','unionpay')
      AND NOT EXISTS (SELECT 1 FROM allocation a WHERE a.transaction_id=t.id)
    UNION ALL
    SELECT p.txn_time, '', '', p.amount FROM platform_txn p WHERE p.transaction_id IS NOT NULL
      AND p.merchant_account <> 'recharge'
      AND NOT EXISTS (SELECT 1 FROM allocation a WHERE a.platform_txn_id=p.id)`)
    .all() as { txn_time: string; channel: string; remark: string; amount: number }[]
  const dayUnclaimed = unclaimed.filter(row => receiptDate(row.txn_time, row.channel, row.remark).date === date)
  const draftedAmount = drafted.reduce((sum, row) => sum + row.subtotal, 0)
  return { date, receipts, allocatedAmount: report.grandTotal, draftedCount: drafted.length, draftedAmount,
    pendingCount: receipts.length - drafted.length, pendingAmount: report.grandTotal - draftedAmount,
    unclaimedCount: dayUnclaimed.length, unclaimedAmount: dayUnclaimed.reduce((sum, row) => sum + row.amount, 0) }
}

/** Persist a selected draft and reserve its receipts atomically; identical retries return the same draft.
 * @param db - Open database.
 * @param date - Reporting day.
 * @param receiptIds - Explicit, non-empty receipt selection.
 * @param config - Confirmed tax accounts.
 * @param actor - Human or tool that requested the draft.
 * @returns Persisted proposal; never a posted voucher or financial payment.
 */
export function saveVoucherDraft(
  db: DatabaseSync, date: string, receiptIds: readonly string[],
  config: { outputTaxSubject13: string; outputTaxSubject3: string }, actor: ActivityActor,
): VoucherBuild {
  return transaction(db, () => {
    const rows = selectVoucherRows(readDailyReport(db, date).rows, receiptIds)
    const existing = rows.map(row => db.prepare('SELECT voucher_id, fingerprint FROM voucher_receipt WHERE receipt_id=?').get(row.receiptId) as { voucher_id: string; fingerprint: string } | undefined)
    const assigned = existing.filter(row => row !== undefined)
    if (assigned.length > 0) {
      const id = assigned[0]?.voucher_id
      if (assigned.length !== rows.length || assigned.some(row => row.voucher_id !== id)
        || (db.prepare('SELECT COUNT(*) n FROM voucher_receipt WHERE voucher_id=?').get(id ?? '') as { n: number }).n !== rows.length) throw new Error('部分收款已有凭证草稿，请选择尚未制证的收款')
      if (rows.some((row, i) => existing[i]?.fingerprint !== fingerprint(row))) throw new Error('收款分配与已有凭证草稿不一致，需要先复核原草稿')
      const stored = db.prepare('SELECT lines_json,checks_json FROM voucher WHERE id=?').get(id ?? '') as { lines_json: string; checks_json: string }
      const proposal = buildVoucher(db, date, config, receiptIds)
      return { ...proposal, id: id as VoucherId, lines: JSON.parse(stored.lines_json) as VoucherLine[], checks: JSON.parse(stored.checks_json) as VoucherBuild['checks'] }
    }
    const voucher = buildVoucher(db, date, config, receiptIds)
    if (!voucher.checks.balanced || voucher.checks.warnings.length > 0) throw new Error(`所选收款暂不能制证：${voucher.checks.warnings.join('、') || '借贷不平'}`)
    db.prepare('INSERT INTO voucher(id,date,built_at,lines_json,checks_json) VALUES(?,?,?,?,?)')
      .run(voucher.id, date, new Date().toISOString(), JSON.stringify(voucher.lines), JSON.stringify(voucher.checks))
    const insert = db.prepare('INSERT INTO voucher_receipt(receipt_id,voucher_id,date,fingerprint) VALUES(?,?,?,?)')
    for (const row of rows) insert.run(row.receiptId, voucher.id, date, fingerprint(row))
    recordActivity(db, { actor, action: 'build_voucher', target: voucher.id, amount: voucher.coverage.selectedAmount,
      detail: `选择 ${String(rows.length)} 笔收款生成 ${date} 凭证草稿；未选择 ${String(voucher.coverage.remainingCount)} 笔；尚未过账` })
    return voucher
  })
}

/** Withdraw a draft, retaining its evidence and releasing receipts for correction or reselection.
 * @param db - Open database.
 * @param id - Draft to withdraw; never a posted voucher.
 * @param reason - Human explanation retained in the audit.
 * @param actor - Person requesting withdrawal.
 */
export function withdrawVoucherDraft(db: DatabaseSync, id: VoucherId, reason: string, actor: ActivityActor): void {
  if (!reason.trim()) throw new Error('撤回草稿需要填写原因')
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM voucher WHERE id=?').get(id) === undefined) throw new Error('凭证草稿不存在')
    if (db.prepare('SELECT 1 FROM voucher_void WHERE voucher_id=?').get(id) !== undefined) return
    db.prepare('INSERT INTO voucher_void(voucher_id,reason,at) VALUES(?,?,?)').run(id, reason, new Date().toISOString())
    db.prepare('DELETE FROM voucher_receipt WHERE voucher_id=?').run(id)
    recordActivity(db, { actor, action: 'withdraw_voucher', target: id, detail: `撤回凭证草稿：${reason}；原草稿留存，收款返回待制证` })
  })
}
