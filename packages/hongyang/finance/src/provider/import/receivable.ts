/**
 * The operations department's receivable workbook (`租费应收明细表.xlsx`):
 * a rent-and-fees sheet and a utilities sheet. It is the merchant master data
 * (shop number, contracting party, brand, floor) and the per-period receivable
 * balances the claim engine matches payments against.
 * @module @deepseek-ai/dsh-hy-finance/provider/import/receivable
 */

import type { DatabaseSync } from 'node:sqlite'
import { feeTypesFromText, type FeeType } from '../../rules/fee-types.ts'
import { toCents } from '../../rules/tax.ts'
import { newId, type BatchId } from '../../service/identifiers.ts'
import { findHeader, isoDate, monthOf, periodRange, text, type Row, type Workbook } from './read-sheet.ts'
import { insertBatch, transaction, upsertMerchant } from '../db/repo.ts'

/** Result of the receivable import. */
export interface ReceivableImportResult {
  readonly batchId: BatchId
  readonly sheets: string[]
  readonly merchants: number
  readonly receivables: number
  readonly skipped: number
  /** Distinct fee labels that mapped to no fee type; imported under `other`. */
  readonly unknownFeeLabels: string[]
}

interface ParsedRow {
  shopNo: string
  name: string
  brand: string
  floor: string
  feeType: FeeType
  feeLabel: string
  period: string
  periodStart: string | undefined
  periodEnd: string | undefined
  dueDate: string | undefined
  due: number
  relief: number
  received: number
  unpaid: number
  raw: string
}

/**
 * One spelling for a shop number: `5F-5002A、5002B` and `5F-5002A,5F-5002B`
 * both become `5F-5002A,5F-5002B` (a floor prefix on any part spreads to the
 * parts that lack one; parts are sorted).
 * @param raw - the sheet cell.
 * @param floor - the row's floor cell (`1F`, `5F`, `1F多经`), used as the prefix when no part carries one.
 * @returns the canonical shop number.
 */
export function canonicalShopNo(raw: string, floor = ''): string {
  const parts = raw.split(/[,，、;；]/).map(p => p.trim().toUpperCase()).filter(p => p.length > 0)
  const floorPrefix = /^(\d+F)/.exec(floor.trim().toUpperCase())?.[1]
  const prefix = parts.map(p => /^(\d+F-)/.exec(p)?.[1]).find(p => p !== undefined) ?? (floorPrefix === undefined ? undefined : `${floorPrefix}-`)
  const fixed = parts.map(p => prefix !== undefined && !/^\d+F-/.test(p) && /^\d{3,4}[A-Z]{0,2}$/.test(p) ? `${prefix}${p}` : p)
  return [...new Set(fixed)].sort().join(',')
}

function feeTypeOf(label: string, unknown: Set<string>): FeeType {
  const found = feeTypesFromText(label)
  const type = found[0]
  if (type === undefined) {
    unknown.add(label)
    return 'other'
  }
  return type
}

function parseRentSheet(rows: readonly Row[], unknown: Set<string>): ParsedRow[] {
  const { index, columns } = findHeader(rows, ['账期', '铺位号/点位号', '商户名称', '应交费项', '应收金额（含税）'])
  const out: ParsedRow[] = []
  for (const row of rows.slice(index + 1)) {
    const shopNo = canonicalShopNo(text(row, columns, '铺位号/点位号'), text(row, columns, '楼层'))
    const due = toCents(text(row, columns, '应收金额（含税）'))
    if (shopNo === '' || due === undefined) continue
    const period = isoDate(row[columns.get('账期') ?? -1] ?? null)
    const range = periodRange(text(row, columns, '本期应缴租期'))
    const label = text(row, columns, '应交费项')
    out.push({
      shopNo,
      name: text(row, columns, '商户名称'),
      brand: text(row, columns, '品牌'),
      floor: text(row, columns, '楼层'),
      feeType: feeTypeOf(label, unknown),
      feeLabel: label,
      period: period === undefined ? (range.start === undefined ? '' : monthOf(range.start)) : monthOf(period),
      periodStart: range.start,
      periodEnd: range.end,
      dueDate: isoDate(row[columns.get('应收日期（账期）') ?? -1] ?? null),
      due,
      relief: toCents(text(row, columns, '减免金额（含税）')) ?? 0,
      received: toCents(text(row, columns, '已收金额')) ?? 0,
      unpaid: toCents(text(row, columns, '未收金额')) ?? 0,
      raw: JSON.stringify(row),
    })
  }
  return out
}

