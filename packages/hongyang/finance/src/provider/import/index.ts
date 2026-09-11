/**
 * Import entry: detect what a client file is, run the matching importer, and
 * re-run settlement splitting whenever a bank statement or platform
 * statement arrived. Re-importing an identical file is a no-op that returns
 * the earlier batch.
 * @module @deepseek-ai/dsh-hy-finance/provider/import
 */

import type { DatabaseSync } from 'node:sqlite'
import { basename } from 'node:path'
import { FinanceError } from '../../service/errors.ts'
import type { ImportKind } from '../../service/types.ts'
import { findBatchBySha } from '../db/repo.ts'
import { splitSettlements, type SplitResult } from '../split/settlement.ts'
import { importBankCcb, type BankImportResult } from './bank-ccb.ts'
import { importRecharge, importUnionPayPos, importWechat, looksLikeWechat, type PlatformImportResult } from './platform.ts'
import { importLedger, importVoucherXlsx, type ReferenceImportResult } from './reference.ts'
import { importReceivable, type ReceivableImportResult } from './receivable.ts'
import { readWorkbook, normalizeLabel, type Workbook } from './read-sheet.ts'

/** Outcome of one `importFile` call. */
export type ImportOutcome =
  | { kind: 'bank_ccb'; duplicate: false; result: BankImportResult; split: SplitResult }
  | { kind: 'wechat' | 'unionpay_pos' | 'recharge'; duplicate: false; result: PlatformImportResult; split: SplitResult }
  | { kind: 'receivable'; duplicate: false; result: ReceivableImportResult }
  | { kind: 'ledger' | 'voucher'; duplicate: false; result: ReferenceImportResult }
  | { kind: ImportKind; duplicate: true; batchId: string; importedAt: string }

/**
 * Decide the file kind from its name and header cells.
 * @param wb - the workbook.
 * @returns the kind, or `undefined` when nothing matches.
 */
export function detectKind(wb: Workbook): ImportKind | undefined {
  const name = basename(wb.file)
  const heads = new Set<string>()
  for (const rows of wb.sheets.values()) {
    for (const row of rows.slice(0, 4)) for (const c of row) if (typeof c === 'string') heads.add(normalizeLabel(c))
  }
  const has = (...labels: string[]): boolean => labels.every(l => heads.has(l))
  if (wb.sheets.has('建行2038') || wb.sheets.has('建行2035') || has('贷方发生额（收入）', '对方户名')) return 'bank_ccb'
  if (looksLikeWechat([...wb.sheets.values()][0] ?? []) || has('微信订单号', '应结订单金额')) return 'wechat'
  if (has('清算时间', '清算金额', '付款附言')) return 'unionpay_pos'
  if (has('电表编号', '充值金额', '充值方式')) return 'recharge'
  if (has('应交费项', '应收金额（含税）') || has('收费项目', '应交费项')) return 'receivable'
  if (has('收款金额小计', '收款来源')) return 'ledger'
  if (has('凭证字', '凭证号', '科目编码', '借方金额')) return 'voucher'
  if (name.includes('平安')) return 'pingan'
  return undefined
}

/**
 * Import one file.
 * @param db - open database.
 * @param file - absolute path.
 * @param kind - explicit kind; detected from content when omitted.
 * @returns the outcome.
 * @throws {FinanceError} `UNSUPPORTED_FILE` when the kind cannot be decided or is not importable.
 */
export async function importFile(db: DatabaseSync, file: string, kind?: ImportKind): Promise<ImportOutcome> {
  const wb = await readWorkbook(file)
  const resolved = kind ?? detectKind(wb)
  if (resolved === undefined) throw new FinanceError('UNSUPPORTED_FILE', `cannot tell what kind of file this is: ${basename(file)}`)
  const existing = findBatchBySha(db, wb.sha256)
  if (existing !== undefined) return { kind: existing.kind, duplicate: true, batchId: existing.id, importedAt: existing.importedAt }
  switch (resolved) {
    case 'bank_ccb': return { kind: resolved, duplicate: false, result: importBankCcb(db, wb), split: splitSettlements(db) }
    case 'wechat': return { kind: resolved, duplicate: false, result: importWechat(db, wb), split: splitSettlements(db) }
    case 'unionpay_pos': return { kind: resolved, duplicate: false, result: importUnionPayPos(db, wb), split: splitSettlements(db) }
    case 'recharge': return { kind: resolved, duplicate: false, result: importRecharge(db, wb), split: splitSettlements(db) }
    case 'receivable': return { kind: resolved, duplicate: false, result: importReceivable(db, wb) }
    case 'ledger': return { kind: resolved, duplicate: false, result: importLedger(db, wb) }
    case 'voucher': return { kind: resolved, duplicate: false, result: importVoucherXlsx(db, wb) }
    case 'pingan': throw new FinanceError('UNSUPPORTED_FILE', '平安银行结算单暂不导入：停车费按建行流水里的捷停车到账记账')
    default: {
      const never: never = resolved
      throw new FinanceError('UNSUPPORTED_FILE', String(never))
    }
  }
}
