/**
 * Real-data acceptance for step 2: import every sample file into an in-memory
 * database and check the settlement chain ties out. Run from the repo root:
 *   node --import tsx/esm packages/hongyang/finance/tests/import.smoke.ts
 */

import { resolve } from 'node:path'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { importFile } from '../src/provider/import/index.ts'

const SAMPLES = resolve(import.meta.dirname, '../../../../docs/hongyang/samples')
const FILES = [
  '租费应收明细表.xlsx',
  '建行流水_2026-04-01_08.xls',
  '微信小程序1693395706_2_1_All_2026-04-01_2026-04-30.csv',
  '微信小程序1723333380_2_1_All_2026-04-01_2026-04-30.csv',
  'pos扫码 2026.4.1-2026.4.30.xlsx',
  '充值记录(2026.4.1-30).xls',
  '2026.4.1-4.30收入日报表.xlsx',
  '凭证_2026-04-01_08.xlsx',
]

const db = await openFinanceDatabase(':memory:')
for (const name of FILES) {
  const outcome = await importFile(db, resolve(SAMPLES, name))
  const { kind } = outcome
  if (outcome.duplicate) { console.log(`${name}: duplicate`); continue }
  const summary = 'split' in outcome
    ? `${JSON.stringify(outcome.result)} | split matched ${String(outcome.split.matched.length)} unmatched ${String(outcome.split.unmatched.length)}`
    : JSON.stringify(outcome.result)
  console.log(`\n[${kind}] ${name}\n  ${summary}`)
  if ('split' in outcome && outcome.split.unmatched.length > 0) {
    for (const u of outcome.split.unmatched) console.log('  UNMATCHED', JSON.stringify(u))
  }
}
const count = (sql: string): unknown => db.prepare(sql).get()
console.log('\ncounts:', count(`SELECT
  (SELECT COUNT(*) FROM merchant) AS merchants,
  (SELECT COUNT(*) FROM receivable) AS receivables,
  (SELECT COUNT(*) FROM "transaction") AS transactions,
  (SELECT COUNT(*) FROM "transaction" WHERE status = 'settlement') AS settlements,
  (SELECT COUNT(*) FROM "transaction" WHERE status = 'pending') AS pending,
  (SELECT COUNT(*) FROM "transaction" WHERE status = 'ignored') AS ignored,
  (SELECT COUNT(*) FROM platform_txn WHERE transaction_id IS NOT NULL) AS linked_details,
  (SELECT COUNT(*) FROM platform_txn WHERE platform = 'wechat' AND shop_no IS NOT NULL) AS wechat_with_shop,
  (SELECT COUNT(*) FROM ledger_row) AS ledger_rows,
  (SELECT COUNT(*) FROM voucher_row) AS voucher_rows`))
console.log('多经收入 shops in ledger:', db.prepare('SELECT shop_no, brand, amounts FROM ledger_row WHERE shop_no LIKE \'QT-%\' OR brand LIKE \'%艾力斯特%\' LIMIT 6').all())
console.log('sample merchants:', db.prepare('SELECT shop_no, name, brand, floor FROM merchant WHERE shop_no IN (?, ?, ?, ?)').all('5F-5008', '1F-1052', '5002A,5002B', '3033'))
console.log('pending transfers:', db.prepare('SELECT payer_name, amount, remark FROM "transaction" WHERE status = \'pending\' ORDER BY txn_time').all())
