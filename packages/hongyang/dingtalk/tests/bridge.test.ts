import assert from 'node:assert/strict'
import test from 'node:test'
import { createFinanceDingtalkBridge } from '../src/bridge.ts'

test('routes text through registration and supports unsubscribe', async () => {
  let handler: ((message: { text: string; imageUrl?: string }) => Promise<{ text: string }>) | undefined
  const stream = {
    connect: async () => {},
    close: async () => {},
    onMessage(next: typeof handler) {
      handler = next
      return () => { handler = undefined }
    },
  }
  const service = {
    registerPayment(text: string) {
      assert.equal(text, '围辣转转火锅电费500元')
      return { booked: true, merchantShopNo: 'A01', merchantName: '围辣转转火锅', parsed: { amount: 50000 } }
    },
  }
  createFinanceDingtalkBridge(service, stream)
  assert.ok(handler)
  assert.equal((await handler!({ text: '围辣转转火锅电费500元' })).text, '已登记：A01 围辣转转火锅 500 元。')
})

test('does not guess image content', async () => {
  let handler: ((message: { text: string; imageUrl?: string }) => Promise<{ text: string }>) | undefined
  const stream = { connect: async () => {}, close: async () => {}, onMessage(next: typeof handler) { handler = next; return () => {} } }
  createFinanceDingtalkBridge({ registerPayment: () => { throw new Error('must not parse image') } }, stream)
  assert.match((await handler!({ text: '', imageUrl: 'https://example/image.png' })).text, /图片识别尚未配置/)
})
