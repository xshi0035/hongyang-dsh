import assert from 'node:assert/strict'
import test from 'node:test'
import { openFinanceDatabase } from '@deepseek-ai/dsh-hy-finance/src/provider/db/schema.ts'
import { previewPayment } from '@deepseek-ai/dsh-hy-finance/src/provider/register/conversation.ts'
import { previewPaymentImage } from '@deepseek-ai/dsh-hy-finance/src/provider/register/image.ts'
import { submitPayment, pendingPayments, decidePayment } from '@deepseek-ai/dsh-hy-finance/src/provider/register/submission.ts'
import { parsePaymentText } from '@deepseek-ai/dsh-hy-finance/src/provider/register/payment.ts'
import type { PaymentVisionClient } from '../src/vision.ts'
import { createFinanceDingtalkBridge, candidateDisplayName } from '../src/bridge.ts'
import { openDingtalkStateStore, type DingtalkStateStore } from '../src/store.ts'
import type { DingtalkCardCallback, DingtalkCardUpdate, DingtalkInteractiveCardOptions, DingtalkTextMessage, DingtalkReply } from '../src/types.ts'

interface Harness {
  handler: (message: DingtalkTextMessage) => Promise<DingtalkReply>
  onCard: (callback: DingtalkCardCallback) => Promise<DingtalkCardUpdate | undefined>
  cards: DingtalkInteractiveCardOptions[]
}

interface MountOptions { vision?: PaymentVisionClient; template?: string; failSend?: () => boolean; failConfirm?: () => boolean }

function mount(db: Awaited<ReturnType<typeof openFinanceDatabase>>, store: DingtalkStateStore, options: MountOptions = {}): Harness {
  const harness = { cards: [] } as unknown as Harness
  createFinanceDingtalkBridge({
    previewPaymentImage: (image, text) => previewPaymentImage(db, image, text, { companyName: '测试公司' }),
    previewPayment: text => previewPayment(db, text),
    submitPayment: (input) => { if (options.failConfirm?.()) throw new Error('temporary failure'); return submitPayment(db, input, { companyName: '测试公司' }) },
  }, {
    connect: () => Promise.resolve(), close: () => Promise.resolve(),
    onMessage(next) { harness.handler = next; return () => {} },
    onCard(next) { harness.onCard = next; return () => {} },
    sendCard(card) {
      if (options.failSend?.()) return Promise.reject(new Error('card api 400'))
      harness.cards.push(card)
      return Promise.resolve()
    },
  }, { store, ...(options.vision === undefined ? {} : { vision: options.vision }), ...(options.template === undefined ? {} : { cardTemplateId: options.template }), now: () => 1_000_000, newId: () => `id${String(harness.cards.length)}-${String(Math.random())}` })
  return harness
}

function click(card: DingtalkInteractiveCardOptions, params: Record<string, unknown>, userId = 'u'): DingtalkCardCallback {
  return { deliveryId: 'cb', outTrackId: card.outTrackId, userId, params, actionIds: ['a'], value: {} }
}

await test('merchant numbers are not amounts; ambiguous amounts are rejected', () => {
  assert.equal(parsePaymentText('B1-1003 作业帮 电费 200').amount, 20000)
  assert.equal(parsePaymentText('2026-04-03 B1-1003 电费 200元').amount, 20000)
  assert.throws(() => parsePaymentText('B1-1003 作业帮'), /需要正数金额/)
  assert.throws(() => parsePaymentText('电费200元 水费300元'), /多个金额/)
})

await test('candidate labels show shop number, leading brand, and contracting party', () => {
  assert.equal(candidateDisplayName({ shopNo: '3F-3032', name: '周军伟', brand: '作业帮/小天才/优学派' }), '3F-3032 作业帮（周军伟）')
  assert.equal(candidateDisplayName({ shopNo: '20', name: '烤生蚝', brand: '烤生蚝' }), '20 烤生蚝')
  assert.equal(candidateDisplayName({ shopNo: '20', name: '某公司', brand: '' }), '20 某公司')
})

