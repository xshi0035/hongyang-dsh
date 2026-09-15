import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { allocate } from '../src/provider/claim/allocate.ts'
import { correctAllocation } from '../src/provider/claim/correct.ts'
import { confirmClaim, runClaims } from '../src/provider/claim/engine.ts'
import { readDailyReport } from '../src/provider/report/daily-report.ts'
import { receiptDate } from '../src/provider/report/receipt-date.ts'
import { workbenchSummary } from '../src/provider/query/workbench.ts'
import { buildVoucher } from '../src/provider/voucher/build.ts'
import { saveVoucherDraft, voucherQueue, withdrawVoucherDraft } from '../src/provider/voucher/queue.ts'
import type { MerchantId, TransactionId } from '../src/service/identifiers.ts'

const actor = { kind: 'web', id: 'reviewer' } as const
const config = { outputTaxSubject13: '2221.01.02.13', outputTaxSubject3: '2221.01.02.03' }
async function fixture() {
  const db = await openFinanceDatabase(':memory:')
  db.exec(`INSERT INTO merchant(id,shop_no,name) VALUES('m','101','合同主体');
    INSERT INTO "transaction"(id,source,channel,txn_time,amount,status,merchant_id) VALUES
      ('rent','bank2038','transfer','2026-04-03',21500,'auto','m'),
      ('collect','pos','transfer','2026-04-03',154700,'manual',NULL),
      ('other','bank2038','transfer','2026-04-03',10000,'auto','m');`)
  const rows = allocate(db, { transactionId: 'rent' as TransactionId, merchantId: 'm' as MerchantId, amount: 21500, origin: 'engine', splits: [{ feeType: 'rent', amount: 21500 }] })
  allocate(db, { transactionId: 'collect' as TransactionId, merchantId: undefined, amount: 154700, origin: 'user', wholeFee: 'uone_collection' })
  allocate(db, { transactionId: 'other' as TransactionId, merchantId: 'm' as MerchantId, amount: 10000, origin: 'engine', splits: [{ feeType: 'guarantee', amount: 10000 }] })
  return { db, correction: { requestId: 'review-1', itemId: 'txn:rent', shopNo: '101', reason: '人工确认租费拆分', expectedAllocationIds: rows.map(row => row.id), splits: [{ feeType: 'rent' as const, amount: 10900, periodStart: '2026-03-01', periodEnd: '2026-05-31' }, { feeType: 'service' as const, amount: 10600, periodStart: '2026-03-01', periodEnd: '2026-05-31' }] } }
}

await test('selected rent/service and UONE receipts make nine lines and leave other money pending', async () => {
  const { db, correction } = await fixture()
  try {
    const after = correctAllocation(db, correction, actor)
    assert.deepEqual(correctAllocation(db, correction, actor), after)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocation_revision').get()?.n, 1)
    const ids = ['rent|m', 'collect|']
    const saved = saveVoucherDraft(db, '2026-04-03', ids, config, actor)
    assert.equal(saved.lines.length, 9)
    assert.equal(saved.checks.balanced, true)
    assert.deepEqual(saved.lines.filter(line => line.subject === '2241.12').map(line => line.credit), [154700])
    assert.equal(saved.lines.filter(line => line.summary.includes('UONE') && line.subject.startsWith('2221')).length, 0)
    assert.equal(saveVoucherDraft(db, '2026-04-03', ids, config, actor).id, saved.id)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM voucher').get()?.n, 1)
    const queue = voucherQueue(db, '2026-04-03')
    assert.equal(queue.draftedCount, 2); assert.equal(queue.pendingCount, 1); assert.equal(queue.pendingAmount, 10000)
    assert.equal(saved.coverage.totalAmount, 186200)
    assert.equal(saved.coverage.selectedAmount, 176200)
    assert.throws(() => saveVoucherDraft(db, '2026-04-03', ['rent|m', 'other|m'], config, actor), /已有凭证/)
    assert.throws(() => correctAllocation(db, { ...correction, requestId: 'review-2', expectedAllocationIds: after.map(row => row.id) }, actor), /已有凭证/)
    assert.throws(() => buildVoucher(db, '2026-04-03', config, []), /至少一笔/)
    assert.throws(() => buildVoucher(db, '2026-04-04', config, ids), /不属于该日期/)
    assert.throws(() => buildVoucher(db, '2026-04-03', config, ['rent|m', 'rent|m']), /重复/)
    const stable = { lines: saved.lines.map(line => ({ subject: line.subject, debit: line.debit, credit: line.credit })),
      coverage: saved.coverage }
    assert.equal(JSON.stringify(stable, null, 2) + '\n', await readFile(new URL('./expected/selected-voucher.json', import.meta.url), 'utf8'))
    withdrawVoucherDraft(db, saved.id, '重选收款，原草稿保留', actor)
    withdrawVoucherDraft(db, saved.id, '重选收款，原草稿保留', actor)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM voucher_void').get()?.n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM voucher').get()?.n, 1)
    assert.equal(voucherQueue(db, '2026-04-03').pendingCount, 3)
    assert.notEqual(saveVoucherDraft(db, '2026-04-03', ids, config, actor).id, saved.id)
  } finally { db.close() }
})

