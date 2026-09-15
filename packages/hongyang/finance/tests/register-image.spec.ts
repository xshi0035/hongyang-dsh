import { describe, expect, it } from 'vitest'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { parsePaymentImageExtraction, registerPaymentFromImage } from '../src/provider/register/image.ts'

describe('image payment registration', () => {
  it('validates the payee before registering extracted fields', () => {
    expect(() => registerPaymentFromImage({} as never, {
      amountText: '500元',
      payee: '其他公司',
    }, { companyName: '衡阳诚远商业管理有限公司' })).toThrow(/收款方/)
  })

  it('leaves the database unchanged for missing or invalid screenshot evidence', async () => {
    const db = await openFinanceDatabase(':memory:')
    const valid = { amountText: '500元', paymentDate: '2026-04-03', payee: '测试收款方', merchantText: '测试商户', feeText: '电费' }
    try {
      for (const invalid of [
        { ...valid, payee: undefined }, { ...valid, payee: '其他收款方' },
        { ...valid, paymentDate: undefined }, { ...valid, paymentDate: '2026-02-30' },
        { ...valid, paymentDate: '2026-04-03 24:00:00' }, { ...valid, amountText: '500.001元' },
        { ...valid, amountText: '0元' }, { ...valid, amountText: '5,00元' },
      ]) {
        expect(() => registerPaymentFromImage(db, invalid, { companyName: '测试收款方' })).toThrow()
      }
      expect(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n).toBe(0)
      expect(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n).toBe(0)
      const pending = registerPaymentFromImage(db, valid, { companyName: '测试收款方' })
      expect(pending.pending).toBe(true)
      expect(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n).toBe(0)
    } finally { db.close() }
  })

  it('parses only the structured extraction contract', () => {
    expect(parsePaymentImageExtraction('{"amountText":"500元","merchantText":"围辣转转火锅","feeText":"电费"}')).toEqual({
      amountText: '500元', merchantText: '围辣转转火锅', feeText: '电费',
    })
    expect(() => parsePaymentImageExtraction('{"amountText":500}')).toThrow()
  })
})
