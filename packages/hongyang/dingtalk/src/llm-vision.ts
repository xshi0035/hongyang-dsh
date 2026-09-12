import { BlockAssembler, createUserMessage, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { PaymentVisionClient, PaymentVisionRequest } from './vision.ts'

export interface DingtalkLlmVisionHost {
  readonly llm: Pick<LlmRuntime, 'stream'>
  readonly attachments: Pick<AttachmentStore, 'saveImage'>
}

/** Adapt the host LLM and durable image store to the payment vision contract. */
export function createDingtalkLlmVisionClient(
  host: DingtalkLlmVisionHost,
  route: { provider: string; model: string },
): PaymentVisionClient {
  return {
    async *stream(request: PaymentVisionRequest) {
      const match = /^data:([^;]+);base64,(.*)$/u.exec(request.imageDataUrl)
      if (!match) throw new Error('付款图片必须是 data URL')
      const mediaType = match[1]
      if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
        throw new Error('付款图片媒体类型不受支持')
      }
      const attachment = await host.attachments.saveImage({ data: Buffer.from(match[2] ?? '', 'base64'), mediaType })
      const prompt = '请只输出 JSON，不要输出 Markdown。提取付款截图中的 amountText、paymentDate、transactionNo、payee、merchantText、feeText；看不清的字段省略。amountText 必须保留原始金额文字。' + (request.textHint ?? '')
      const messages = [createUserMessage({
        content: [{ type: 'text', text: prompt }, { type: 'image', attachment }],
        source: { kind: 'plugin', plugin: 'dsh-hy-dingtalk' },
      })]
      const assembler = new BlockAssembler()
      const stream = host.llm.stream({ provider: route.provider, model: route.model, messages, maxTokens: 512 })
      for await (const chunk of stream) assembler.push(chunk)
      for (const block of assembler.blocks()) if (block.type === 'text') yield block.text
    },
  }
}
