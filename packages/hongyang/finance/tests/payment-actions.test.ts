import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { submitPayment, decidePayment, paymentReviewDetails } from '../src/provider/register/submission.ts'
import { reversePayment, reversiblePayments } from '../src/provider/register/reversal.ts'
import { parsePaymentReview, validPaymentDay } from '../src/provider/register/review.ts'
import { paymentDuplicateMessage } from '../src/provider/register/duplicate.ts'
import { readDailyReport } from '../src/provider/report/daily-report.ts'
import { buildVoucher } from '../src/provider/voucher/build.ts'
import { saveVoucherDraft, withdrawVoucherDraft } from '../src/provider/voucher/queue.ts'
import { taxOf } from '../src/rules/tax.ts'
import { correctAllocation } from '../src/provider/claim/correct.ts'
import type { TransactionId } from '../src/service/identifiers.ts'
import { workbenchSummary } from '../src/provider/query/workbench.ts'
import { localDay } from '../src/provider/activity/log.ts'

const options = { companyName: '验收公司' }
const actor = { kind: 'web', id: 'tester' } as const
const config = { outputTaxSubject13: '2221.01.02.13', outputTaxSubject3: '2221.01.02.03' }
const review = { reason: '模拟付款人工核对', splits: [
  { feeType: 'rent', amount: 10900, periodStart: '2026-04-01', periodEnd: '2026-04-30' },
  { feeType: 'service', amount: 10600, periodStart: '2026-04-01', periodEnd: '2026-04-30' },
] }
async function fixture() {
  const db = await openFinanceDatabase(':memory:')
  db.exec(`INSERT INTO merchant(id,shop_no,name,brand) VALUES('m','TEST-ACTIONS','模拟商户','模拟');
    INSERT INTO receivable(id,merchant_id,fee_type,period,period_start,period_end,due_date,amount_due,amount_relief)
    VALUES('r','m','rent','2026-04','2026-04-01','2026-04-30','2026-04-30',10900,0);`)
  const submission = submitPayment(db, { draftId: 'multi', text: '模拟 租金 215元 2026-04-03 单号 TEST-MULTI', shopNo: 'TEST-ACTIONS', submitter: 'tester' }, options)
  return { db, submission }
}

await test('human fee review retains original evidence, validates the total and books once', async () => {
  const { db, submission } = await fixture()
  try {
    assert.equal(paymentReviewDetails(db, submission.id, options).amount, 21500)
    assert.throws(() => decidePayment(db, submission.id, 'approve', options, { ...review, splits: [review.splits[0]] }), /合计/)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM "transaction"').get()?.n, 0)
    const booked = decidePayment(db, submission.id, 'approve', options, review)
    assert.ok(booked.transactionId)
    assert.equal(decidePayment(db, submission.id, 'approve', options, review).transactionId, booked.transactionId)
    assert.throws(() => decidePayment(db, submission.id, 'approve', options, { ...review, reason: 'changed' }), /另一份分配/)
    const report = readDailyReport(db, '2026-04-03')
    assert.equal(report.rows.length, 1)
    assert.deepEqual(report.rows[0]?.amounts, { rent: 10900, service: 10600 })
    assert.equal(db.prepare('SELECT text FROM payment_submission').get()?.text, submission.text)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_review_allocation').get()?.n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM activity_log WHERE action=\'approve_payment\'').get()?.n, 1)
  } finally { db.close() }
})

