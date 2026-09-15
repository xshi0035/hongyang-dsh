/**
 * The daily income report (收入日报表): the client's 34-column sheet, one row
 * per receipt per merchant, fee amounts spread across the 22 fee columns.
 * Built from allocations, exported with exceljs in the template's layout
 * (title, a totals row with SUM formulas, the header, then data), and
 * compared line by line with the finance department's manual ledger.
 * @module @deepseek-ai/dsh-hy-finance/provider/report/daily-report
 */

import { receiptDate } from './receipt-date.ts'
import type { DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { FEE_RULES, FEE_TYPES, FEE_TYPE_BY_LABEL, type FeeType } from '../../rules/fee-types.ts'
import { formatCents, toYuan } from '../../rules/tax.ts'
import { newId, type ReportId } from '../../service/identifiers.ts'
import { SOURCE_LABELS, type Source } from '../../service/types.ts'
import { canonicalShopNo } from '../import/receivable.ts'

/** One report row; amounts in cents. */
export interface ReportRow {
  readonly receiptId: string
  readonly cashAccount: 'bank' | 'pos'
  readonly seq: number
  readonly date: string
  readonly shopNo: string
  readonly merchantName: string
  readonly brand: string
  readonly subtotal: number
  readonly source: Source
  readonly periodStart: string | undefined
  readonly periodEnd: string | undefined
  readonly amounts: Partial<Record<FeeType, number>>
  readonly remark: string
  /** Stable key for comparison: shop without floor prefixes + source + subtotal. */
  readonly key: string
}

/** A built report. */
export interface DailyReport {
  readonly id: ReportId
  readonly date: string
  readonly rows: ReportRow[]
  readonly totals: Partial<Record<FeeType, number>>
  readonly bySource: Partial<Record<Source, { count: number; amount: number }>>
  readonly grandTotal: number
}

/** One line of the ledger comparison. */
export interface DiffRow {
  readonly kind: 'missing' | 'extra' | 'amount'
  readonly shopNo: string
  readonly merchantName: string
  readonly source: string
  /** Report subtotal in cents, when present. */
  readonly reportAmount: number | undefined
  /** Ledger subtotal in cents, when present. */
  readonly ledgerAmount: number | undefined
  readonly note: string
}

/** Comparison result. */
export interface CompareResult {
  readonly date: string
  readonly reportRows: number
  readonly ledgerRows: number
  readonly matched: number
  readonly diffs: DiffRow[]
  readonly reportTotal: number
  readonly ledgerTotal: number
}

/** Source display order, as the ledger lists a day. */
const SOURCE_ORDER: readonly Source[] = ['bank2038', 'bank2035', 'pingan', 'pos', 'wechat706', 'wechat380', 'dingtalk']

/** Strip floor prefixes so `5F-5002A,5F-5002B` and `5002A,5002B` compare equal. */
function shopKey(shopNo: string): string {
  return canonicalShopNo(shopNo).split(',').map(p => p.replace(/^\d+F-/, '')).sort().join(',')
}

interface AllocationJoin {
  transaction_id: string
  platform_txn_id: string | null
  merchant_id: string | null
  fee_type: string
  period_start: string | null
  period_end: string | null
  amount_incl_tax: number
  txn_source: string
  txn_channel: string
  ptx_platform: string | null
  txn_time: string
  payer_name: string
  remark: string
  ptx_time: string | null
  ptx_account: string | null
  ptx_note: string | null
  shop_no: string | null
  merchant_name: string | null
  brand: string | null
}

function sourceOf(a: AllocationJoin): Source {
  if (a.platform_txn_id === null) return a.txn_source as Source
  if (a.ptx_account === '1693395706') return 'wechat706'
  if (a.ptx_account === '1723333380') return 'wechat380'
  if (a.txn_source === 'bank2038' || a.txn_source === 'bank2035') return 'pos'
  return a.txn_source as Source
}

/**
 * Read a report without saving it; explicit parking business dates take precedence over arrival dates.
 * @param db - open database.
 * @param date - ISO `YYYY-MM-DD`.
 * @returns the report; rows ordered by source then shop.
 */
export function readDailyReport(db: DatabaseSync, date: string): DailyReport {
  const rows = db.prepare(`SELECT a.transaction_id, a.platform_txn_id, a.merchant_id, a.fee_type, a.period_start, a.period_end, a.amount_incl_tax,
      t.source AS txn_source, t.channel AS txn_channel, p.platform AS ptx_platform, t.txn_time, t.payer_name, t.remark,
      p.txn_time AS ptx_time, p.merchant_account AS ptx_account, p.note AS ptx_note,
      m.shop_no, m.name AS merchant_name, m.brand
    FROM allocation a
    JOIN "transaction" t ON t.id = a.transaction_id
    LEFT JOIN platform_txn p ON p.id = a.platform_txn_id
    LEFT JOIN merchant m ON m.id = a.merchant_id
    `).all() as unknown as AllocationJoin[]
  // One row per receipt per merchant; WeChat parking orders collapse into one line per day.
  const groups = new Map<string, { a: AllocationJoin; source: Source; amounts: Map<FeeType, number>; starts: string[]; ends: string[] }>()
  for (const a of rows) {
    if (receiptDate(a.ptx_time ?? a.txn_time, a.platform_txn_id === null ? a.txn_channel : '', a.remark).date !== date) continue
    const source = sourceOf(a)
    const receipt = source === 'wechat380' ? `wechat380:${date}` : (a.platform_txn_id ?? a.transaction_id)
    const key = `${receipt}|${a.merchant_id ?? ''}`
    const g = groups.get(key) ?? { a, source, amounts: new Map<FeeType, number>(), starts: [], ends: [] }
    const fee = a.fee_type as FeeType
    g.amounts.set(fee, (g.amounts.get(fee) ?? 0) + a.amount_incl_tax)
    if (a.period_start !== null) g.starts.push(a.period_start)
    if (a.period_end !== null) g.ends.push(a.period_end)
    groups.set(key, g)
  }
  const built: ReportRow[] = []
  for (const [receiptId, g] of groups) {
    const amounts: Partial<Record<FeeType, number>> = {}
    let subtotal = 0
    for (const [fee, cents] of g.amounts) { amounts[fee] = cents; subtotal += cents }
    const shopNo = g.a.shop_no ?? ''
    const remark = g.a.platform_txn_id === null
      ? `${g.a.payer_name}${g.a.remark ? ` ${g.a.remark}` : ''}`
      : (g.a.ptx_note ?? '').split('|').slice(1).join('|')
    built.push({
      receiptId, cashAccount: g.a.ptx_platform === 'pos' || g.source === 'pos' ? 'pos' : 'bank',
      seq: 0, date, shopNo, merchantName: g.a.merchant_name ?? '', brand: g.a.brand ?? '', subtotal, source: g.source,
      periodStart: g.starts.length === 0 ? undefined : [...g.starts].sort()[0],
      periodEnd: g.ends.length === 0 ? undefined : [...g.ends].sort().at(-1),
      amounts, remark: [remark.trim(), ...(receiptDate(g.a.txn_time, g.a.txn_channel, g.a.remark).businessDay && g.a.platform_txn_id === null ? [`业务日归属，待财务复核；到账日 ${g.a.txn_time.slice(0, 10)}`] : [])].filter(Boolean).join('；'),
      key: `${shopKey(shopNo)}|${g.source}|${String(subtotal)}`,
    })
  }
  built.sort((x, y) => SOURCE_ORDER.indexOf(x.source) - SOURCE_ORDER.indexOf(y.source)
    || x.shopNo.localeCompare(y.shopNo) || y.subtotal - x.subtotal)
  const totals: Partial<Record<FeeType, number>> = {}
  const bySource: Partial<Record<Source, { count: number; amount: number }>> = {}
  let grandTotal = 0
  built.forEach((r, i) => {
    (r as { seq: number }).seq = i + 1
    grandTotal += r.subtotal
    for (const fee of FEE_TYPES) {
      const v = r.amounts[fee]
      if (v !== undefined) totals[fee] = (totals[fee] ?? 0) + v
    }
    const s = bySource[r.source] ?? { count: 0, amount: 0 }
    bySource[r.source] = { count: s.count + 1, amount: s.amount + r.subtotal }
  })
  const report: DailyReport = { id: newId('rpt'), date, rows: built, totals, bySource, grandTotal }
  return report
}

/** Build and persist a report using receipt business dates.
 * @param db - Open database.
 * @param date - Reporting day in ISO form.
 * @returns Report snapshot with integer-cent totals.
 */
export function buildDailyReport(db: DatabaseSync, date: string): DailyReport {
  const report = readDailyReport(db, date)
  db.prepare('INSERT INTO daily_report (id, date, built_at, rows_json) VALUES (?, ?, ?, ?)')
    .run(report.id, date, new Date().toISOString(), JSON.stringify(report.rows))
  return report
}

/** Header labels in column order. */
export const REPORT_HEADERS: readonly string[] = [
  '序号', '收款日期', '铺位号/点位号', '商户名称', '品牌', '收款金额小计', '收款来源', '款项起始期', '款项截止期',
  ...FEE_TYPES.map(f => FEE_RULES[f].label),
  '备注', '是否已开票据', '票据号码', '开票日期',
]

function dotDate(iso: string | undefined): string {
  if (iso === undefined) return ''
  const [y, m, d] = iso.split('-')
  return `${y ?? ''}-${m ?? ''}-${d ?? ''}`
}

/**
 * Write the report as the client's xlsx layout.
 * @param report - a built report.
 * @param dir - directory to write into (created when missing).
 * @returns the file path.
 */
export async function exportDailyReport(report: DailyReport, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, `收入日报表_${report.date}.xlsx`)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('收入日报表', { views: [{ state: 'frozen', ySplit: 3 }] })
  const cols = REPORT_HEADERS.length
  ws.mergeCells(1, 1, 1, cols)
  ws.getCell(1, 1).value = '收入日报表'
  ws.getCell(1, 1).font = { bold: true, size: 14 }
  ws.getCell(1, 1).alignment = { horizontal: 'center' }
  const headerRow = ws.getRow(3)
  headerRow.values = [...REPORT_HEADERS]
  headerRow.font = { bold: true }
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })
  const firstData = 4
  report.rows.forEach((r, i) => {
    const row = ws.getRow(firstData + i)
    const values: (string | number | null)[] = [
      r.seq, r.date, r.shopNo, r.merchantName, r.brand, toYuan(r.subtotal), SOURCE_LABELS[r.source],
      dotDate(r.periodStart), dotDate(r.periodEnd),
      ...FEE_TYPES.map(f => (r.amounts[f] === undefined ? null : toYuan(r.amounts[f]))),
      r.remark, null, null, null,
    ]
    row.values = values
  })
  const lastData = firstData + Math.max(report.rows.length, 1) - 1
  const totalsRow = ws.getRow(2)
  totalsRow.getCell(1).value = '合计'
  const amountCols = [6, ...FEE_TYPES.map((_, i) => 10 + i)]
  for (const c of amountCols) {
    const letter = ws.getColumn(c).letter
    totalsRow.getCell(c).value = { formula: `SUM(${letter}${String(firstData)}:${letter}${String(lastData)})` }
    totalsRow.getCell(c).font = { bold: true, color: { argb: 'FFC00000' } }
    ws.getColumn(c).numFmt = '#,##0.00'
  }
  totalsRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } } })
  ws.getColumn(1).width = 6
  ws.getColumn(2).width = 12
  ws.getColumn(3).width = 18
  ws.getColumn(4).width = 26
  ws.getColumn(5).width = 16
  ws.getColumn(6).width = 14
  ws.getColumn(7).width = 14
  ws.getColumn(8).width = 12
  ws.getColumn(9).width = 12
  for (let c = 10; c < 10 + FEE_TYPES.length; c++) ws.getColumn(c).width = 12
  ws.getColumn(10 + FEE_TYPES.length).width = 30
  await wb.xlsx.writeFile(file)
  return file
}

