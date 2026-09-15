/** Voucher proposals from explicitly selected allocated receipts, retaining full-day coverage. */
import type { DatabaseSync } from 'node:sqlite'
import { FEE_RULES, OUTPUT_TAX_SUBJECTS, type FeeType } from '../../rules/fee-types.ts'
import { taxOf } from '../../rules/tax.ts'
import { newId, type VoucherId } from '../../service/identifiers.ts'
import { readDailyReport, type ReportRow } from '../report/daily-report.ts'

/** Proposed voucher line with integer-cent debit and credit amounts. */
export interface VoucherLine {
  date: string
  voucherNo: number
  lineNo: number
  summary: string
  subject: string
  subjectName: string
  debit: number
  credit: number
  warning?: string
}
/** Full-day allocated receipts remain visible when only a subset is selected. */
export interface VoucherCoverage {
  totalCount: number
  totalAmount: number
  selectedCount: number
  selectedAmount: number
  remainingCount: number
  remainingAmount: number
}
/** Voucher proposal; building alone neither posts money nor reserves receipts. */
export interface VoucherBuild {
  id: VoucherId
  date: string
  lines: VoucherLine[]
  receiptIds: string[]
  coverage: VoucherCoverage
  checks: { balanced: boolean; warnings: string[] }
}

/** Select exact receipt keys; unknown, repeated or empty selections fail.
 * @param rows - All allocated rows on the requested day.
 * @param receiptIds - Explicit keys, or undefined for a full-day diagnostic proposal.
 * @returns Selected rows in report order.
 */
export function selectVoucherRows(rows: readonly ReportRow[], receiptIds: readonly string[] | undefined): ReportRow[] {
  if (receiptIds === undefined) return [...rows]
  if (receiptIds.length === 0 || new Set(receiptIds).size !== receiptIds.length) throw new Error('请选择至少一笔收款，且不能重复选择')
  const selected = rows.filter(row => receiptIds.includes(row.receiptId))
  if (selected.length !== receiptIds.length) throw new Error('所选收款不属于该日期或尚未认领，请刷新待制证清单')
  return selected
}

/** Build a proposal without saving a formal voucher or modifying financial rows.
 * @param db - Open finance database.
 * @param date - Reporting date in YYYY-MM-DD form.
 * @param config - Confirmed tax accounts.
 * @param receiptIds - Exact selected receipts; omitted only for full-day diagnostics.
 * @returns Proposed lines with selected and remaining coverage.
 */
export function buildVoucher(
  db: DatabaseSync, date: string, config: { outputTaxSubject13: string; outputTaxSubject3: string }, receiptIds?: readonly string[],
): VoucherBuild {
  const report = readDailyReport(db, date)
  const selected = selectVoucherRows(report.rows, receiptIds)
  const lines: VoucherLine[] = []
  const add = (subject: string, subjectName: string, debit: number, credit: number, summary: string, warning?: string): void => {
    lines.push({ date, voucherNo: 1, lineNo: lines.length + 1, summary, subject, subjectName, debit, credit,
      ...(warning === undefined ? {} : { warning }) })
  }
  // Each receipt keeps its own cash line so it can be traced and compared independently.
  for (const row of selected) {
    const party = `${row.shopNo}${row.merchantName ? `-${row.merchantName}` : ''}`
    add(row.cashAccount === 'pos' ? '1012.08' : '1002.02', row.cashAccount === 'pos' ? '其他货币资金_POS收款' : '银行存款_银行收款', row.subtotal, 0, `${date} 收款 ${party}`)
    for (const [fee, amount] of Object.entries(row.amounts) as [FeeType, number][]) {
      const rule = FEE_RULES[fee]
      const period = row.periodStart === undefined ? '' : ` ${row.periodStart} 至 ${row.periodEnd ?? row.periodStart}`
      const summary = `${party} ${rule.label}${period}`
      if (rule.subject === null) { add('', '', 0, amount, summary, '待确认预收科目'); continue }
      add(rule.subject, rule.subjectName ?? '', 0, amount, summary)
      if (rule.taxRate > 0) {
        const tax = taxOf(amount, rule.taxRate)
        const subject = rule.taxRate === 0.13 ? config.outputTaxSubject13 : rule.taxRate === 0.03 ? config.outputTaxSubject3 : (OUTPUT_TAX_SUBJECTS[rule.taxRate] ?? '')
        add(rule.subject, rule.subjectName ?? '', tax, 0, summary)
        add(subject, '应交税费_应交增值税_销项税额', 0, tax, summary, subject === '' ? '待确认销项税科目' : undefined)
      }
    }
  }
  const selectedAmount = selected.reduce((sum, row) => sum + row.subtotal, 0)
  return {
    id: newId('vcr'), date, lines, receiptIds: selected.map(row => row.receiptId),
    coverage: { totalCount: report.rows.length, totalAmount: report.grandTotal, selectedCount: selected.length,
      selectedAmount, remainingCount: report.rows.length - selected.length, remainingAmount: report.grandTotal - selectedAmount },
    checks: { balanced: lines.reduce((sum, line) => sum + line.debit - line.credit, 0) === 0,
      warnings: lines.flatMap(line => line.warning === undefined ? [] : [line.warning]) },
  }
}
