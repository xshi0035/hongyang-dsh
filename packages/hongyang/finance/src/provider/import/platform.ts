/**
 * Platform statements: WeChat merchant-platform CSV (one per merchant
 * account), UnionPay POS reconciliation xlsx, and the electricity-meter
 * recharge log. Each order becomes a `platform_txn`; the settlement splitter
 * later ties them to the bank credit that paid them out.
 * @module @deepseek-ai/dsh-hy-finance/provider/import/platform
 */

import type { DatabaseSync } from 'node:sqlite'
import { newId, type BatchId, type PlatformTxnId } from '../../service/identifiers.ts'
import type { PlatformTxn } from '../../service/types.ts'
import { toCents } from '../../rules/tax.ts'
import { FinanceError } from '../../service/errors.ts'
import { findHeader, isoDate, isoDateTime, text, type Row, type Workbook } from './read-sheet.ts'
import { insertBatch, insertPlatformTxn, transaction } from '../db/repo.ts'

/** Result of one platform import. */
export interface PlatformImportResult {
  readonly batchId: BatchId
  readonly platform: PlatformTxn['platform'] | 'recharge'
  readonly merchantAccounts: string[]
  readonly orders: number
  readonly inserted: number
  readonly duplicates: number
  /** Sum of `net` over inserted rows, cents. */
  readonly netTotal: number
  /** Orders whose note names a merchant and shop. */
  readonly withMerchantHint: number
}

/**
 * Parse the merchant hint the electricity mini-program writes into the order
 * name: `商户:趣捞鱼-3033 电表:1` → name `趣捞鱼`, shop `3033`. The recharge log
 * writes `宝宝来当家-3022` / `许府牛-5003-1`.
 * @param note - order name or recharge merchant cell.
 * @returns the hint pieces, or `undefined` when the note carries none.
 */
export function parseMerchantHint(note: string): { name: string; shopNo: string } | undefined {
  const m = /商户[:：]\s*(.+?)\s*(?:电表|$)/.exec(note)
  const body = m === null ? note.trim() : m[1] ?? ''
  const dash = /^(.+?)-([0-9A-Za-z][0-9A-Za-z-]*)$/.exec(body)
  if (dash === null) return undefined
  return { name: (dash[1] ?? '').trim(), shopNo: (dash[2] ?? '').trim() }
}

function finish(
  db: DatabaseSync, wb: Workbook, kind: 'wechat' | 'unionpay_pos' | 'recharge', platform: PlatformImportResult['platform'], rows: PlatformTxn[],
): PlatformImportResult {
  return transaction(db, () => {
    const batch = insertBatch(db, kind, wb.file, wb.sha256, rows.length)
    let inserted = 0
    let netTotal = 0
    let withHint = 0
    for (const p of rows) {
      if (insertPlatformTxn(db, p)) {
        inserted++
        netTotal += p.net
        if (p.shopNo !== undefined) withHint++
      }
    }
    return {
      batchId: batch.id,
      platform,
      merchantAccounts: [...new Set(rows.map(r => r.merchantAccount))],
      orders: rows.length,
      inserted,
      duplicates: rows.length - inserted,
      netTotal,
      withMerchantHint: withHint,
    }
  })
}

/**
 * WeChat merchant platform statement (GBK CSV). Only `SUCCESS` orders count;
 * `net` = 应结订单金额 − 手续费 is what Tenpay pays out the next day.
 * @param db - open database.
 * @param wb - the CSV as a workbook.
 * @returns counts.
 */
export function importWechat(db: DatabaseSync, wb: Workbook): PlatformImportResult {
  const rows = wb.sheets.get('csv') ?? [...wb.sheets.values()][0]
  if (rows === undefined) throw new FinanceError('SHEET_NOT_FOUND', 'empty WeChat statement')
  const { index, columns } = findHeader(rows, ['交易时间', '商户号', '微信订单号', '交易状态', '应结订单金额', '手续费', '商品名称'])
  const out: PlatformTxn[] = []
  for (const row of rows.slice(index + 1)) {
    if (text(row, columns, '交易状态') !== 'SUCCESS') continue
    const time = isoDateTime(text(row, columns, '交易时间'))
    const amount = toCents(text(row, columns, '应结订单金额'))
    const fee = toCents(text(row, columns, '手续费')) ?? 0
    if (time === undefined || amount === undefined) continue
    const note = text(row, columns, '商品名称')
    const hint = parseMerchantHint(note)
    out.push({
      id: newId<PlatformTxnId>('ptx'),
      transactionId: undefined,
      platform: 'wechat',
      merchantAccount: text(row, columns, '商户号'),
      orderNo: text(row, columns, '微信订单号'),
      txnTime: time,
      amount,
      fee,
      net: amount - fee,
      note,
      merchantHint: hint === undefined ? '' : `${hint.name}-${hint.shopNo}`,
      shopNo: hint?.shopNo,
      merchantId: undefined,
    })
  }
  return finish(db, wb, 'wechat', 'wechat', out)
}

