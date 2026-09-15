import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openFinanceDatabase, HY_FINANCE_SCHEMA_VERSION } from '../src/provider/db/schema.ts'
import { submitPayment, pendingPayments, decidePayment } from '../src/provider/register/submission.ts'
import { workbenchSummary } from '../src/provider/query/workbench.ts'
import { toWorkbenchWire } from '../src/webServer/workbench-wire.ts'
import { transaction } from '../src/provider/db/repo.ts'

const options = { companyName: '测试公司' }
const input = { draftId: 'draft-1', text: '作业帮 电费', shopNo: '3F-3032', submitter: 'u', image: {
  amountText: '200.00', paymentDate: '2026-04-03 12:34:56', payee: '测试公司', transactionNo: 'SYNTHETIC-REVIEW-1',
} }
const seed = (db: Awaited<ReturnType<typeof openFinanceDatabase>>) => { db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','测试商户','作业帮')") }
const count = (db: Awaited<ReturnType<typeof openFinanceDatabase>>, table: string) => db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()?.n

await test('pending reviews survive reopen and appear across dates; approval commits money and audit once across handles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hy-review-'))
  let db = await openFinanceDatabase(join(root, 'finance.db'))
  try {
    seed(db)
    const submitted = submitPayment(db, input, options)
    assert.equal(submitPayment(db, input, options).id, submitted.id)
    assert.throws(() => submitPayment(db, { ...input, shopNo: 'BAD' }, options), /不能更改/)
    assert.equal(count(db, 'transaction'), 0)
    assert.equal(count(db, 'allocation'), 0)
    assert.equal(count(db, 'payment_submission'), 1)
    const summary = workbenchSummary(db, '2020-01-01', { overdueDays: 30, extraTodos: [] })
    assert.equal(summary.pendingReviews[0]?.id, submitted.id)
    assert.deepEqual(summary.registrationTotal, { count: 0, cents: 0 })
    assert.equal(toWorkbenchWire(summary).pendingReviews[0]?.transactionNo, input.image.transactionNo)
    db.close()
    db = await openFinanceDatabase(join(root, 'finance.db'))
    assert.deepEqual(pendingPayments(db)[0], submitted)
    const other = await openFinanceDatabase(join(root, 'finance.db'))
    try {
      const result = decidePayment(db, submitted.id, 'approve', options)
      assert.equal(decidePayment(other, submitted.id, 'approve', options).transactionId, result.transactionId)
      assert.equal(count(db, 'transaction'), 1)
      assert.equal(count(db, 'allocation'), 1)
      assert.equal(pendingPayments(db).length, 0)
      const row = db.prepare('SELECT amount,txn_time,txn_no FROM "transaction"').get()!
      assert.deepEqual({ ...row }, { amount: 20000, txn_time: input.image.paymentDate, txn_no: input.image.transactionNo })
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'approve_payment' AND actor_kind = 'web'").get()?.n, 1)
      assert.throws(() => decidePayment(other, submitted.id, 'reject', options), /已处理/)
    } finally { other.close() }
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})

await test('rejecting is durable and idempotent; a rejected payment cannot later be booked', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    seed(db)
    const row = submitPayment(db, input, options)
    assert.equal(decidePayment(db, row.id, 'reject', options).status, 'rejected')
    decidePayment(db, row.id, 'reject', options)
    assert.throws(() => decidePayment(db, row.id, 'approve', options), /已处理/)
    assert.equal(count(db, 'transaction'), 0)
    assert.equal(count(db, 'allocation'), 0)
    assert.equal(count(db, 'activity_log'), 2)
  } finally { db.close() }
})

await test('approval revalidates evidence and rolls back financial rows when recording the decision fails', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    seed(db)
    const row = submitPayment(db, input, options)
    assert.throws(() => decidePayment(db, row.id, 'approve', { companyName: '另一公司' }), /收款方/)
    db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON activity_log WHEN NEW.action = 'approve_payment' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END")
    assert.throws(() => decidePayment(db, row.id, 'approve', options), /fixture audit failure/)
    assert.equal(count(db, 'transaction'), 0)
    assert.equal(count(db, 'allocation'), 0)
    assert.equal(pendingPayments(db)[0]?.status, 'pending')
    db.exec('DROP TRIGGER fail_review')
    decidePayment(db, row.id, 'approve', options)
    assert.equal(count(db, 'transaction'), 1)
  } finally { db.close() }
})

await test('text dates are frozen at submission and nested rollback leaves the outer transaction usable', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    seed(db)
    const row = submitPayment(db, { ...input, text: '作业帮 电费200', image: undefined }, options)
    decidePayment(db, row.id, 'approve', options)
    assert.equal(db.prepare('SELECT txn_time FROM "transaction"').get()?.txn_time, row.paymentDate)
    transaction(db, () => {
      assert.throws(() => transaction(db, () => { db.exec("UPDATE merchant SET name = 'rolled back'"); throw new Error('abort') }), /abort/)
      assert.equal(db.prepare('SELECT name FROM merchant').get()?.name, '测试商户')
    })
  } finally { db.close() }
})

