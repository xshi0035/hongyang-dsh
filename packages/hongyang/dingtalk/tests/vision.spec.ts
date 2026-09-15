import { expect, it } from 'vitest'
import { extractPaymentFromImage } from '../src/vision.ts'

it('passes image extraction output to the finance schema', async () => {
  const result = await extractPaymentFromImage({
    async *stream() {
      yield '{"amountText":"500元","merchantText":"围辣转转火锅","feeText":"电费"}'
    },
  }, { imageDataUrl: 'data:image/png;base64,AQID', textHint: '付款截图' })
  expect(result.amountText).toBe('500元')
  expect(result.merchantText).toBe('围辣转转火锅')
})