/**
 * UnionPay POS reconciliation sheet. Row 1 is a totals banner, row 2 the
 * header. `清算时间` (YYYYMMDD) is the settlement day the bank credit refers to.
 * @param db - open database.
 * @param wb - the workbook.
 * @returns counts.
 */
export function importUnionPayPos(db: DatabaseSync, wb: Workbook): PlatformImportResult {
  const rows = [...wb.sheets.values()][0]
  if (rows === undefined) throw new FinanceError('SHEET_NOT_FOUND', 'empty POS statement')
  const { index, columns } = findHeader(rows, ['清算时间', '交易时间', '交易金额', '清算金额', '手续费', '商户号', '付款附言'])
  const out: PlatformTxn[] = []
  for (const row of rows.slice(index + 1)) {
    const amount = toCents(text(row, columns, '交易金额'))
    const net = toCents(text(row, columns, '清算金额'))
    const settleDay = isoDate(text(row, columns, '清算时间'))
    if (amount === undefined || net === undefined || settleDay === undefined) continue
    const type = text(row, columns, '交易类型')
    if (type !== '' && type !== '消费') continue
    const note = text(row, columns, '付款附言')
    const orderNo = text(row, columns, '银商订单号') || text(row, columns, '流水号')
    out.push({
      id: newId<PlatformTxnId>('ptx'),
      transactionId: undefined,
      platform: 'pos',
      merchantAccount: text(row, columns, '商户号'),
      orderNo,
      // The settlement day drives matching; keep the real transaction time in the note-free `txn_time` when present.
      txnTime: isoDateTime(text(row, columns, '交易时间')) ?? `${settleDay} 00:00:00`,
      amount,
      fee: toCents(text(row, columns, '手续费')) ?? amount - net,
      net,
      note: noteOf(note, settleDay),
      merchantHint: '',
      shopNo: undefined,
      merchantId: undefined,
    })
  }
  return finish(db, wb, 'unionpay_pos', 'pos', out)
}

/** Keep the settlement day with the note so the splitter can read it back without another column. */
function noteOf(note: string, settleDay: string): string {
  const cleaned = note === '衡阳诚远商业管理有限公司' ? '' : note
  return `${settleDay}|${cleaned}`
}

/**
 * Electricity-meter recharge log (`充值记录.xls`): who topped up which meter,
 * how, and when. Rows paid by WeChat duplicate the WeChat statement's orders
 * but carry the meter number; they are stored under platform `recharge` for
 * cross-reference only and never counted as money.
 * @param db - open database.
 * @param wb - the workbook.
 * @returns counts.
 */
export function importRecharge(db: DatabaseSync, wb: Workbook): PlatformImportResult {
  const rows = [...wb.sheets.values()][0]
  if (rows === undefined) throw new FinanceError('SHEET_NOT_FOUND', 'empty recharge log')
  const { index, columns } = findHeader(rows, ['商户', '电表编号', '充值金额', '充值时间', '充值方式'])
  const out: PlatformTxn[] = []
  for (const row of rows.slice(index + 1)) {
    const amount = toCents(text(row, columns, '充值金额'))
    const time = isoDateTime(text(row, columns, '充值时间'))
    if (amount === undefined || time === undefined) continue
    const merchant = text(row, columns, '商户')
    const hint = parseMerchantHint(merchant)
    out.push({
      id: newId<PlatformTxnId>('ptx'),
      transactionId: undefined,
      platform: 'wechat',
      merchantAccount: 'recharge',
      orderNo: `${text(row, columns, 'NO')}@${time}`,
      txnTime: time,
      amount,
      fee: 0,
      net: 0,
      note: `${text(row, columns, '充值方式')}|电表${text(row, columns, '电表编号')}|${merchant}`,
      merchantHint: hint === undefined ? merchant : `${hint.name}-${hint.shopNo}`,
      shopNo: hint?.shopNo,
      merchantId: undefined,
    })
  }
  return finish(db, wb, 'recharge', 'recharge', out)
}

/** Whether a header row looks like a WeChat statement; used by kind detection. */
export function looksLikeWechat(rows: readonly Row[]): boolean {
  return rows.slice(0, 3).some(r => r.some(c => typeof c === 'string' && c.includes('微信订单号')))
}
