import type { DatabaseSync } from 'node:sqlite'
import type { VoucherBuild, VoucherLine } from './build.ts'

interface VoucherReferenceRow { voucher_no: number; line_no: number; summary: string; subject: string; debit: number; credit: number }
function rowKey(row: { subject: string; debit: number; credit: number }): string {
  return `${row.subject}|${row.debit > 0 ? 'debit' : 'credit'}|${row.debit || row.credit}`
}
export function compareVoucher(db: DatabaseSync, voucher: VoucherBuild) {
  const rows = db.prepare('SELECT voucher_no,line_no,summary,subject,debit,credit FROM voucher_row WHERE date=? ORDER BY voucher_no,line_no').all(voucher.date) as unknown as VoucherReferenceRow[]
  const expected = new Map<string, VoucherReferenceRow[]>()
  for (const row of rows) { const bucket = expected.get(rowKey(row)) ?? []; bucket.push(row); expected.set(rowKey(row), bucket) }
  const diffs: { line: number; expected: VoucherReferenceRow | null; actual: VoucherLine | null }[] = []
  let matched = 0
  for (const [index, line] of voucher.lines.entries()) {
    const reference = expected.get(rowKey(line))?.shift()
    if (reference === undefined) diffs.push({ line: index + 1, expected: null, actual: line })
    else matched++
  }
  for (const bucket of expected.values()) {
    for (const reference of bucket) diffs.push({ line: reference.line_no, expected: reference, actual: null })
  }
  return { date: voucher.date, matched, diffs }
}
