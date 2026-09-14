import { registrationSummary, type HyFinanceService } from '@deepseek-ai/dsh-hy-finance'
import { extractPaymentFromImage, type PaymentVisionClient } from './vision.ts'
import type { DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

type FinanceRegistrationService = Pick<HyFinanceService, 'previewPayment' | 'confirmPayment'>
  & Partial<Pick<HyFinanceService, 'registerPaymentFromImage'>>

/**
 * Collect payment details without writing money until the user confirms a candidate.
 * @param service - Finance service owning the operation.
 * @param stream - Transport receiving the registered payment handler.
 * @param vision - Optional screenshot extraction client.
 * @returns The supplied Stream client with its payment handler installed.
 */
export function createFinanceDingtalkBridge(
  service: FinanceRegistrationService,
  stream: DingtalkStreamClient,
  vision?: PaymentVisionClient,
): DingtalkStreamClient {
  const pending = new Map<string, { text: string; expires: number }>()
  const handler = async (message: DingtalkTextMessage): Promise<DingtalkReply> => {
    const key = JSON.stringify([message.conversationId, message.userId])
    const now = Date.now()
    for (const [id, draft] of pending) if (draft.expires <= now) pending.delete(id)
    const text = message.text.trim()
    if (/^(取消|取消登记|重新开始)$/u.test(text)) {
      pending.delete(key)
      return { text: '已取消草稿，本次没有登记流水。' }
    }
    const confirm = /^(?:确认|确定|选择)\s+(.+)$/u.exec(text)
    if (confirm !== null) {
      const draft = pending.get(key)
      if (draft === undefined) return { text: '当前没有待确认的付款，或草稿已过期。请重新发送付款信息。' }
      try {
        const result = service.confirmPayment(draft.text, confirm[1]?.trim() ?? '')
        pending.delete(key)
        return { text: registrationSummary(result) }
      } catch (error) {
        return { text: `确认未完成，草稿已保留：${error instanceof Error ? error.message : '请稍后再试'}` }
      }
    }
    if (/^(你好|您好|帮助|怎么用)[！!。]?$/u.test(text)) {
      return { text: '你好，可以告诉我“电费200”，再补充商户名称。我会查询编号让你确认，确认前不登记。' }
    }
    try {
      if (message.imageUrl !== undefined) {
        if (!vision || !message.imageUrl.startsWith('data:')) {
          return { text: '已收到付款截图，但图片识别尚未配置；请补充一句商户和费项文字。' }
        }
        // Image extraction remains a separate path until it can join a confirmation draft.
        await extractPaymentFromImage(vision, { imageDataUrl: message.imageUrl, textHint: text })
        return { text: '截图已识别，图片确认登记尚未接入。请先用文字说明金额、费项和商户，本次未登记。' }
      }
      const previous = pending.get(key)?.text
      const combined = previous === undefined ? text : `${previous}\n${text}`
      if (combined.length > 4000) return { text: '本次信息过长，请回复“取消”后按笔重新发送。' }
      const preview = service.previewPayment(combined)
      if (!pending.has(key) && pending.size >= 1000) return { text: '待确认草稿已满，请稍后再试。' }
      pending.set(key, { text: combined, expires: now + 30 * 60 * 1000 })
      const choices = preview.candidates.slice(0, 5).map(m => `【${m.shopNo}】${m.name} ${m.brand}`).join('\n')
      const question = preview.candidates.length === 0
        ? '这是哪个商户的付款？告诉我商户名称，我来查询编号。'
        : preview.ready
          ? '请核对商户和金额，回复“确认 编号”后登记。'
          : '请补充金额或费项；之前的信息已保留。'
      const textReply = `付款待确认（尚未登记）\n${preview.summary}\n${choices}\n${question}\n可回复“取消”；草稿30分钟后过期。`
      const templateId = process.env.DINGTALK_CARD_TEMPLATE_ID?.trim()
      if (templateId && preview.candidates.length > 0 && stream.sendCard) {
        return { text: textReply, card: { templateId, userId: message.userId, cardData: { content: '', summary: preview.summary, merchantList: JSON.stringify(preview.candidates.map(m => ({ ...m, displayName: m.brand || m.name }))) } } }
      }
      return { text: textReply }
    } catch (error) {
      return { text: `暂未登记，原草稿已保留：${error instanceof Error ? error.message : '请补充付款信息'}` }
    }
  }
  stream.onMessage(handler)
  return stream
}
