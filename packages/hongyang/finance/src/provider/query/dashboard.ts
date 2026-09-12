import type { DatabaseSync } from 'node:sqlite'
import { FEE_RULES, type FeeType } from '../../rules/fee-types.ts'

export interface FeeBalance { readonly feeType: FeeType; readonly label: string; readonly cents: number }
export interface ReceivableSummary { readonly merchantCount: number; readonly openCents: number; readonly byFee: readonly FeeBalance[] }
export interface MerchantBalance {
  readonly shopNo: string
  readonly name: string
  readonly brand: string
  readonly openCents: number
  readonly byFee: readonly FeeBalance[]
}
export interface OverdueRow extends MerchantBalance {
  readonly oldestDueDate: string | undefined
}
export interface ReceiptToday { readonly source: string; readonly count: number; readonly cents: number }
const openExpr = '(r.amount_due-r.amount_relief)-COALESCE((SELECT SUM(a.amount_incl_tax) FROM allocation a WHERE a.receivable_id=r.id),0)'

type SqlParam = string | number | null
function feeRows(db: DatabaseSync, where: string, params: readonly SqlParam[]): FeeBalance[] {
  const rows = db.prepare('SELECT r.fee_type AS feeType,SUM(' + openExpr + ') AS cents FROM receivable r ' + where + ' GROUP BY r.fee_type HAVING cents > 0 ORDER BY cents DESC').all(...params) as unknown as { feeType: FeeType; cents: number }[]
  return rows.map(row => ({ feeType: row.feeType, label: FEE_RULES[row.feeType].label, cents: row.cents }))
}
export function receivableSummary(db: DatabaseSync): ReceivableSummary {
  const byFee = feeRows(db, '', [])
  const merchantCount = (db.prepare('SELECT COUNT(DISTINCT r.merchant_id) AS n FROM receivable r WHERE ' + openExpr + '>0').get() as { n: number }).n
  return { merchantCount, openCents: byFee.reduce((sum, row) => sum + row.cents, 0), byFee }
}
function merchantRows(db: DatabaseSync, where: string, params: readonly SqlParam[]): MerchantBalance[] {
  const rows = db.prepare('SELECT m.shop_no AS shopNo,m.name,m.brand,SUM(' + openExpr + ') AS openCents FROM merchant m JOIN receivable r ON r.merchant_id=m.id ' + where + ' GROUP BY m.id HAVING openCents > 0 ORDER BY openCents DESC').all(...params) as unknown as MerchantBalance[]
  return rows.map(row => ({ ...row, byFee: feeRows(db, 'WHERE r.merchant_id=(SELECT id FROM merchant WHERE shop_no=?)', [row.shopNo]) }))
}
export function merchantBalance(db: DatabaseSync, query: string): MerchantBalance[] {
  const like = '%' + query.trim() + '%'
  return merchantRows(db, 'WHERE m.shop_no LIKE ? OR m.name LIKE ? OR m.brand LIKE ?', [like, like, like])
}
export function overdue(db: DatabaseSync, days: number, today: string): OverdueRow[] {
  const cutoff = new Date(today + 'T00:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const date = cutoff.toISOString().slice(0, 10)
  const rows = merchantRows(db, 'WHERE r.due_date IS NOT NULL AND r.due_date < ?', [date])
  return rows.map(row => ({ ...row, oldestDueDate: (db.prepare('SELECT MIN(r.due_date) AS d FROM receivable r JOIN merchant m ON m.id=r.merchant_id WHERE m.shop_no=? AND r.due_date IS NOT NULL AND r.due_date < ?').get(row.shopNo, date) as { d: string | null }).d ?? undefined }))
}
export function todayReceipts(db: DatabaseSync, date: string): ReceiptToday[] {
  return db.prepare('SELECT CASE WHEN p.merchant_account=\'1693395706\' THEN \'企业微信706\' WHEN p.merchant_account=\'1723333380\' THEN \'企业微信380\' ELSE t.source END AS source,COUNT(DISTINCT COALESCE(p.id,t.id)) AS count,SUM(a.amount_incl_tax) AS cents FROM allocation a JOIN "transaction" t ON t.id=a.transaction_id LEFT JOIN platform_txn p ON p.id=a.platform_txn_id WHERE substr(COALESCE(p.txn_time,t.txn_time),1,10)=? GROUP BY source ORDER BY cents DESC').all(date) as unknown as ReceiptToday[]
}
