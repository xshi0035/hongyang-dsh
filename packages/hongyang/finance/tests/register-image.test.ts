import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePaymentImageExtraction, registerPaymentFromImage } from '../src/provider/register/image.ts'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'

void test('provider validates image payee before registering extracted fields', () => {
  assert.throws(() => registerPaymentFromImage({} as never, {
    amountText: '500元',
    payee: '其他公司',
  }, { companyName: '衡阳诚远商业管理有限公司' }), /收款方/)
})

await test('missing or invalid screenshot evidence leaves the database unchanged', async () => {
  const db = await openFinanceDatabase(':memory:')
  const valid = { amountText: '500元', paymentDate: '2026-04-03', payee: '测试收款方', merchantText: '测试商户', feeText: '电费' }
  try {
    for (const invalid of [
      { ...valid, payee: undefined }, { ...valid, payee: '其他收款方' },
      { ...valid, paymentDate: undefined }, { ...valid, paymentDate: '2026-02-30' },
      { ...valid, paymentDate: '2026-04-03 24:00:00' }, { ...valid, amountText: '500.001元' },
      { ...valid, amountText: '0元' }, { ...valid, amountText: '5,00元' },
    ]) {
      assert.throws(() => registerPaymentFromImage(db, invalid, { companyName: '测试收款方' }))
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
    const pending = registerPaymentFromImage(db, valid, { companyName: '测试收款方' })
    assert.equal(pending.pending, true)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
  } finally { db.close() }
})

void test('parses only the structured extraction contract', () => {
  assert.deepEqual(parsePaymentImageExtraction('{"amountText":"500元","merchantText":"围辣转转火锅","feeText":"电费"}'), {
    amountText: '500元', merchantText: '围辣转转火锅', feeText: '电费',
  })
  assert.throws(() => parsePaymentImageExtraction('{"amountText":500}'))
})