await test('collect, preview, confirm once by text; isolate users, reject invalid selections and retain failed drafts', async () => {
  const db = await openFinanceDatabase(':memory:')
  const store = await openDingtalkStateStore(':memory:')
  let fail = false
  const { handler } = mount(db, store, { failConfirm: () => fail })
  let sequence = 0
  const send = (text: string, userId = 'u') => handler({ text, userId, conversationId: 'c', deliveryId: String(++sequence) })
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM payment_submission').get()?.n
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','B1-1003','商户法人','作业帮/小天才')")
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('numeric','20','烤生蚝','烤生蚝')")
    assert.equal(previewPayment(db, '电费200').candidates.length, 0)
    assert.match((await send('你好')).text, /你好/)
    assert.match((await send('电费200')).text, /哪个商户/)
    assert.equal(count(), 0)
    assert.match((await send('作业帮')).text, /【B1-1003】作业帮（商户法人）/)
    assert.equal(count(), 0)
    assert.match((await send('确认 编号')).text, /实际铺位号/)
    assert.match((await send('确认')).text, /实际铺位号/)
    assert.match((await send('确认 B1-1003', 'other')).text, /没有待确认/)
    assert.match((await send('确认 BAD')).text, /草稿已保留/)
    assert.equal(count(), 0)
    fail = true
    assert.match((await send('确认 B1-1003')).text, /temporary failure/)
    fail = false
    assert.match((await send('确认 B1-1003')).text, /已提交工作台审核.*200.00/)
    assert.equal(count(), 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
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
  } finally { store.close(); db.close() }
})

await test('replayed deliveries are ignored, also across a restart sharing the same store', async () => {
  const db = await openFinanceDatabase(':memory:')
  const store = await openDingtalkStateStore(':memory:')
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','B1-1003','商户法人','作业帮')")
    const first = mount(db, store)
    const message = (text: string, deliveryId: string) => ({ text, userId: 'u', conversationId: 'c', deliveryId })
    assert.match((await first.handler(message('作业帮 电费200', 'm1'))).text, /B1-1003/)
    assert.equal((await first.handler(message('作业帮 电费200', 'm1'))).silent, true)
    const restarted = mount(db, store)
    assert.equal((await restarted.handler(message('作业帮 电费200', 'm1'))).silent, true)
    assert.match((await restarted.handler(message('确认 B1-1003', 'm2'))).text, /已提交工作台审核/)
    assert.equal((await restarted.handler(message('确认 B1-1003', 'm2'))).silent, true)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_submission').get()?.n, 1)
  } finally { store.close(); db.close() }
})

await test('cards confirm once, replay safely, cancel, reject other users and stale cards, and survive restarts', async () => {
  const db = await openFinanceDatabase(':memory:')
  const store = await openDingtalkStateStore(':memory:')
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM payment_submission').get()?.n
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','周军伟','作业帮/小天才/优学派')")
    let fail = false
    const first = mount(db, store, { template: 'tpl.schema', failConfirm: () => fail })
    let sequence = 0
    const send = (harness: Harness, text: string, userId = 'u') => harness.handler({ text, userId, conversationId: 'c', conversationType: 'single', deliveryId: String(++sequence) })
    assert.match((await send(first, '电费 200')).text, /哪个商户/)
    assert.equal(first.cards.length, 0)
    const reply = await send(first, '作业帮')
    assert.equal(reply.silent, true)
    assert.equal(first.cards.length, 1)
    const card = first.cards[0]!
    assert.equal(card.templateId, 'tpl.schema')
    assert.equal(card.userId, 'u')
    assert.equal(card.conversationType, 'single')
    assert.match(card.cardData.content ?? '', /200\.00/)
    const list = JSON.parse(card.cardData.merchantList ?? '[]') as { shopNo: string; displayName: string }[]
    assert.deepEqual(list.map(m => [m.shopNo, m.displayName]), [['3F-3032', '3F-3032 作业帮（周军伟）']])

    assert.equal(await first.onCard(click(card, { action: 'confirm', shopNo: '3F-3032' }, 'someone-else')), undefined)
    assert.equal(count(), 0)
    assert.match(first.onCard === undefined ? '' : (await first.onCard(click(card, { action: 'confirm' })))?.cardParamMap.content ?? '', /铺位号/)
    assert.match((await first.onCard(click(card, { action: 'confirm', shopNo: 'BAD' })))?.cardParamMap.content ?? '', /草稿已保留/)
    assert.equal(store.getCard(card.outTrackId)?.status, 'open')
    fail = true
    assert.match((await first.onCard(click(card, { action: 'confirm', shopNo: '3F-3032' })))?.cardParamMap.content ?? '', /temporary failure/)
    assert.equal(store.getCard(card.outTrackId)?.status, 'open')
    fail = false

    const restarted = mount(db, store, { template: 'tpl.schema' })
    const confirmed = await restarted.onCard(click(card, { action: 'confirm', shopNo: '3F-3032' }))
    assert.match(confirmed?.cardParamMap.content ?? '', /已提交工作台审核，尚未入账：3F-3032 周军伟；.*200\.00/)
    assert.equal(count(), 1)
    const record = store.getCard(card.outTrackId)
    assert.equal(record?.status, 'submitted')
    assert.equal(record?.transactionId, undefined)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
    const replay = await restarted.onCard(click(card, { action: 'confirm', shopNo: '3F-3032' }))
    assert.equal(replay?.cardParamMap.content, confirmed?.cardParamMap.content)
    assert.equal(count(), 1)
    assert.match((await send(restarted, '确认 3F-3032')).text, /没有待确认/)
    assert.equal(count(), 1)

    await send(restarted, '水费 300')
    await send(restarted, '作业帮')
    const second = restarted.cards[0]!
    const cancelled = await restarted.onCard(click(second, { action: 'cancel' }))
    assert.match(cancelled?.cardParamMap.content ?? '', /已取消/)
    assert.match((await restarted.onCard(click(second, { action: 'confirm', shopNo: '3F-3032' })))?.cardParamMap.content ?? '', /已取消/)
    assert.equal(count(), 1)

    await send(restarted, '作业帮 电费 50')
    const third = restarted.cards[1]!
    await send(restarted, '2026-09-01')
    const fourth = restarted.cards[2]!
    assert.match((await restarted.onCard(click(third, { action: 'confirm', shopNo: '3F-3032' })))?.cardParamMap.content ?? '', /已失效/)
    assert.equal(count(), 1)
    assert.match((await restarted.onCard(click(fourth, { action: 'confirm', shopNo: '3F-3032' })))?.cardParamMap.content ?? '', /已提交工作台审核/)
    assert.equal(count(), 2)
    assert.equal(await restarted.onCard({ deliveryId: 'x', outTrackId: 'unknown', params: {}, actionIds: [], value: {} }), undefined)
  } finally { store.close(); db.close() }
})

