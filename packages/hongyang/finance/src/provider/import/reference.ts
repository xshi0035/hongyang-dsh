/**
 * Reference imports used only for comparison: the finance department's manual
 * daily-income ledger and the accountant's Kingdee vouchers. Neither creates
 * transactions or allocations; they are the answer key the report and voucher
 * builders are checked against.
 * @module @deepseek-ai/dsh-hy-finance/provider/import/reference
 */

import type { DatabaseSync } from 'node:sqlite'
import { FEE_TYPE_BY_LABEL, type FeeType } from '../../rules/fee-types.ts'
import { toCents } from '../../rules/tax.ts'
import { newId, type BatchId } from '../../service/identifiers.ts'
import { FinanceError } from '../../service/errors.ts'
import { findHeader, isoDate, normalizeLabel, text, type Workbook } from './read-sheet.ts'
import { insertBatch, transaction } from '../db/repo.ts'

interface LedgerParsed {
  date: string
  shopNo: string
  name: string
  brand: string
  subtotal: number
  source: string
  start: string | undefined
  end: string | undefined
  amounts: Record<string, number>
  remark: string
}

interface VoucherParsed {
  date: string
  no: number
  line: number
  summary: string
  subject: string
  subjectName: string
  debit: number
  credit: number
}

/** Result of a reference import. */
export interface ReferenceImportResult {
  readonly batchId: BatchId
  readonly rows: number
  readonly dateRange: { from: string; to: string } | undefined
  /** Ledger only: extra amount columns not in the 22 fee types (kept under their label). */
  readonly extraColumns: string[]
}

/**
 * The manual ledger (`收入日报表.xlsx`, 34 or 35 columns). Amount cells are
 * stored as a label → cents JSON object so extra columns such as `代收款`
 * survive without a schema change.
 * @param db - open database.
 * @param wb - the workbook.
 * @returns counts and the covered date range.
 */
export function importLedger(db: DatabaseSync, wb: Workbook): ReferenceImportResult {
  const rows = [...wb.sheets.values()].find(r => r.some(row => row.some(c => typeof c === 'string' && normalizeLabel(c) === '收款金额小计')))
  if (rows === undefined) throw new FinanceError('SHEET_NOT_FOUND', 'no sheet with 收款金额小计')
  const { index, columns } = findHeader(rows, ['收款日期', '铺位号/点位号', '商户名称', '收款金额小计', '收款来源'])
  const amountColumns: { label: string; col: number; feeType: FeeType | undefined }[] = []
  const fixed = new Set(['序号', '收款日期', '铺位号/点位号', '商户名称', '品牌', '收款金额小计', '收款来源', '款项起始期', '款项截止期', '备注', '是否已开票据', '票据号码', '开票日期'].map(normalizeLabel))
  for (const [label, col] of columns) {
    if (fixed.has(label)) continue
    amountColumns.push({ label, col, feeType: FEE_TYPE_BY_LABEL.get(label) })
  }
  const extra = amountColumns.filter(c => c.feeType === undefined).map(c => c.label)
  const parsed: LedgerParsed[] = []
  for (const row of rows.slice(index + 1)) {
    const date = isoDate(row[columns.get('收款日期') ?? -1] ?? null)
    const subtotal = toCents(text(row, columns, '收款金额小计'))
    if (date === undefined || subtotal === undefined) continue
    const amounts: Record<string, number> = {}
    for (const c of amountColumns) {
      const cents = toCents(row[c.col] ?? null)
      if (cents !== undefined && cents !== 0) amounts[c.feeType ?? c.label] = cents
    }
    parsed.push({
      date,
      shopNo: text(row, columns, '铺位号/点位号'),
      name: text(row, columns, '商户名称'),
      brand: text(row, columns, '品牌'),
      subtotal,
      source: text(row, columns, '收款来源'),
      start: isoDate(row[columns.get('款项起始期') ?? -1] ?? null),
      end: isoDate(row[columns.get('款项截止期') ?? -1] ?? null),
      amounts,
      remark: text(row, columns, '备注'),
    })
  }
  return transaction(db, () => {
    const batch = insertBatch(db, 'ledger', wb.file, wb.sha256, parsed.length)
    const insert = db.prepare(`INSERT INTO ledger_row
      (id, batch_id, date, shop_no, merchant_name, brand, subtotal, source, period_start, period_end, amounts, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const r of parsed) {
      insert.run(newId('ldg'), batch.id, r.date, r.shopNo, r.name, r.brand, r.subtotal, r.source, r.start ?? null, r.end ?? null, JSON.stringify(r.amounts), r.remark)
    }
    const dates = parsed.map(r => r.date).sort()
    return {
      batchId: batch.id,
      rows: parsed.length,
      dateRange: dates.length === 0 ? undefined : { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' },
      extraColumns: extra,
    }
  })
}

/**
 * Kingdee voucher export (21 columns). Only the first line of a voucher
 * carries the date and number; later lines inherit them.
 * @param db - open database.
 * @param wb - the workbook.
 * @returns counts and the covered date range.
 */
export function importVoucherXlsx(db: DatabaseSync, wb: Workbook): ReferenceImportResult {
  const rows = [...wb.sheets.values()][0]
  if (rows === undefined) throw new FinanceError('SHEET_NOT_FOUND', 'empty voucher file')
  const { index, columns } = findHeader(rows, ['日期', '凭证号', '摘要', '科目编码', '借方金额', '贷方金额'])
  const parsed: VoucherParsed[] = []
  let date = ''
  let no = 0
  let line = 0
  for (const row of rows.slice(index + 1)) {
    const d = isoDate(row[columns.get('日期') ?? -1] ?? null)
    const n = Number(text(row, columns, '凭证号'))
    if (d !== undefined && Number.isFinite(n) && text(row, columns, '凭证号') !== '') { date = d; no = n; line = 0 }
    const subject = text(row, columns, '科目编码')
    if (date === '' || subject === '') continue
    line++
    parsed.push({
      date, no, line,
      summary: text(row, columns, '摘要'),
      subject,
      subjectName: text(row, columns, '科目全名'),
      debit: toCents(text(row, columns, '借方金额')) ?? 0,
      credit: toCents(text(row, columns, '贷方金额')) ?? 0,
    })
  }
  return transaction(db, () => {
    const batch = insertBatch(db, 'voucher', wb.file, wb.sha256, parsed.length)
    const insert = db.prepare(`INSERT INTO voucher_row
      (id, batch_id, date, voucher_no, line_no, summary, subject, subject_name, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const r of parsed) insert.run(newId('vcr'), batch.id, r.date, r.no, r.line, r.summary, r.subject, r.subjectName, r.debit, r.credit)
    const dates = parsed.map(r => r.date).sort()
    return {
      batchId: batch.id,
      rows: parsed.length,
      dateRange: dates.length === 0 ? undefined : { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' },
      extraColumns: [],
    }
  })
}
