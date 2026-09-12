import assert from 'node:assert/strict'
import test from 'node:test'
import { openFinanceDatabase } from '@deepseek-ai/dsh-hy-finance/src/provider/db/schema.ts'
import { registerPayment } from '@deepseek-ai/dsh-hy-finance/src/provider/register/payment.ts'
import { registerPaymentFromImage, type PaymentImageExtraction } from '@deepseek-ai/dsh-hy-finance/src/provider/register/image.ts'
import { createFinanceDingtalkBridge } from '../src/bridge.ts'
import type { DingtalkStreamClient, DingtalkTextMessage, DingtalkReply } from '../src/types.ts'

const extraction = {
  amountText: '￥500.00', paymentDate: '2026-04-03 15:26:40', transactionNo: 'ABC123',
  payee: '衡阳诚远商业管理有限公司', merchantText: '围辣转转火锅', feeText: '电费',
}
const options = { companyName: extraction.payee }

await test('downloaded picture and text reach finance storage and a provider-formatted reply', async () => {
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
        assert.equal(request.textHint, '围辣转转火锅 电费')
        assert.equal(request.imageDataUrl, 'data:image/png;base64,AQID')
        yield JSON.stringify(extraction)
      },
    })
    assert.ok(handler)
    const reply = await handler({
      deliveryId: 'picture-1', userId: 'operator', conversationId: 'test',
      text: '围辣转转火锅 电费', imageUrl: 'data:image/png;base64,AQID',
    })
    assert.equal(reply.text, '已登记：A01 围辣转转火锅 后付电费 500.00 元。')
    const saved = db.prepare('SELECT txn_no,txn_time,amount FROM "transaction"').get()
    assert.equal(saved?.txn_no, 'ABC123')
    assert.equal(saved?.txn_time, '2026-04-03 15:26:40')
    assert.equal(saved?.amount, 50000)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 1)
    const invalid = await handler({ deliveryId: 'text-2', userId: 'operator', conversationId: 'test', text: '没有金额' })
    assert.match(invalid.text, /付款登记未完成/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 1)
  } finally { db.close() }
})

await test('unconfigured images never fall through to text registration', async () => {
  let handler: ((message: DingtalkTextMessage) => Promise<DingtalkReply>) | undefined
  const stream: DingtalkStreamClient = {
    connect: () => Promise.resolve(), close: () => Promise.resolve(),
    onMessage(next) { handler = next; return () => { handler = undefined } },
  }
  createFinanceDingtalkBridge({ registerPayment: () => { throw new Error('must not register') } }, stream)
  assert.ok(handler)
  const result = await handler({ deliveryId: '1', userId: 'u', conversationId: 'c', text: '电费500元', imageUrl: 'downloadCode:code' })
  assert.equal(result.text, '已收到付款截图，但图片识别尚未配置；请补充一句商户和费项文字。')
})