await test('card delivery failure falls back to the text reply and keeps the draft confirmable', async () => {
  const db = await openFinanceDatabase(':memory:')
  const store = await openDingtalkStateStore(':memory:')
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','周军伟','作业帮')")
    const harness = mount(db, store, { template: 'tpl.schema', failSend: () => true })
    const reply = await harness.handler({ text: '作业帮 电费 200', userId: 'u', conversationId: 'c', deliveryId: '1' })
    assert.notEqual(reply.silent, true)
    assert.match(reply.text, /3F-3032/)
    assert.match((await harness.handler({ text: '确认 3F-3032', userId: 'u', conversationId: 'c', deliveryId: '2' })).text, /已提交工作台审核/)
  } finally { store.close(); db.close() }
})

const receipt = { amountText: '￥1,200.50', paymentDate: '2026-04-03 12:34:56', transactionNo: 'ORDER-20260403-42', payee: '测试公司' }

await test('screenshot draft joins text, survives remount, and confirms once with structured evidence', async () => {
  const db = await openFinanceDatabase(':memory:')
  const store = await openDingtalkStateStore(':memory:')
  const vision: PaymentVisionClient = { async *stream() { yield JSON.stringify(receipt) } }
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM payment_submission').get()?.n
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','商户法人','作业帮')")
    const first = mount(db, store, { template: 'tpl.schema', vision })
    const msg = (text: string, deliveryId: string) => ({ text, deliveryId, conversationId: 'c', userId: 'u' })
    const reply = await first.handler({ ...msg('', 'image'), imageUrl: 'data:image/png;base64,AQID' })
    assert.match(reply.text, /截图候选金额 1200.50 元（请人工核对）/)
    assert.equal(count(), 0)
    const restarted = mount(db, store, { template: 'tpl.schema', vision })
    assert.equal((await restarted.handler(msg('作业帮 电费', 'text'))).silent, true)
    assert.equal(count(), 0)
    const card = restarted.cards[0]!
    assert.match(card.cardData.content ?? '', /2026-04-03 12:34:56/)
    assert.match((await restarted.onCard(click(card, { action: 'confirm', shopNo: 'BAD' })))?.cardParamMap.content ?? '', /草稿已保留/)
    assert.equal(count(), 0)
    assert.match((await restarted.onCard(click(card, { action: 'confirm', shopNo: '3F-3032' })))?.cardParamMap.content ?? '', /已提交工作台审核/)
    await restarted.onCard(click(card, { action: 'confirm', shopNo: '3F-3032' }))
    assert.equal(count(), 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 0)
    const submission = pendingPayments(db)[0]!
    decidePayment(db, submission.id, 'approve', { companyName: '测试公司' })
    const row = db.prepare('SELECT amount,txn_time,txn_no,raw FROM "transaction"').get()!
    assert.equal(row.amount, 120050)
    assert.equal(row.txn_time, receipt.paymentDate)
    assert.equal(row.txn_no, receipt.transactionNo)
    assert.deepEqual(JSON.parse(String(row.raw)), { submissionId: submission.id, extraction: receipt, text: '\n作业帮 电费' })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 1)
  } finally { store.close(); db.close() }
})

