/**
 * China Construction Bank statement (`建行账户.xls`): one sheet per account
 * (`建行2038`, `建行2035`). Only credits (`贷方发生额（收入）` > 0) are money in;
 * each becomes a `transaction` whose channel is decided from the counterparty
 * name so the settlement splitter and the claim engine know what it is.
 * @module @deepseek-ai/dsh-hy-finance/provider/import/bank-ccb
 */

import type { DatabaseSync } from 'node:sqlite'
import { newId, type BatchId } from '../../service/identifiers.ts'
import type { Channel, Source, Transaction } from '../../service/types.ts'
import { toCents } from '../../rules/tax.ts'
import { findHeader, isoDateTime, text, type Workbook } from './read-sheet.ts'
import { insertBatch, insertTransaction, transaction } from '../db/repo.ts'

const REQUIRED = ['账户名称', '交易时间', '贷方发生额（收入）', '对方户名', '备注']

/** Sheet name → report source. */
const SHEET_SOURCES: Readonly<Record<string, Source>> = { '建行2038': 'bank2038', '建行2035': 'bank2035' }

/**
 * Decide the counterparty class from the payer name.
 * @param payerName - Payer name matched exactly.
 * @returns Receipt channel used for settlement processing.
 */
export function channelOf(payerName: string): Channel {
  if (payerName.includes('衡阳诚远')) return 'internal'
  if (payerName.includes('财付通')) return 'tenpay'
  if (payerName.includes('银联商务')) return 'unionpay'
  if (payerName.includes('停车')) return 'parking'
  if (payerName.includes('抖音')) return 'douyin'
  return 'transfer'
}

/** Result of one bank import. */
export interface BankImportResult {
  readonly batchId: BatchId
  readonly sheets: string[]
  readonly credits: number
  readonly inserted: number
  readonly duplicates: number
  readonly byChannel: Record<Channel, number>
}

/**
 * Import every credit row of the recognised account sheets.
 * @param db - open database.
 * @param wb - the statement workbook.
 * @returns counts.
 */
export function importBankCcb(db: DatabaseSync, wb: Workbook): BankImportResult {
  const sheets: string[] = []
  const pending: Transaction[] = []
  for (const [name, rows] of wb.sheets) {
    const source = SHEET_SOURCES[name]
    if (source === undefined) continue
    sheets.push(name)
    const { index, columns } = findHeader(rows, REQUIRED)
    for (const row of rows.slice(index + 1)) {
      const amount = toCents(text(row, columns, '贷方发生额（收入）'))
      if (amount === undefined || amount <= 0) continue
      const payerName = text(row, columns, '对方户名')
      const remark = [text(row, columns, '备注'), text(row, columns, '摘要')].filter(s => s.length > 0).join(' | ')
      pending.push({
        id: newId('txn'),
        batchId: undefined,
        source,
        channel: channelOf(payerName),
        txnTime: isoDateTime(text(row, columns, '交易时间')) ?? `${text(row, columns, '记账日期')} 00:00:00`,
        amount,
        payerName,
        payerAccount: text(row, columns, '对方账号'),
        remark,
        txnNo: text(row, columns, '账户明细编号-交易流水号'),
        parentId: undefined,
        status: 'pending',
        merchantId: undefined,
        confidence: 0,
        raw: JSON.stringify(Object.fromEntries([...columns].map(([label, col]) => [label, row[col] ?? null]))),
      })
    }
  }
  return transaction(db, () => {
    const batch = insertBatch(db, 'bank_ccb', wb.file, wb.sha256, pending.length)
    let inserted = 0
    const byChannel: Record<Channel, number> = { tenpay: 0, unionpay: 0, parking: 0, douyin: 0, internal: 0, transfer: 0 }
    for (const t of pending) {
      const status: Transaction['status'] = t.channel === 'douyin' || t.channel === 'internal' ? 'ignored' : t.status
      if (insertTransaction(db, { ...t, batchId: batch.id, status })) {
        inserted++
        byChannel[t.channel]++
      }
    }
    return { batchId: batch.id, sheets, credits: pending.length, inserted, duplicates: pending.length - inserted, byChannel }
  })
}
