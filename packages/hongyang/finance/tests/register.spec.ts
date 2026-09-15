import { describe, expect, it } from 'vitest'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { parsePaymentText, registerPayment } from '../src/provider/register/payment.ts'

describe('text payment registration', () => {
  it('parses and books an exact merchant and fee', async () => {
    const db = await openFinanceDatabase(':memory:')
    try {
      db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','5F-5008','测试商户','测试品牌')")
      const parsed = parsePaymentText('2026-04-03 测试商户 电费 500 元 交易单号 ABC123')
      expect(parsed).toEqual({ amount: 50000, date: '2026-04-03', merchant: '测试商户', feeType: 'elec_post', txnNo: 'ABC123' })
      const result = registerPayment(db, '2026-04-03 测试商户 电费 500 元 交易单号 ABC123')
      expect(result.booked).toBe(true)
      expect(result.pending).toBe(false)
      expect(db.prepare('SELECT amount,status,source,txn_no FROM "transaction"').get()?.amount).toBe(50000)
      expect(db.prepare('SELECT fee_type,amount_incl_tax,origin FROM allocation').get()?.fee_type).toBe('elec_post')
    } finally { db.close() }
  })

  it('leaves an unknown merchant pending and never allocated', async () => {
    const db = await openFinanceDatabase(':memory:')
    try {
      const result = registerPayment(db, '2026-04-03 未知商户 电费 500 元')
      expect(result.booked).toBe(false)
      expect(result.pending).toBe(true)
      expect(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n).toBe(0)
    } finally { db.close() }
  })
})