await test('correction rejects stale or invalid splits and rolls back when audit fails', async () => {
  const { db, correction } = await fixture()
  try {
    const before = db.prepare('SELECT * FROM allocation ORDER BY id').all()
    assert.throws(() => correctAllocation(db, { ...correction, expectedAllocationIds: [] }, actor), /已变化/)
    assert.throws(() => correctAllocation(db, { ...correction, splits: [{ feeType: 'rent', amount: -1 }, { feeType: 'service', amount: 21501 }] }, actor), /正整数/)
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON activity_log BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
    assert.throws(() => correctAllocation(db, correction, actor), /audit unavailable/)
    assert.deepEqual(db.prepare('SELECT * FROM allocation ORDER BY id').all(), before)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocation_revision').get()?.n, 0)
    db.exec('DROP TRIGGER fail_audit')
    correctAllocation(db, correction, actor)
    assert.throws(() => correctAllocation(db, { ...correction, reason: 'changed' }, actor), /不能更改/)
  } finally { db.close() }
})

await test('parking business day changes reports and voucher queues without changing arrival time', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    db.exec(`INSERT INTO "transaction"(id,source,channel,txn_time,amount,status,remark)
      VALUES('p','bank2038','parking','2026-04-03 14:44:03',150258,'pending','8124552商户@20260401#停车费');`)
    runClaims(db)
    assert.equal(readDailyReport(db, '2026-04-03').rows.length, 0)
    const business = readDailyReport(db, '2026-04-01')
    assert.equal(business.grandTotal, 150258)
    assert.match(business.rows[0]?.remark ?? '', /业务日归属，待财务复核；到账日 2026-04-03/)
    assert.equal(voucherQueue(db, '2026-04-01').pendingAmount, 150258)
    assert.deepEqual(workbenchSummary(db, '2026-04-01', { overdueDays: 30, extraTodos: [] }).receipts, [{ source: '银行转账2038', count: 1, cents: 150258 }])
    assert.deepEqual(workbenchSummary(db, '2026-04-03', { overdueDays: 30, extraTodos: [] }).receipts, [])
    assert.equal(db.prepare('SELECT txn_time FROM "transaction"').get()?.txn_time, '2026-04-03 14:44:03')
    assert.deepEqual(receiptDate('2026-04-03', 'parking', '@20260230#停车费'), { date: '2026-04-03', businessDay: false })
    assert.deepEqual(receiptDate('2026-04-03', 'transfer', '@20260401#停车费'), { date: '2026-04-03', businessDay: false })
  } finally { db.close() }
})

await test('explicit POS parking remark books as parking without guessing a brand owner; unlabelled orders stay unclaimed', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    db.exec(`INSERT INTO "transaction"(id,source,channel,txn_time,amount,status) VALUES('s','bank2038','unionpay','2026-04-04',229700,'settlement');
      INSERT INTO platform_txn(id,transaction_id,platform,merchant_account,order_no,txn_time,amount,net,note) VALUES
      ('p','s','pos','pos','p','2026-04-03',100000,99750,'2026-04-03|发发桌球停车（预存）'),
      ('u','s','pos','pos','u','2026-04-03',154700,154300,'2026-04-03|'),
      ('z','s','pos','pos','z','2026-04-03',75000,74800,'2026-04-03|');`)
    assert.equal(runClaims(db).posAuto, 1)
    assert.equal(runClaims(db).posAuto, 0)
    assert.deepEqual({ ...db.prepare('SELECT merchant_id,fee_type,amount_incl_tax FROM allocation').get() }, { merchant_id: null, fee_type: 'parking', amount_incl_tax: 100000 })
    const queue = voucherQueue(db, '2026-04-03')
    assert.equal(queue.unclaimedCount, 2); assert.equal(queue.unclaimedAmount, 229700)
    assert.equal(queue.receipts.some(row => row.amounts.uone_collection !== undefined), false)
  } finally { db.close() }
})

await test('human confirmation learns only the exact payer while preserving the contracted merchant name', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    db.exec(`INSERT INTO merchant(id,shop_no,name) VALUES('m','1011','衡阳讯飞');
      INSERT INTO "transaction"(id,source,channel,txn_time,amount,payer_name,status) VALUES('t','bank2038','transfer','2026-04-03',200000,'衡阳欣飞','pending');`)
    confirmClaim(db, 'txn:t', '1011', [{ feeType: 'elec_pre', amount: 200000 }], 'user')
    assert.equal(db.prepare('SELECT name FROM merchant').get()?.name, '衡阳讯飞')
    assert.deepEqual({ ...db.prepare('SELECT payer_name,confirmed,merchant_id FROM payer_mapping').get() }, { payer_name: '衡阳欣飞', confirmed: 1, merchant_id: 'm' })
    assert.equal(db.prepare('SELECT fee_type FROM allocation').get()?.fee_type, 'elec_pre')
  } finally { db.close() }
})
