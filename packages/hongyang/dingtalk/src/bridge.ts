import { registrationSummary, type HyFinanceService } from '@deepseek-ai/dsh-hy-finance'
import { extractPaymentFromImage, type PaymentVisionClient } from './vision.ts'
import type { DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

type FinanceRegistrationService = Pick<HyFinanceService, 'registerPayment' | 'merchants' | 'parsePayment'>
  & Partial<Pick<HyFinanceService, 'registerPaymentFromImage'>>

/**
 * Register normalized text or downloaded images through the finance service.
 * @param service - shared finance service; image registration must be available with vision.
 * @param stream - transport carrying authenticated robot messages.
 * @param vision - configured extraction client; absence produces a configuration notice.
 * @returns the transport with its finance message handler installed.
 */
export function createFinanceDingtalkBridge(
  service: FinanceRegistrationService,
  stream: DingtalkStreamClient,
  vision?: PaymentVisionClient,
): DingtalkStreamClient {
  const pending = new Map<string, string>()
  const handler = async (message: DingtalkTextMessage): Promise<DingtalkReply> => {
    const key = `${message.conversationId}:${message.userId}`
    const confirm = message.text.match(/^(?:确认|确定|选择)\s*([A-Za-z0-9_-]+)/u)
    if (confirm !== null) {
      const original = pending.get(key)
      if (original === undefined) return { text: '当前没有待确认的付款，请先发送金额和费项。' }
      pending.delete(key)
      try {
        return { text: registrationSummary(service.registerPayment(`${original} 商户编号 ${confirm[1] ?? ''}`)) }
      } catch (error) {
        return { text: '确认登记失败：' + (error instanceof Error ? error.message : '请重新发送') }
      }
    }
    if (message.text.trim() === '' && message.imageUrl === undefined) {
      return { text: '请补充付款金额和商户，例如“围辣转转火锅，电费500元”。' }
    }
    try {
      if (message.imageUrl !== undefined) {
        if (!vision || service.registerPaymentFromImage === undefined || !message.imageUrl.startsWith('data:')) {
          return { text: '已收到付款截图，但图片识别尚未配置；请补充一句商户和费项文字。' }
        }
        const extraction = await extractPaymentFromImage(vision, { imageDataUrl: message.imageUrl, textHint: message.text })
        return { text: registrationSummary(service.registerPaymentFromImage(extraction)) }
      }
      const parsed = service.parsePayment(message.text)
      const needle = message.text.trim().toLowerCase()
      const candidates = service.merchants().filter(m =>
        needle.includes(m.shopNo.toLowerCase()) || needle.includes(m.name.toLowerCase())
        || (m.brand.length > 1 && needle.includes(m.brand.toLowerCase())))
      if (candidates.length !== 1) {
        const choices = candidates.length === 0 ? '请补充商户名称或编号。' : candidates.map(m => `【${m.shopNo}】${m.name}${m.brand ? `（${m.brand}）` : ''}`).join('、')
        pending.set(key, message.text)
        return { text: `已识别：${parsed.feeType ?? '付款'} ${parsed.amount / 100} 元。需要确认商户：${choices} 回复“确认 编号”后再登记。` }
      }
      const result = service.registerPayment(message.text)
      if (!result.booked) {
        const needle = message.text.trim().toLowerCase()
        const candidates = service.merchants().filter(m => needle === '' || `${m.shopNo} ${m.name} ${m.brand}`.toLowerCase().includes(needle) || needle.includes(m.shopNo.toLowerCase()) || needle.includes(m.name.toLowerCase())).slice(0, 5)
        const choices = candidates.length === 0 ? '请补充商户名称或编号。' : candidates.map(m => `【${m.shopNo}】${m.name}${m.brand ? `（${m.brand}）` : ''}`).join('、')
        pending.set(key, message.text)
        return { text: `已识别金额和费项，但需要确认商户。候选：${choices} 回复“确认 编号”后再登记。` }
      }
      return { text: registrationSummary(result) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : ''
      if (reason.includes('需要正数金额')) {
        return { text: '我识别到这是一笔付款，但还没识别出金额。请用自然语言补充，例如“B1-1003 作业帮电费 200 元”。' }
      }
      if (reason.includes('需要正数金额') === false && /(?:电费|水费|租金|物业|经营服务费|停车)/u.test(message.text)) {
        return { text: '我识别到费项，但还缺商户信息。请补充商户名称或编号，例如“B1-1003 作业帮”。收到后我会列出匹配商户供你确认。' }
      }
      return { text: '付款登记未完成：' + (reason || '请补充商户、费项和金额') }
    }
  }
  stream.onMessage(handler)
  return stream
}