interface LedgerRow {
  shop_no: string
  merchant_name: string
  brand: string
  subtotal: number
  source: string
  amounts: string
}

/** Loose shop tokens: `1019-BB` → `1019BB`, `5F-5009A` → `5009A`, `5002A,5002B` → both. */
function shopTokens(shopNo: string): string[] {
  return shopNo.split(/[,，、;；]/).map(p => p.trim().toUpperCase().replace(/^\d+F-/, '').replace(/[-\s]/g, '')).filter(p => /\d/.test(p))
}

/** Whether two shop spellings plausibly name the same shop: a token equal to, or a prefix of, the other side's. */
function shopsOverlap(a: string, b: string): boolean {
  const ta = shopTokens(a)
  const tb = shopTokens(b)
  return ta.some(x => tb.some(y => x === y || x.startsWith(y) || y.startsWith(x)))
}

function partyKey(name: string): string {
  return name.replace(/（个体工商户）|\(个体工商户\)|股份有限公司|有限责任公司|有限公司|公司|\s+/g, '').replace(/[()（）]/g, '')
}

/** Whether a report row and a ledger row name the same party by shop, contracting name, or brand. */
function sameParty(r: ReportRow, l: LedgerRow): boolean {
  if (r.shopNo !== '' && l.shop_no !== '' && shopsOverlap(r.shopNo, l.shop_no)) return true
  const names = [r.merchantName, r.brand].map(partyKey).filter(x => x.length >= 2)
  const theirs = [l.merchant_name, l.brand].map(partyKey).filter(x => x.length >= 2)
  return names.some(x => theirs.some(y => x === y || x.includes(y) || y.includes(x)))
}

