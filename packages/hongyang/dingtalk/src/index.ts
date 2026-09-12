import type { Context } from '@deepseek-ai/cordis'
import type { HyFinanceService } from '@deepseek-ai/dsh-hy-finance'
import { createFinanceDingtalkBridge } from './bridge.ts'
import { createDingtalkStreamClient, dingtalkConfigFromEnv } from './stream-client.ts'

/** Cordis plugin name for the optional DingTalk Stream bridge. */
export const name = 'hy-dingtalk'
/** This bridge waits for the finance service before opening a network connection. */
export const inject = ['hyFinance']

/** Mount the text-capable DingTalk Stream bridge in the host profile. */
export function apply(ctx: Context): void {
  const config = dingtalkConfigFromEnv()
  if (config === undefined) return
  ctx.inject(['hyFinance'], (scope) => {
    const service = scope.hyFinance as HyFinanceService
    const stream = createFinanceDingtalkBridge(service, createDingtalkStreamClient(config))
    void stream.connect()
    ctx.effect(() => () => stream.close(), 'hy-dingtalk: close stream')
  })
}

export type * from './types.ts'
export { createFinanceDingtalkBridge }
export { createDingtalkImageDownloader, createDingtalkStreamClient, dingtalkConfigFromEnv } from './stream-client.ts'
export { extractPaymentFromImage } from './vision.ts'
export type { PaymentVisionClient, PaymentVisionRequest } from './vision.ts'
export { createDingtalkLlmVisionClient } from './llm-vision.ts'
export type { DingtalkLlmVisionHost } from './llm-vision.ts'
