import assert from 'node:assert/strict'
import test from 'node:test'
import { openFinanceDatabase } from '@deepseek-ai/dsh-hy-finance/src/provider/db/schema.ts'
import { previewPayment, confirmPayment } from '@deepseek-ai/dsh-hy-finance/src/provider/register/conversation.ts'
import { parsePaymentText } from '@deepseek-ai/dsh-hy-finance/src/provider/register/payment.ts'
import { createFinanceDingtalkBridge } from '../src/bridge.ts'
import type { DingtalkTextMessage, DingtalkReply } from '../src/types.ts'

await test('merchant numbers are not amounts; ambiguous amounts are rejected', () => {
  assert.equal(parsePaymentText('B1-1003 作业帮 电费 200').amount, 20000)
  assert.equal(parsePaymentText('2026-04-03 B1-1003 电费 200元').amount, 20000)
  assert.throws(() => parsePaymentText('B1-1003 作业帮'), /需要正数金额/)
  assert.throws(() => parsePaymentText('电费200元 水费300元'), /多个金额/)
})

await test('collect, preview, confirm once; isolate users, reject invalid selections and retain failed drafts', async () => {
  const db = await openFinanceDatabase(':memory:')
  let handler!: (message: DingtalkTextMessage) => Promise<DingtalkReply>
  let fail = false
  createFinanceDingtalkBridge({
    previewPayment: text => previewPayment(db, text),
    confirmPayment: (text, shop) => { if (fail) throw new Error('temporary failure'); return confirmPayment(db, text, shop) },
  }, {
    connect: () => Promise.resolve(), close: () => Promise.resolve(),
    onMessage(next) { handler = next; return () => {} },
  })
  let sequence = 0
  const send = (text: string, userId = 'u') => handler({ text, userId, conversationId: 'c', deliveryId: String(++sequence) })
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','B1-1003','商户法人','作业帮')")
    assert.match((await send('你好')).text, /你好/)
    assert.match((await send('电费200')).text, /哪个商户/)
    assert.equal(count(), 0)
    assert.match((await send('作业帮')).text, /B1-1003/)
    assert.equal(count(), 0)
    assert.match((await send('确认 B1-1003', 'other')).text, /没有待确认/)
    assert.match((await send('确认 BAD')).text, /草稿已保留/)
    assert.equal(count(), 0)
    fail = true
    assert.match((await send('确认 B1-1003')).text, /temporary failure/)
    fail = false
    assert.match((await send('确认 B1-1003')).text, /已登记.*200.00/)
    assert.equal(count(), 1)
    assert.equal(db.prepare('SELECT amount FROM "transaction"').get()?.amount, 20000)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 1)
    assert.match((await send('确认 B1-1003')).text, /没有待确认/)
    assert.equal(count(), 1)
    await send('作业帮')
    await send('电费200')
    await send('取消')
    assert.match((await send('确认 B1-1003')).text, /没有待确认/)
    assert.equal(count(), 1)
    const image = await handler({ text: '电费200', imageUrl: 'downloadCode:x', userId: 'u', conversationId: 'c', deliveryId: 'image' })
    assert.match(image.text, /图片识别尚未配置/)
    assert.equal(count(), 1)
  } finally { db.close() }
})
