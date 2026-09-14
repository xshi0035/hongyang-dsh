import { DWClient, TOPIC_CARD, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream'
import type { DingtalkCardCallback, DingtalkConfig, DingtalkImageDownloader, DingtalkInteractiveCardOptions, DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

/**
 * Production adapter for DingTalk Stream. Credentials are supplied by the host.
 * @param config - Validated operation configuration.
 * @param imageDownloader - Optional attachment converter producing image data URLs.
 * @returns Transport lifecycle and handler operations.
 */
export function createDingtalkStreamClient(config: DingtalkConfig, imageDownloader?: DingtalkImageDownloader): DingtalkStreamClient {
  const client = new DWClient(config)
  const handlers = new Set<(message: DingtalkTextMessage) => Promise<DingtalkReply>>()
  const cardHandlers = new Set<(callback: DingtalkCardCallback) => Promise<void>>()
  const delivered = new Set<string>()
  let connected = false
  client.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
    if (delivered.has(downstream.headers.messageId)) return
    delivered.add(downstream.headers.messageId)
    if (delivered.size > 1000) delivered.delete(delivered.values().next().value as string)
    for (const handler of handlers) {
      void dispatchRobotMessage(downstream, handler, imageDownloader, config).finally(() => {
        client.socketCallBackResponse(downstream.headers.messageId, { status: 'SUCCESS' })
      })
    }
  })
  client.registerCallbackListener(TOPIC_CARD, (downstream) => {
    void dispatchCardCallback(downstream, cardHandlers).finally(() => {
      client.socketCallBackResponse(downstream.headers.messageId, { status: 'SUCCESS' })
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

async function dispatchCardCallback(
  downstream: DWClientDownStream,
  handlers: Set<(callback: DingtalkCardCallback) => Promise<void>>,
): Promise<void> {
  if (downstream.headers.topic !== TOPIC_CARD) return
  const raw = JSON.parse(downstream.data) as Record<string, unknown>
  const callback: DingtalkCardCallback = {
    deliveryId: downstream.headers.messageId,
    ...(typeof raw.userId === 'string' ? { userId: raw.userId } : {}),
    ...(typeof raw.conversationId === 'string' ? { conversationId: raw.conversationId } : {}),
    value: raw,
  }
  for (const handler of handlers) await handler(callback)
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
  const tokenResponse = await fetchImpl('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret }),
  })
  if (!tokenResponse.ok) throw new Error(`钉钉 access token 获取失败：${tokenResponse.status}`)
  const token = (await tokenResponse.json()) as { accessToken?: string }
  if (!token.accessToken) throw new Error('钉钉 access token 响应缺少 accessToken')
  const body = {
    userId: options.userId,
    cardTemplateId: options.templateId,
    robotCode: config.clientId,
    outTrackId: `hy-${Date.now()}`,
    callbackType: 'STREAM',
    cardData: { cardParamMap: Object.fromEntries(Object.entries(options.cardData).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])) },
    ...(options.userId ? { openSpaceId: `dtv1.card//im_robot.${options.userId}`, userIdType: 1 } : {}),
  }
  const response = await fetchImpl('https://api.dingtalk.com/v1.0/card/instances/createAndDeliver', {
    method: 'POST', headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(`hy-dingtalk: card send failed ${response.status}`, detail)
    throw new Error(`钉钉互动卡片发送失败：${response.status}${detail ? ` ${detail}` : ''}`)
  }
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
  let accessToken: string | undefined
  return {
    async download(downloadCode) {
      if (accessToken === undefined) {
        const tokenResponse = await fetchImpl('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret }),
        })
        if (!tokenResponse.ok) throw new Error(`钉钉 access token 获取失败：${tokenResponse.status}`)
        const token = (await tokenResponse.json()) as { accessToken?: string }
        if (!token.accessToken) throw new Error('钉钉 access token 响应缺少 accessToken')
        accessToken = token.accessToken
      }
      const response = await fetchImpl('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
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
  config?: DingtalkConfig,
) {
  if (downstream.headers.topic !== TOPIC_ROBOT) return
  const raw = JSON.parse(downstream.data) as unknown as {
    msgtype?: string
    msgId: string
    senderStaffId?: string
    senderId: string
    conversationId: string
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
    text,
    ...(imageUrl === undefined ? {} : { imageUrl }),
  })
  if (reply.card !== undefined && config !== undefined) {
    try {
      await sendDingtalkInteractiveCard(config, { ...reply.card, userId: raw.senderStaffId || raw.senderId })
      return
    } catch {
      // Card delivery failures fall back to the text reply below.
    }
  }
  await fetch(raw.sessionWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: reply.text } }),
  })
}