await test('known schema version 2 migrates without changing existing financial records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hy-review-migration-'))
  let db = await openFinanceDatabase(join(root, 'finance.db'))
  try {
    seed(db)
    db.exec('DROP TABLE payment_submission; PRAGMA user_version = 2')
    db.close()
    db = await openFinanceDatabase(join(root, 'finance.db'))
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, HY_FINANCE_SCHEMA_VERSION)
    assert.equal(count(db, 'merchant'), 1)
    assert.equal(count(db, 'transaction'), 0)
    assert.equal(count(db, 'payment_submission'), 0)
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})

await test('a different draft with the same reference is blocked while pending and after booking', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    seed(db)
    const first = submitPayment(db, input, options)
    assert.throws(() => submitPayment(db, { ...input, draftId: 'other' }, options), /已在工作台待审核/)
    assert.equal(count(db, 'payment_submission'), 1)
    assert.equal(count(db, 'activity_log'), 1)
    assert.equal(count(db, 'transaction'), 0)
    decidePayment(db, first.id, 'approve', options)
    assert.throws(() => submitPayment(db, { ...input, draftId: 'after-booking' }, options), /该付款已登记/)
    assert.equal(count(db, 'payment_submission'), 1)
    assert.equal(count(db, 'transaction'), 1)
    assert.equal(count(db, 'allocation'), 1)
  } finally { db.close() }
})

await test('rejected references can be resubmitted; absent references and equal amounts do not establish duplicates', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    seed(db)
    const first = submitPayment(db, input, options)
    decidePayment(db, first.id, 'reject', options)
    submitPayment(db, { ...input, draftId: 'resubmission' }, options)
    for (const draftId of ['without-ref-1', 'without-ref-2']) {
      submitPayment(db, { ...input, draftId, image: { ...input.image, transactionNo: '' } }, options)
    }
    submitPayment(db, { ...input, draftId: 'different-ref', image: { ...input.image, transactionNo: 'ANOTHER-REFERENCE' } }, options)
    assert.equal(pendingPayments(db).length, 4)
    assert.ok(pendingPayments(db).every(row => row.duplicateMessage === undefined))
    assert.equal(count(db, 'transaction'), 0)
  } finally { db.close() }
})

await test('text and image references share duplicate detection; old duplicate queue rows stay reviewable without booking', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    seed(db)
    const first = submitPayment(db, input, options)
    assert.throws(() => submitPayment(db, { ...input, draftId: 'text', image: undefined,
      text: `作业帮 电费200元 交易号 ${input.image.transactionNo}` }, options), /已在工作台待审核/)
    // A row from the earlier application version, before reference checks existed.
    db.prepare(`INSERT INTO payment_submission
      (id,draft_id,submitted_at,submitter,shop_no,merchant_name,summary,text,image,payment_date,status)
      SELECT 'legacy-duplicate','legacy-draft',submitted_at,submitter,shop_no,merchant_name,summary,text,image,payment_date,status
      FROM payment_submission WHERE id = ?`).run(first.id)
    const legacy = pendingPayments(db).find(row => row.id !== first.id)!
    assert.match(legacy.duplicateMessage ?? '', /已在工作台待审核/)
    assert.equal(pendingPayments(db).find(row => row.id === first.id)?.duplicateMessage, undefined)
    assert.throws(() => decidePayment(db, legacy.id, 'approve', options), /已在工作台待审核/)
    decidePayment(db, first.id, 'approve', options)
    const remaining = pendingPayments(db)[0]!
    assert.match(remaining.duplicateMessage ?? '', /该付款已登记/)
    assert.match(toWorkbenchWire(workbenchSummary(db, '2020-01-01', { overdueDays: 30, extraTodos: [] })).pendingReviews[0]?.duplicateMessage ?? '', /该付款已登记/)
    assert.throws(() => decidePayment(db, remaining.id, 'approve', options), /该付款已登记/)
    decidePayment(db, remaining.id, 'reject', options)
    assert.equal(count(db, 'transaction'), 1)
    assert.equal(count(db, 'allocation'), 1)
    assert.equal(pendingPayments(db).length, 0)
  } finally { db.close() }
})

await test('duplicate wording distinguishes a rejected application from an earlier booking and uses registration time', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    seed(db)
    const first = submitPayment(db, input, options)
    decidePayment(db, first.id, 'approve', options)
    db.prepare("UPDATE activity_log SET at = ? WHERE action = 'approve_payment'").run('2026-09-15T08:33:55.000Z')
    db.prepare(`INSERT INTO payment_submission
      (id,draft_id,submitted_at,submitter,shop_no,merchant_name,summary,text,image,payment_date,status)
      SELECT 'rejected-copy','rejected-copy-draft',submitted_at,submitter,shop_no,merchant_name,summary,text,image,payment_date,'rejected'
      FROM payment_submission WHERE id = ?`).run(first.id)
    assert.throws(() => submitPayment(db, { ...input, draftId: 'try-again' }, options), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /上次提交的审核申请已驳回；但这不撤销此前的登记/)
      assert.match(error.message, /原登记时间 2026-09-15 16:33:55（北京时间），原登记仍有效/)
      assert.doesNotMatch(error.message, /2026-04-03/)
      return true
    })
    assert.equal(count(db, 'transaction'), 1)
    assert.equal(count(db, 'allocation'), 1)
    assert.equal(count(db, 'payment_submission'), 2)
  } finally { db.close() }
})
