import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { FinishReason, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createDingtalkLlmVisionClient } from '../src/llm-vision.ts'
import { extractPaymentFromImage } from '../src/vision.ts'

await test('host vision preserves image content and rejects incomplete terminal responses', async () => {
  let observed: GenerateOptions | undefined
  const fixture = { amountText: '500元', payee: '测试公司', paymentDate: '2026-04-03' }
  const terminalReasons: Array<FinishReason | undefined> = [
    { kind: 'stop' }, { kind: 'max-tokens' }, undefined,
    { kind: 'error', failure: { code: 'TEST', message: 'failed' } },
    { kind: 'aborted', failure: { code: 'TEST', message: 'cancelled' } },
  ]
  for (const terminal of terminalReasons) {
    const client = createDingtalkLlmVisionClient({
      attachments: {
        saveImage(input) {
          assert.equal(input.mediaType, 'image/png')
          assert.equal(Buffer.from(input.data).toString('hex'), '010203')
          return Promise.resolve({
            attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 3, width: 1, height: 1,
          })
        },
      },
      llm: {
        async *stream(options) {
          observed = options
          yield { type: 'text-delta', index: 0, text: JSON.stringify(fixture) }
          if (terminal) yield { type: 'finish', reason: terminal }
        },
      },
    }, { provider: 'test', model: 'vision' })
    const result = extractPaymentFromImage(client, { imageDataUrl: 'data:image/png;base64,AQID', textHint: '测试商户' })
    if (terminal?.kind === 'stop') assert.deepEqual(await result, fixture)
    else await assert.rejects(result, /未正常完成/)
    assert.equal(observed?.provider, 'test')
    assert.equal(observed?.messages[0]?.content[1]?.type, 'image')
  }
})
