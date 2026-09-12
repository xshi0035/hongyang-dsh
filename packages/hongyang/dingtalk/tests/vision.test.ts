import assert from 'node:assert/strict'
import test from 'node:test'
import { extractPaymentFromImage } from '../src/vision.ts'

void test('passes image extraction output to the finance schema', async () => {
  const result = await extractPaymentFromImage({
    async *stream() {
      yield '{"amountText":"500元","merchantText":"围辣转转火锅","feeText":"电费"}'
    },
  }, { imageDataUrl: 'data:image/png;base64,AQID', textHint: '付款截图' })
  assert.equal(result.amountText, '500元')
  assert.equal(result.merchantText, '围辣转转火锅')
})
