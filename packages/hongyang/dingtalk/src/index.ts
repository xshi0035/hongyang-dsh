import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-hy-finance'
import { createFinanceDingtalkBridge } from './bridge.ts'
import { openDingtalkStateStore, type DingtalkStateStore } from './store.ts'
import { createDingtalkImageDownloader, createDingtalkStreamClient, dingtalkConfigFromEnv } from './stream-client.ts'
import { createDingtalkLlmVisionClient } from './llm-vision.ts'
import type { DingtalkStreamClient } from './types.ts'

/** Cordis plugin name for the optional DingTalk Stream bridge. */
export const name = 'hy-dingtalk'
/** This bridge waits for the finance service before opening a network connection. */
export const inject = ['hyFinance']

/** Explicit image route; empty fields use the corresponding deployment environment values. */
export interface Config {
  /** Registered image-capable provider; empty reads DINGTALK_VISION_PROVIDER. */
  visionProvider: string
  /** Image-capable model on the selected provider; empty reads DINGTALK_VISION_MODEL. */
  visionModel: string
}

/** Vision route configurable from the host profile without embedding credentials. */
export const Config: z<Config> = z.object({
  visionProvider: z.string().default(''),
  visionModel: z.string().default(''),
})

/**
 * Mount the DingTalk payment bridge in the host profile.
 * @param ctx - Owning plugin context.
 * @param options - Vision route; robot credentials come from the process environment.
 */
export function apply(ctx: Context, options: Config): void {
  const config = dingtalkConfigFromEnv()
  if (config === undefined) {
    console.warn('hy-dingtalk: credentials missing; Stream is disabled')
    return
  }
  const provider = options.visionProvider.trim() || process.env.DINGTALK_VISION_PROVIDER?.trim()
  const model = options.visionModel.trim() || process.env.DINGTALK_VISION_MODEL?.trim()
  if (Boolean(provider) !== Boolean(model)) throw new Error('Configure both visionProvider and visionModel (or DINGTALK_VISION_PROVIDER and DINGTALK_VISION_MODEL)')
  const vision = provider && model ? createDingtalkLlmVisionClient({
    get llm() { const llm = ctx.get('llm'); if (llm === undefined) throw new Error('付款图片识别需要加载 llm 服务'); return llm },
    get attachments() { const attachments = ctx.get('attachments'); if (attachments === undefined) throw new Error('付款图片识别需要加载 attachments 服务'); return attachments },
  }, { provider, model }) : undefined
  const cardTemplateId = process.env.DINGTALK_CARD_TEMPLATE_ID?.trim() || undefined
  const cardCallbackRouteKey = process.env.DINGTALK_CARD_ROUTE_KEY?.trim() || undefined
  console.info(`hy-dingtalk: finance service ready; starting Stream (${cardTemplateId === undefined ? 'text confirmation only: DINGTALK_CARD_TEMPLATE_ID unset' : 'interactive cards enabled'})`)
  ctx.inject(['hyFinance'], (scope) => {
    const service = scope.hyFinance
    let store: DingtalkStateStore | undefined
    let stream: DingtalkStreamClient | undefined
    let unregisterTodo: (() => void) | undefined
    scope.effect(() => () => {
      unregisterTodo?.()
      void stream?.close()
      store?.close()
    }, 'hy-dingtalk: close stream')
    void (async () => {
      const opened = await openDingtalkStateStore(join(dirname(service.config.dbPath), 'dingtalk.db'))
      store = opened
      unregisterTodo = service.registerTodoProvider({ id: 'dingtalk-drafts', label: '钉钉待确认草稿', count: () => opened.countDrafts(Date.now()) })
      stream = createFinanceDingtalkBridge(service, createDingtalkStreamClient(config, createDingtalkImageDownloader(config)), {
        ...(vision === undefined ? {} : { vision }),
        store,
        ...(cardTemplateId === undefined ? {} : { cardTemplateId }),
        ...(cardCallbackRouteKey === undefined ? {} : { cardCallbackRouteKey }),
      })
      await stream.connect()
    })().catch((error: unknown) => {
      console.error('hy-dingtalk: Stream start failed', error instanceof Error ? error.message : error)
    })
  })
}

export type * from './types.ts'
export { createFinanceDingtalkBridge, candidateDisplayName } from './bridge.ts'
export type { FinanceDingtalkBridgeOptions } from './bridge.ts'
export { openDingtalkStateStore, HY_DINGTALK_STATE_VERSION } from './store.ts'
export type { DingtalkStateStore, DingtalkDraft, DingtalkCardRecord, DingtalkCardStatus } from './store.ts'
export {
  cardCallbackResponse, createDingtalkImageDownloader, createDingtalkStreamClient, dingtalkConfigFromEnv, interactiveCardRequestBody,
  parseDingtalkCardCallback, sendDingtalkInteractiveCard, updateDingtalkCard,
} from './stream-client.ts'
export { extractPaymentFromImage } from './vision.ts'
export type { PaymentVisionClient, PaymentVisionRequest } from './vision.ts'
export { createDingtalkLlmVisionClient } from './llm-vision.ts'
export type { DingtalkLlmVisionHost } from './llm-vision.ts'
