import { registrationSummary, type HyFinanceService } from '@deepseek-ai/dsh-hy-finance'
import { extractPaymentFromImage, type PaymentVisionClient } from './vision.ts'
import type { DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

type FinanceRegistrationService = Pick<HyFinanceService, 'registerPayment'>
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
  const handler = async (message: DingtalkTextMessage): Promise<DingtalkReply> => {
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
      return { text: registrationSummary(service.registerPayment(message.text)) }
    } catch (error) {
      return { text: '付款登记未完成：' + (error instanceof Error ? error.message : '请补充文字说明') }
    }
  }
  stream.onMessage(handler)
  return stream
}
