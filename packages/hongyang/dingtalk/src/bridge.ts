import type { DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

type FinanceRegistrationService = {
  registerPayment(text: string): { booked: boolean; merchantShopNo?: string; merchantName?: string; parsed: { amount: number } }
}

/** Route normalized DingTalk messages into the finance registration provider. */
export function createFinanceDingtalkBridge(service: FinanceRegistrationService, stream: DingtalkStreamClient): DingtalkStreamClient {
  const handler = (message: DingtalkTextMessage): Promise<DingtalkReply> => {
    if (message.text.trim() === '' && message.imageUrl === undefined) return Promise.resolve({ text: '请补充付款金额和商户，例如“围辣转转火锅，电费500元”。' })
    if (message.imageUrl !== undefined) return Promise.resolve({ text: '已收到付款截图，但图片识别尚未配置；请补充一句商户和费项文字。' })
    const result = service.registerPayment(message.text)
    if (result.booked) return Promise.resolve({ text: '已登记：' + (result.merchantShopNo ?? '') + ' ' + (result.merchantName ?? '') + ' ' + String(result.parsed.amount / 100) + ' 元。' })
    return Promise.resolve({ text: '已记录 ' + String(result.parsed.amount / 100) + ' 元，请补充商户名和费项后确认。' })
  }
  stream.onMessage(handler)
  return stream
}
