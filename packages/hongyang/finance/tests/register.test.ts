import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { parsePaymentText, registerPayment } from '../src/provider/register/payment.ts'

await test('text payment registration parses and books an exact merchant and fee', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','5F-5008','测试商户','测试品牌')")
    const parsed = parsePaymentText('2026-04-03 测试商户 电费 500 元 交易单号 ABC123')
    assert.deepEqual(parsed, { amount: 50000, date: '2026-04-03', merchant: '测试商户', feeType: 'elec_post', txnNo: 'ABC123' })
    const result = registerPayment(db, '2026-04-03 测试商户 电费 500 元 交易单号 ABC123')
    assert.equal(result.booked, true)
    assert.equal(result.pending, false)
    assert.equal(db.prepare('SELECT amount,status,source,txn_no FROM "transaction"').get()?.amount, 50000)
    assert.equal(db.prepare('SELECT fee_type,amount_incl_tax,origin FROM allocation').get()?.fee_type, 'elec_post')
  } finally { db.close() }
})

await test('unknown merchant is saved as pending and never allocated', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    const result = registerPayment(db, '2026-04-03 未知商户 电费 500 元')
    assert.equal(result.booked, false)
    assert.equal(result.pending, true)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
  } finally { db.close() }
})