await test('full reversal restores linked balances and mirrors voucher cents while retaining both records', async () => {
  const { db, submission } = await fixture()
  try {
    const approved = decidePayment(db, submission.id, 'approve', options, review)
    const originalId = approved.transactionId as TransactionId
    const originalVoucher = buildVoucher(db, '2026-04-03', config)
    const row = reversiblePayments(db, '2026-04-03')[0]
    assert.ok(row)
    const input = { transactionId: originalId, allocationIds: row.allocationIds, date: '2026-04-04', reason: '模拟登记更正' }
    assert.throws(() => reversePayment(db, { ...input, allocationIds: [] }, actor), /分配已变化/)
    const draft = saveVoucherDraft(db, '2026-04-03', originalVoucher.receiptIds, config, actor)
    assert.throws(() => reversePayment(db, input, actor), /凭证草稿/)
    withdrawVoucherDraft(db, draft.id, '先撤回再冲正', actor)
    const id = reversePayment(db, input, actor)
    assert.equal(reversePayment(db, input, actor), id)
    assert.throws(() => correctAllocation(db, { requestId: 'after-reversal', itemId: `txn:${originalId}`,
      shopNo: 'TEST-ACTIONS', splits: [{ feeType: 'rent', amount: 21500 }], expectedAllocationIds: row.allocationIds,
      reason: '修改已冲正原单' }, actor), /关联冲正/)
    assert.throws(() => reversePayment(db, { ...input, reason: 'changed' }, actor), /已冲正/)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM "transaction"').get()?.n, 2)
    assert.equal(db.prepare('SELECT SUM(amount) n FROM "transaction"').get()?.n, 0)
    assert.equal(db.prepare('SELECT SUM(amount_incl_tax) n FROM allocation WHERE receivable_id=\'r\'').get()?.n, 0)
    assert.equal(readDailyReport(db, '2026-04-03').grandTotal, 21500)
    assert.equal(readDailyReport(db, '2026-04-04').grandTotal, -21500)
    const reversedVoucher = buildVoucher(db, '2026-04-04', config)
    assert.equal(reversedVoucher.checks.balanced, true)
    assert.deepEqual(reversedVoucher.lines.map(l => [l.subject, l.debit, l.credit]),
      originalVoucher.lines.map(l => [l.subject, l.debit === 0 ? 0 : -l.debit, l.credit === 0 ? 0 : -l.credit]))
    assert.equal((paymentDuplicateMessage(db, 'TEST-MULTI') ?? '') + '\n',
      await readFile(new URL('./expected/reversed-payment.txt', import.meta.url), 'utf8'))
    assert.equal(reversiblePayments(db, '2026-04-03')[0]?.reversed, true)
    const registrations = workbenchSummary(db, localDay(), { overdueDays: 30, extraTodos: [] }).registrations
    assert.equal(registrations.find(entry => entry.transactionId === originalId)?.status, 'reversed')
    assert.equal(registrations.find(entry => entry.transactionId === id)?.status, 'reversal')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM activity_log WHERE action=\'reverse_payment\'').get()?.n, 1)
  } finally { db.close() }
})

await test('audit failure rolls back all reversal writes and allows a safe retry', async () => {
  const { db, submission } = await fixture()
  try {
    decidePayment(db, submission.id, 'approve', options, review)
    const row = reversiblePayments(db, '2026-04-03')[0]
    assert.ok(row)
    const input = { transactionId: row.transactionId, allocationIds: row.allocationIds, date: '2026-04-03', reason: '模拟冲正' }
    db.exec("CREATE TRIGGER reject_reverse BEFORE INSERT ON activity_log WHEN NEW.action='reverse_payment' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
    assert.throws(() => reversePayment(db, input, actor), /audit unavailable/)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM "transaction"').get()?.n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocation').get()?.n, 2)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_reversal').get()?.n, 0)
    db.exec('DROP TRIGGER reject_reverse')
    reversePayment(db, input, actor)
    assert.equal(readDailyReport(db, '2026-04-03').grandTotal, 0)
  } finally { db.close() }
})

await test('review rejects invalid money and periods, and negative VAT mirrors positive VAT', () => {
  for (const amount of [-1, 0, 1.23, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parsePaymentReview({ reason: 'x', splits: [{ feeType: 'rent', amount }] }, amount))
  assert.throws(() => parsePaymentReview({ reason: 'x', splits: [{ feeType: 'rent', amount: 1, periodStart: '2026-02-30', periodEnd: '2026-04-01' }] }, 1), /账期/)
  assert.throws(() => parsePaymentReview({ reason: '', splits: [] }, 1))
  assert.equal(validPaymentDay('2026-13-01'), false)
  assert.equal(validPaymentDay('2026-02-30'), false)
  for (const rate of [0.03, 0.06, 0.09, 0.13] as const) {
    for (const cents of [1, 53, 109, 123, 10900]) assert.equal(taxOf(-cents, rate), -taxOf(cents, rate))
  }
})
