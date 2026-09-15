import { openFinanceDatabase } from '@deepseek-ai/dsh-hy-finance/src/provider/db/schema.ts'
import { registerPaymentFromImage, type PaymentImageExtraction } from '@deepseek-ai/dsh-hy-finance/src/provider/register/image.ts'
import { registerPayment } from '@deepseek-ai/dsh-hy-finance/src/provider/register/payment.ts'
import { expect, it } from 'vitest'
import { createFinanceDingtalkBridge } from '../src/bridge.ts'
import type { DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from '../src/types.ts'

const extraction = {
  amountText: '￥500.00', paymentDate: '2026-04-03 15:26:40', transactionNo: 'ABC123',
  payee: '衡阳诚远商业管理有限公司', merchantText: '围辣转转火锅', feeText: '电费',
}
const options = { companyName: extraction.payee }

it('routes a downloaded picture and text to finance storage with a provider-formatted reply', async () => {
  const db = await openFinanceDatabase(':memory:')
  let handler: ((message: DingtalkTextMessage) => Promise<DingtalkReply>) | undefined
  const stream: DingtalkStreamClient = {
    connect: () => Promise.resolve(), close: () => Promise.resolve(),
    onMessage(next) { handler = next; return () => { handler = undefined } },
  }
  const service = {
    registerPayment: (text: string) => registerPayment(db, text),
    registerPaymentFromImage: (fields: PaymentImageExtraction) => registerPaymentFromImage(db, fields, options),
  }
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','A01','围辣转转火锅','围辣转转火锅')")
    createFinanceDingtalkBridge(service, stream, {
      async *stream(request) {
        expect(request.textHint).toBe('围辣转转火锅 电费')
        expect(request.imageDataUrl).toBe('data:image/png;base64,AQID')
        yield JSON.stringify(extraction)
      },
    })
    expect(handler).toBeDefined()
    const reply = await handler!({
      deliveryId: 'picture-1', userId: 'operator', conversationId: 'test',
      text: '围辣转转火锅 电费', imageUrl: 'data:image/png;base64,AQID',
    })
    expect(reply.text).toBe('已登记：A01 围辣转转火锅 后付电费 500.00 元。')
    const saved = db.prepare('SELECT txn_no,txn_time,amount FROM "transaction"').get()
    expect(saved?.txn_no).toBe('ABC123')
    expect(saved?.txn_time).toBe('2026-04-03 15:26:40')
    expect(saved?.amount).toBe(50000)
    expect(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n).toBe(1)
    const invalid = await handler!({ deliveryId: 'text-2', userId: 'operator', conversationId: 'test', text: '没有金额' })
    expect(invalid.text).toMatch(/付款登记未完成/)
    expect(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n).toBe(1)
  } finally { db.close() }
})

it('never falls through to text registration for unconfigured images', async () => {
  let handler: ((message: DingtalkTextMessage) => Promise<DingtalkReply>) | undefined
  const stream: DingtalkStreamClient = {
    connect: () => Promise.resolve(), close: () => Promise.resolve(),
    onMessage(next) { handler = next; return () => { handler = undefined } },
  }
  createFinanceDingtalkBridge({ registerPayment: () => { throw new Error('must not register') } }, stream)
  expect(handler).toBeDefined()
  const result = await handler!({ deliveryId: '1', userId: 'u', conversationId: 'c', text: '电费500元', imageUrl: 'downloadCode:code' })
  expect(result.text).toBe('已收到付款截图，但图片识别尚未配置；请补充一句商户和费项文字。')
})