/**
 * Compare a report with the ledger rows of the same day. Matching runs in
 * four passes, loosest last: exact shop + source + amount; same party (shop
 * overlap, contracting name, or brand) + same source + amount; same source +
 * amount alone (rows the ledger files without a shop, such as parking); and
 * one report row equal to the sum of the ledger's rows for the same party and
 * source (the ledger splits one payment by period). A paired row counts as
 * matched only when every fee amount also agrees; fee differences use the
 * amount-difference category even when subtotals are equal.
 * @param db - open database.
 * @param report - a built report.
 * @param toleranceCents - allowed subtotal difference for an amount match.
 * @returns matched count and diffs.
 */
export function compareDailyReport(db: DatabaseSync, report: DailyReport, toleranceCents: number): CompareResult {
  const ledger = db.prepare('SELECT shop_no, merchant_name, brand, subtotal, source, amounts FROM ledger_row WHERE date = ?')
    .all(report.date) as unknown as LedgerRow[]
  const labelToSource = new Map(Object.entries(SOURCE_LABELS).map(([k, v]) => [v, k as Source]))
  const L = ledger.map(l => ({ l, source: labelToSource.get(l.source) ?? l.source, used: false }))
  const R = report.rows.map(r => ({ r, used: false }))
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= toleranceCents
  let matched = 0
  const diffs: DiffRow[] = []
  const checkFees = (r: ReportRow, rows: LedgerRow[]): void => {
    const expected: Record<string, number> = {}
    for (const row of rows) {
      const amounts = JSON.parse(row.amounts) as Record<string, number>
      for (const [fee, amount] of Object.entries(amounts)) {
        const key = FEE_TYPE_BY_LABEL.get(fee) ?? fee
        expected[key] = (expected[key] ?? 0) + amount
      }
    }
    const actual: Readonly<Record<string, number | undefined>> = r.amounts
    const fees = new Set([...Object.keys(expected), ...Object.keys(actual)])
    const differences = [...fees].filter(fee => !close(actual[fee] ?? 0, expected[fee] ?? 0))
    if (differences.length === 0) { matched++; return }
    const note = differences.map((fee) => {
      const knownFee = FEE_TYPES.find(value => value === fee)
      const label = knownFee === undefined ? fee : FEE_RULES[knownFee].label
      return `${label}：生成 ${formatCents(actual[fee] ?? 0)} / 台账 ${formatCents(expected[fee] ?? 0)}`
    }).join('；')
    diffs.push({
      kind: 'amount', shopNo: r.shopNo, merchantName: r.merchantName, source: SOURCE_LABELS[r.source],
      reportAmount: r.subtotal, ledgerAmount: rows.reduce((sum, row) => sum + row.subtotal, 0), note: `费项金额差异：${note}`,
    })
  }
  const take = (ri: { r: ReportRow; used: boolean }, li: { l: LedgerRow; used: boolean }): void => {
    ri.used = true; li.used = true; checkFees(ri.r, [li.l])
  }
  // 1. exact
  for (const ri of R) {
    const li = L.find(c => !c.used && c.source === ri.r.source
      && shopKey(c.l.shop_no) === shopKey(ri.r.shopNo) && close(c.l.subtotal, ri.r.subtotal))
    if (li !== undefined) take(ri, li)
  }
  // 2. same party + amount
  for (const ri of R.filter(x => !x.used)) {
    const li = L.find(c => !c.used && c.source === ri.r.source && close(c.l.subtotal, ri.r.subtotal) && sameParty(ri.r, c.l))
    if (li !== undefined) take(ri, li)
  }
  // 3. same source + amount (shopless rows)
  for (const ri of R.filter(x => !x.used)) {
    const li = L.find(c => !c.used && c.source === ri.r.source && close(c.l.subtotal, ri.r.subtotal))
    if (li !== undefined) take(ri, li)
  }
  // 4. one report row = sum of the ledger's rows for the same party
  for (const ri of R.filter(x => !x.used)) {
    const group = L.filter(c => !c.used && c.source === ri.r.source && sameParty(ri.r, c.l))
    const sum = group.reduce((s, c) => s + c.l.subtotal, 0)
    if (group.length > 1 && close(sum, ri.r.subtotal)) {
      ri.used = true
      for (const c of group) c.used = true
      checkFees(ri.r, group.map(c => c.l))
    }
  }
  for (const ri of R.filter(x => !x.used)) {
    const near = L.find(c => !c.used && c.source === ri.r.source && sameParty(ri.r, c.l))
    if (near !== undefined) {
      near.used = true
      diffs.push({ kind: 'amount', shopNo: ri.r.shopNo, merchantName: ri.r.merchantName, source: SOURCE_LABELS[ri.r.source], reportAmount: ri.r.subtotal, ledgerAmount: near.l.subtotal, note: `金额差 ${formatCents(ri.r.subtotal - near.l.subtotal)}` })
    } else {
      diffs.push({ kind: 'extra', shopNo: ri.r.shopNo, merchantName: ri.r.merchantName, source: SOURCE_LABELS[ri.r.source], reportAmount: ri.r.subtotal, ledgerAmount: undefined, note: ri.r.remark.includes('业务日归属，待财务复核') ? '业务日归属，待财务复核；台账里没有这一行' : '台账里没有这一行' })
    }
  }
  for (const c of L.filter(x => !x.used)) {
    diffs.push({ kind: 'missing', shopNo: c.l.shop_no, merchantName: c.l.merchant_name, source: c.l.source, reportAmount: undefined, ledgerAmount: c.l.subtotal, note: '生成的日报表里没有这一行' })
  }
  const result: CompareResult = {
    date: report.date, reportRows: report.rows.length, ledgerRows: ledger.length, matched, diffs,
    reportTotal: report.grandTotal, ledgerTotal: ledger.reduce((s, l) => s + l.subtotal, 0),
  }
  db.prepare('UPDATE daily_report SET compare_json = ? WHERE id = ?').run(JSON.stringify(result), report.id)
  return result
}

/**
 * Human label of a fee type.
 * @param fee - Supported finance fee type.
 * @returns The configured fee label.
 */
export function feeLabel(fee: FeeType): string {
  return FEE_RULES[fee].label
}