function parseUtilitySheet(rows: readonly Row[], unknown: Set<string>): ParsedRow[] {
  const { index, columns } = findHeader(rows, ['账期', '铺位号/点位号', '收费项目', '应交费项', '应收金额', '已收金额合计', '未收金额'])
  const out: ParsedRow[] = []
  for (const row of rows.slice(index + 1)) {
    const shopNo = canonicalShopNo(text(row, columns, '铺位号/点位号'), text(row, columns, '楼层'))
    const due = toCents(text(row, columns, '应收金额'))
    if (shopNo === '' || due === undefined) continue
    const period = isoDate(row[columns.get('账期') ?? -1] ?? null)
    const range = periodRange(text(row, columns, '本期应缴租期'))
    const label = text(row, columns, '应交费项') || text(row, columns, '收费项目')
    out.push({
      shopNo,
      name: '',
      brand: text(row, columns, '品牌'),
      floor: text(row, columns, '楼层'),
      feeType: feeTypeOf(label, unknown),
      feeLabel: label,
      period: period === undefined ? (range.start === undefined ? '' : monthOf(range.start)) : monthOf(period),
      periodStart: range.start,
      periodEnd: range.end,
      dueDate: undefined,
      due,
      relief: 0,
      received: toCents(text(row, columns, '已收金额合计')) ?? toCents(text(row, columns, '已收金额')) ?? 0,
      unpaid: toCents(text(row, columns, '未收金额')) ?? 0,
      raw: JSON.stringify(row),
    })
  }
  return out
}

/**
 * Import both sheets: upsert merchants, replace this file's receivable rows.
 * @param db - open database.
 * @param wb - the workbook.
 * @returns counts.
 */
export function importReceivable(db: DatabaseSync, wb: Workbook): ReceivableImportResult {
  const unknown = new Set<string>()
  const parsed: ParsedRow[] = []
  const sheets: string[] = []
  for (const [name, rows] of wb.sheets) {
    if (rows.length < 2) continue
    const header = rows.slice(0, 3).flat().filter((c): c is string => typeof c === 'string').map(c => c.replace(/\s+/g, ''))
    if (header.includes('应收金额（含税）')) { sheets.push(name); parsed.push(...parseRentSheet(rows, unknown)) }
    else if (header.includes('收费项目')) { sheets.push(name); parsed.push(...parseUtilitySheet(rows, unknown)) }
  }
  return transaction(db, () => {
    const batch = insertBatch(db, 'receivable', wb.file, wb.sha256, parsed.length)
    const merchantIds = new Map<string, string>()
    // Rent rows carry the contracting party; import them first so utility rows do not blank the name.
    const ordered = [...parsed].sort((a, b) => (b.name === '' ? 0 : 1) - (a.name === '' ? 0 : 1))
    for (const r of ordered) {
      if (!merchantIds.has(r.shopNo)) merchantIds.set(r.shopNo, upsertMerchant(db, r.shopNo, r.name || r.brand, r.brand, r.floor))
      else if (r.name !== '') upsertMerchant(db, r.shopNo, r.name, r.brand, r.floor)
    }
    const insert = db.prepare(`INSERT INTO receivable
      (id, merchant_id, fee_type, period, period_start, period_end, due_date, amount_due, amount_relief, amount_received, amount_unpaid, source_row)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    let skipped = 0
    for (const r of parsed) {
      const merchantId = merchantIds.get(r.shopNo)
      if (merchantId === undefined) { skipped++; continue }
      insert.run(
        newId('rcv'), merchantId, r.feeType, r.period, r.periodStart ?? null, r.periodEnd ?? null, r.dueDate ?? null,
        r.due, r.relief, r.received, r.unpaid, r.raw,
      )
    }
    return {
      batchId: batch.id,
      sheets,
      merchants: merchantIds.size,
      receivables: parsed.length - skipped,
      skipped,
      unknownFeeLabels: [...unknown],
    }
  })
}