await test('text before image, conflicting amounts, invalid evidence, extra screenshots and cancellation never write early', async () => {
  const db = await openFinanceDatabase(':memory:')
  const store = await openDingtalkStateStore(':memory:')
  let extraction = { ...receipt }
  const vision: PaymentVisionClient = { async *stream() { yield JSON.stringify(extraction) } }
  const harness = mount(db, store, { vision })
  let seq = 0
  const send = (text: string, image = false) => harness.handler({ text, deliveryId: String(++seq), conversationId: 'c', userId: 'u', ...(image ? { imageUrl: 'data:image/png;base64,AQID' } : {}) })
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','商户法人','作业帮')")
    await send('作业帮 电费1200.50')
    extraction.payee = '错误公司'
    assert.match((await send('', true)).text, /收款方/)
    assert.equal(store.getDraft('["c","u"]', 1_000_000)?.text, '作业帮 电费1200.50')
    extraction = { ...receipt }
    assert.match((await send('', true)).text, /截图候选金额/)
    const draft = store.getDraft('["c","u"]', 1_000_000)!
    assert.match((await send('', true)).text, /已有付款截图/)
    assert.match((await send('金额 300')).text, /多个金额|不一致/)
    assert.equal(store.getDraft('["c","u"]', 1_000_000)?.id, draft.id)
    await send('取消')
    assert.match((await send('确认 3F-3032')).text, /没有待确认/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_submission').get()?.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 0)
    await send('作业帮 电费')
    await send('', true)
    assert.match((await send('确认 3F-3032')).text, /已提交工作台审核/)
  } finally { store.close(); db.close() }
})

await test('cancelling while vision is pending cannot resurrect an empty or existing draft', async () => {
  for (const initial of ['', '作业帮 电费']) {
    const db = await openFinanceDatabase(':memory:')
    const store = await openDingtalkStateStore(':memory:')
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const harness = mount(db, store, { vision: { async *stream() { await pending; yield JSON.stringify(receipt) } } })
    const message = (text: string, deliveryId: string) => ({ text, deliveryId, conversationId: 'c', userId: 'u' })
    try {
      if (initial) await harness.handler(message(initial, 'initial'))
      const image = harness.handler({ ...message('', 'image'), imageUrl: 'data:image/png;base64,AQID' })
      await harness.handler(message('取消', 'cancel'))
      release()
      assert.match((await image).text, /草稿已变更/)
      assert.equal(store.countDrafts(1_000_000), 0)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_submission').get()?.n, 0)
    } finally { release(); store.close(); db.close() }
  }
})

await test('a repeated screenshot under a new draft settles with an explicit duplicate message, including callback replay', async () => {
  const db = await openFinanceDatabase(':memory:')
  const store = await openDingtalkStateStore(':memory:')
  try {
    db.exec("INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','商户法人','作业帮')")
    const vision: PaymentVisionClient = { async *stream() { yield JSON.stringify(receipt) } }
    const harness = mount(db, store, { template: 'tpl.schema', vision })
    let delivery = 0
    const send = (text: string, image = false) => harness.handler({ text, deliveryId: String(++delivery), conversationId: 'c', userId: 'u', ...(image ? { imageUrl: 'data:image/png;base64,AQID' } : {}) })
    await send('作业帮 电费', true)
    const first = harness.cards[0]!
    await harness.onCard(click(first, { action: 'confirm', shopNo: '3F-3032' }))
    await send('作业帮 电费', true)
    const repeated = harness.cards[1]!
    const result = await harness.onCard(click(repeated, { action: 'confirm', shopNo: '3F-3032' }))
    assert.match(result?.cardParamMap.content ?? '', /已在工作台待审核/)
    assert.equal(result?.cardParamMap.merchantList, '[]')
    assert.deepEqual(await harness.onCard(click(repeated, { action: 'confirm', shopNo: '3F-3032' })), result)
    assert.equal(store.countDrafts(1_000_000), 0)
    assert.equal(pendingPayments(db).length, 1)
    decidePayment(db, pendingPayments(db)[0]!.id, 'approve', { companyName: '测试公司' })
    await send('作业帮 电费', true)
    assert.match((await send('确认 3F-3032')).text, /该付款已登记/)
    assert.equal(store.countDrafts(1_000_000), 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get()?.n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation').get()?.n, 1)
  } finally { store.close(); db.close() }
})
