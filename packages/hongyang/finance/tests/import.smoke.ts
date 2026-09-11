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

// ---- step 3: claim engine on the same data ----
const { runClaims, listPending, confirmClaim } = await import('../src/provider/claim/engine.ts')
const run = runClaims(db)
console.log('\nclaims run:', { bankReviewed: run.bankReviewed, bankAuto: run.bankAuto, parkingAuto: run.parkingAuto, wechatElectricity: run.wechatElectricity, wechatParking: run.wechatParking, posAuto: run.posAuto, pending: run.pending.length, unlabelledPos: run.unlabelledPos.reduce((s, u) => s + u.count, 0) })
for (const a of run.autoBooked) console.log('  AUTO', a.payerName, (a.amount / 100).toFixed(2), '→', a.shopNo, a.name, '|', a.booked, '|', a.confidence)
for (const p of run.pending.filter(p => p.kind === 'bank')) console.log('  PENDING', p.date, p.payerName, (p.amount / 100).toFixed(2), JSON.stringify(p.remark), '→', p.suggestions.map(s => `${s.shopNo} ${s.name}(${s.brand}) ${s.confidence} ${s.reason}`).join(' | ') || 'none')
console.log('brand lookups:', db.prepare('SELECT shop_no, name, brand FROM merchant WHERE brand LIKE \'%弹珠%\' OR brand LIKE \'%哈乐%\' OR name LIKE \'%欣飞%\' OR brand LIKE \'%君优%\' OR name LIKE \'%君优%\' OR brand LIKE \'%飞科%\' OR brand LIKE \'%李宁%\'').all())
const tu = run.pending.find(p => p.payerName === '涂小兰')
if (tu !== undefined) {
  const c = confirmClaim(db, tu.itemId, tu.suggestions[0]?.shopNo ?? '5002A,5002B', undefined, 'user')
  console.log('\nconfirm 涂小兰 →', c.merchant?.shopNo, c.merchant?.name, '|', c.booked, '| learned', c.learned)
  console.log('payer_mapping:', db.prepare('SELECT payer_name, merchant_id, confirmed FROM payer_mapping').all())
}
console.log('after confirm pending:', listPending(db).pending.length)
console.log('allocation by fee:', db.prepare('SELECT fee_type, COUNT(*) n, SUM(amount_incl_tax) cents FROM allocation GROUP BY fee_type ORDER BY cents DESC').all())

// ---- step 4: daily report vs ledger ----
const { buildDailyReport, compareDailyReport, exportDailyReport } = await import('../src/provider/report/daily-report.ts')
for (const day of ['2026-04-01', '2026-04-03']) {
  const report = buildDailyReport(db, day)
  const cmp = compareDailyReport(db, report, 1)
  console.log(`\nreport ${day}: rows ${String(report.rows.length)} total ${(report.grandTotal / 100).toFixed(2)} | ledger rows ${String(cmp.ledgerRows)} total ${(cmp.ledgerTotal / 100).toFixed(2)} | matched ${String(cmp.matched)} missing ${String(cmp.diffs.filter(d => d.kind === 'missing').length)} extra ${String(cmp.diffs.filter(d => d.kind === 'extra').length)} amount ${String(cmp.diffs.filter(d => d.kind === 'amount').length)}`)
  for (const d of cmp.diffs.slice(0, 14)) console.log('  DIFF', d.kind, d.shopNo, d.merchantName, d.source, d.reportAmount === undefined ? '—' : (d.reportAmount / 100).toFixed(2), '/', d.ledgerAmount === undefined ? '—' : (d.ledgerAmount / 100).toFixed(2))
  if (day === '2026-04-03') console.log('  exported:', await exportDailyReport(report, '/private/tmp/claude-501/-Users-shixin-Desktop---dsh/4cda5cd3-459c-46a0-a02a-1769faeee997/scratchpad/hy-reports'))
}
