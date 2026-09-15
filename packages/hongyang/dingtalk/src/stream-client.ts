import { randomUUID } from 'node:crypto'
import { DWClient, TOPIC_CARD, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream'
import type { DingtalkCardCallback, DingtalkCardUpdate, DingtalkConfig, DingtalkImageDownloader, DingtalkInteractiveCardOptions, DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

const ACCESS_TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken'
const CARD_DELIVER_URL = 'https://api.dingtalk.com/v1.0/card/instances/createAndDeliver'
const MESSAGE_FILE_URL = 'https://api.dingtalk.com/v1.0/robot/messageFiles/download'
const CARD_STREAMING_URL = 'https://api.dingtalk.com/v1.0/card/streaming'
const CARD_INSTANCE_URL = 'https://api.dingtalk.com/v1.0/card/instances'
/** AI-card flow states as DingTalk numbers them: 1 processing, 2 inputting, 3 finished, 4 executing, 5 failed. */
const AI_CARD_PROCESSING = '1'
const AI_CARD_FINISHED = '3'

/**
 * Production adapter for DingTalk Stream. Credentials are supplied by the host.
 * @param config - Validated operation configuration.
 * @param imageDownloader - Optional attachment converter producing image data URLs.
 * @returns Transport lifecycle and handler operations.
 */
export function createDingtalkStreamClient(config: DingtalkConfig, imageDownloader?: DingtalkImageDownloader): DingtalkStreamClient {
  const client = new DWClient(config)
  const handlers = new Set<(message: DingtalkTextMessage) => Promise<DingtalkReply>>()
  const cardHandlers = new Set<(callback: DingtalkCardCallback) => Promise<DingtalkCardUpdate | undefined>>()
  const delivered = new Set<string>()
  let connected = false
  client.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
    if (delivered.has(downstream.headers.messageId)) return
    delivered.add(downstream.headers.messageId)
    if (delivered.size > 1000) delivered.delete(delivered.values().next().value as string)
    for (const handler of handlers) {
      void dispatchRobotMessage(downstream, handler, imageDownloader)
        .catch((error: unknown) => { console.error('hy-dingtalk: robot message failed', errorMessage(error)) })
        .finally(() => { client.socketCallBackResponse(downstream.headers.messageId, { status: 'SUCCESS' }) })
    }
  })
  client.registerCallbackListener(TOPIC_CARD, (downstream) => {
    void dispatchCardCallback(downstream, cardHandlers)
      .catch((error: unknown) => {
        console.error('hy-dingtalk: card callback failed', errorMessage(error))
        return undefined
      })
      .then((result) => {
        client.socketCallBackResponse(downstream.headers.messageId, result === undefined ? {} : cardCallbackResponse(result.update))
        if (result === undefined) return
        return updateDingtalkCard(config, result.outTrackId, result.update)
          .catch((error: unknown) => { console.error('hy-dingtalk: card update failed', errorMessage(error)) })
      })
  })
  return {
    onMessage(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    onCard(handler) { cardHandlers.add(handler); return () => cardHandlers.delete(handler) },
    sendCard(options) { return sendDingtalkInteractiveCard(config, options) },
    async connect() {
      if (!connected) {
        await client.connect()
        connected = client.connected
        console.info(connected ? 'hy-dingtalk: Stream connected' : 'hy-dingtalk: Stream connection failed; SDK will retry')
      }
    },
    close() {
      if (connected) {
        client.disconnect()
        connected = false
      }
      return Promise.resolve()
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Parse one card callback frame into the pressed button's parameters.
 * @param messageId - Stream frame id used to acknowledge the callback.
 * @param data - Raw JSON payload of the frame.
 * @returns Card instance id, user, and untrusted button parameters.
 */
export function parseDingtalkCardCallback(messageId: string, data: string): DingtalkCardCallback {
  const raw = JSON.parse(data) as unknown
  const value = isRecord(raw) ? raw : {}
  let content: unknown = value.content
  if (typeof content === 'string') {
    try { content = JSON.parse(content) } catch { content = {} }
  }
  const privateData = isRecord(content) && isRecord(content.cardPrivateData) ? content.cardPrivateData : {}
  const params = isRecord(privateData.params) ? privateData.params : {}
  const actionIds = Array.isArray(privateData.actionIds) ? privateData.actionIds.filter((id): id is string => typeof id === 'string') : []
  const userId = optionalString(value.userId)
  const spaceType = optionalString(value.spaceType)
  const spaceId = optionalString(value.spaceId)
  return {
    deliveryId: messageId,
    outTrackId: optionalString(value.outTrackId) ?? '',
    ...(userId === undefined ? {} : { userId }),
    ...(spaceType === undefined ? {} : { spaceType }),
    ...(spaceId === undefined ? {} : { spaceId }),
    params,
    actionIds,
    value,
  }
}

/**
 * Build the Stream response that rewrites card variables after a click.
 * @param update - Variables to overwrite; other variables keep their values.
 * @returns Response body for the card callback frame.
 */
export function cardCallbackResponse(update: DingtalkCardUpdate): Record<string, unknown> {
  return {
    cardUpdateOptions: { updateCardDataByKey: true },
    cardData: { cardParamMap: update.cardParamMap },
  }
}

async function dispatchCardCallback(
  downstream: DWClientDownStream,
  handlers: Set<(callback: DingtalkCardCallback) => Promise<DingtalkCardUpdate | undefined>>,
): Promise<{ outTrackId: string; update: DingtalkCardUpdate } | undefined> {
  if (downstream.headers.topic !== TOPIC_CARD) return undefined
  const callback = parseDingtalkCardCallback(downstream.headers.messageId, downstream.data)
  let update: DingtalkCardUpdate | undefined
  for (const handler of handlers) update = (await handler(callback)) ?? update
  return update === undefined ? undefined : { outTrackId: callback.outTrackId, update }
}

/**
 * Rewrite a delivered card after a click: stream `content` (AI cards ignore it
 * in callback responses), then update the remaining variables and finish the flow.
 * @param config - Validated operation configuration.
 * @param outTrackId - Card instance id.
 * @param update - Variables to overwrite.
 * @param fetchImpl - HTTP implementation; defaults to global fetch.
 */
export async function updateDingtalkCard(
  config: DingtalkConfig,
  outTrackId: string,
  update: DingtalkCardUpdate,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const accessToken = await fetchAccessToken(config, fetchImpl)
  const { content, ...rest } = update.cardParamMap
  if (content !== undefined) {
    await finalizeDingtalkAiCard(accessToken, outTrackId, { key: 'content', content }, fetchImpl, rest)
    return
  }
  await putCardInstance(accessToken, outTrackId, rest, fetchImpl)
}

async function putCardInstance(
  accessToken: string,
  outTrackId: string,
  cardParamMap: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<void> {
  const finished = await fetchImpl(CARD_INSTANCE_URL, {
    method: 'PUT', headers: { 'x-acs-dingtalk-access-token': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ outTrackId, cardData: { cardParamMap }, cardUpdateOptions: { updateCardDataByKey: true } }),
  })
  if (!finished.ok) {
    const detail = await finished.text().catch(() => '')
    throw new Error(`钉钉卡片更新失败：${finished.status}${detail ? ` ${detail}` : ''}`)
  }
}

/**
 * Read deployment credentials without making missing configuration fatal.
 * @param env - Environment map; defaults to the current process.
 * @returns Credentials, or undefined when either credential is absent.
 */
export function dingtalkConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DingtalkConfig | undefined {
  const clientId = env.DINGTALK_CLIENT_ID?.trim()
  const clientSecret = env.DINGTALK_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return undefined
  return { clientId, clientSecret, debug: env.DINGTALK_DEBUG === '1' }
}

async function fetchAccessToken(config: DingtalkConfig, fetchImpl: typeof fetch): Promise<string> {
  const tokenResponse = await fetchImpl(ACCESS_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret }),
  })
  if (!tokenResponse.ok) throw new Error(`钉钉 access token 获取失败：${tokenResponse.status}`)
  const token = (await tokenResponse.json()) as { accessToken?: string }
  if (!token.accessToken) throw new Error('钉钉 access token 响应缺少 accessToken')
  return token.accessToken
}

/**
 * Build the create-and-deliver request for a robot single chat or a group.
 * @param config - Validated operation configuration.
 * @param options - Template, instance id, recipient, and card variables.
 * @returns JSON body in the shape the DingTalk card API expects.
 */
export function interactiveCardRequestBody(config: DingtalkConfig, options: DingtalkInteractiveCardOptions): Record<string, unknown> {
  const group = options.conversationType === 'group' && options.conversationId !== undefined
  return {
    cardTemplateId: options.templateId,
    outTrackId: options.outTrackId,
    callbackType: 'STREAM',
    ...(options.callbackRouteKey === undefined ? {} : { callbackRouteKey: options.callbackRouteKey }),
    cardData: {
      cardParamMap: options.streaming === undefined ? options.cardData : { ...options.cardData, flowStatus: AI_CARD_PROCESSING },
    },
    userIdType: 1,
    ...(group
      ? {
        openSpaceId: `dtv1.card//IM_GROUP.${options.conversationId ?? ''}`,
        imGroupOpenSpaceModel: { supportForward: true },
        imGroupOpenDeliverModel: { robotCode: config.clientId },
      }
      : {
        openSpaceId: `dtv1.card//IM_ROBOT.${options.userId}`,
        imRobotOpenSpaceModel: { supportForward: true },
        imRobotOpenDeliverModel: { spaceType: 'IM_ROBOT', robotCode: config.clientId },
      }),
  }
}

/**
 * Send a published interactive card to the current robot conversation.
 * @param config - Validated operation configuration.
 * @param options - Delivery or validation settings for this operation.
 * @param fetchImpl - HTTP implementation; defaults to global fetch.
 */
export async function sendDingtalkInteractiveCard(
  config: DingtalkConfig,
  options: DingtalkInteractiveCardOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const accessToken = await fetchAccessToken(config, fetchImpl)
  const response = await fetchImpl(CARD_DELIVER_URL, {
    method: 'POST',
    headers: { 'x-acs-dingtalk-access-token': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify(interactiveCardRequestBody(config, options)),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`钉钉互动卡片发送失败：${response.status}${detail ? ` ${detail}` : ''}`)
  }
  if (options.streaming !== undefined) await finalizeDingtalkAiCard(accessToken, options.outTrackId, options.streaming, fetchImpl)
}

/**
 * Stream the final text into an AI card and move it out of "processing".
 * @param accessToken - Application access token already obtained for this delivery.
 * @param outTrackId - Card instance id.
 * @param streaming - Streaming variable name and its full content.
 * @param fetchImpl - HTTP implementation.
 */
async function finalizeDingtalkAiCard(
  accessToken: string,
  outTrackId: string,
  streaming: { readonly key: string; readonly content: string },
  fetchImpl: typeof fetch,
  extraParams: Record<string, string> = {},
): Promise<void> {
  const streamed = await fetchImpl(CARD_STREAMING_URL, {
    method: 'PUT', headers: { 'x-acs-dingtalk-access-token': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({
      outTrackId, guid: randomUUID(), key: streaming.key, content: streaming.content, isFull: true, isFinalize: true, isError: false,
    }),
  })
  if (!streamed.ok) {
    const detail = await streamed.text().catch(() => '')
    throw new Error(`钉钉 AI 卡片流式收尾失败：${streamed.status}${detail ? ` ${detail}` : ''}`)
  }
  await putCardInstance(accessToken, outTrackId, { ...extraParams, flowStatus: AI_CARD_FINISHED }, fetchImpl)
}

/**
 * Download a DingTalk robot image and return it as a data URL for vision input.
 * @param config - Validated operation configuration.
 * @param fetchImpl - HTTP implementation; defaults to global fetch.
 * @returns An authenticated downloader producing image data URLs.
 */
export function createDingtalkImageDownloader(
  config: DingtalkConfig,
  fetchImpl: typeof fetch = fetch,
): DingtalkImageDownloader {
  return {
    async download(downloadCode) {
      const accessToken = await fetchAccessToken(config, fetchImpl)
      const response = await fetchImpl(MESSAGE_FILE_URL, {
        method: 'POST',
        headers: { 'x-acs-dingtalk-access-token': accessToken, 'content-type': 'application/json' },
        body: JSON.stringify({ robotCode: config.clientId, downloadCode }),
      })
      if (!response.ok) throw new Error(`钉钉图片下载地址获取失败：${response.status}`)
      const payload = (await response.json()) as { downloadUrl?: string }
      if (!payload.downloadUrl) throw new Error('钉钉图片下载响应缺少 downloadUrl')
      const image = await fetchImpl(payload.downloadUrl)
      if (!image.ok) throw new Error(`钉钉图片内容下载失败：${image.status}`)
      const bytes = Buffer.from(await image.arrayBuffer()).toString('base64')
      return `data:${image.headers.get('content-type') ?? 'image/jpeg'};base64,${bytes}`
    },
  }
}

async function dispatchRobotMessage(
  downstream: DWClientDownStream,
  handler: (message: DingtalkTextMessage) => Promise<DingtalkReply>,
  imageDownloader?: DingtalkImageDownloader,
): Promise<void> {
  if (downstream.headers.topic !== TOPIC_ROBOT) return
  const raw = JSON.parse(downstream.data) as unknown as {
    msgtype?: string
    msgId: string
    senderStaffId?: string
    senderId: string
    conversationId: string
    conversationType?: string
    text?: { content?: string }
    content?: { downloadCode?: string }
    sessionWebhook: string
  }
  const text = raw.text?.content?.trim() ?? ''
  const imageDownloadCode = raw.content?.downloadCode
  if (raw.msgtype !== 'text' && raw.msgtype !== 'picture') return
  const imageUrl = imageDownloadCode === undefined
    ? undefined
    : imageDownloader === undefined
      ? 'downloadCode:' + imageDownloadCode
      : await imageDownloader.download(imageDownloadCode)
  const reply = await handler({
    deliveryId: raw.msgId,
    userId: raw.senderStaffId || raw.senderId,
    conversationId: raw.conversationId,
    conversationType: raw.conversationType === '2' ? 'group' : 'single',
    text,
    ...(imageUrl === undefined ? {} : { imageUrl }),
  })
  if (reply.silent === true || reply.text === '') return
  await fetch(raw.sessionWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: reply.text } }),
  })
}
