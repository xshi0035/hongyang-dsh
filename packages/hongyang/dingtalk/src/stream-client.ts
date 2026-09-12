import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream'
import type { DingtalkConfig, DingtalkImageDownloader, DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

/** Production adapter for DingTalk Stream. Credentials are supplied by the host. */
export function createDingtalkStreamClient(config: DingtalkConfig, imageDownloader?: DingtalkImageDownloader): DingtalkStreamClient {
  const client = new DWClient(config)
  const handlers = new Set<(message: DingtalkTextMessage) => Promise<DingtalkReply>>()
  let connected = false
  client.registerAllEventListener((downstream) => {
    for (const handler of handlers) void dispatchRobotMessage(downstream, handler, imageDownloader)
    return { status: EventAck.SUCCESS }
  })
  return {
    onMessage(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    async connect() {
      if (!connected) {
        await client.connect()
        connected = true
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

/** Read deployment credentials without making missing configuration fatal. */
export function dingtalkConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DingtalkConfig | undefined {
  const clientId = env.DINGTALK_CLIENT_ID?.trim()
  const clientSecret = env.DINGTALK_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return undefined
  return { clientId, clientSecret, debug: env.DINGTALK_DEBUG === '1' }
}

/** Download a DingTalk robot image and return it as a data URL for vision input. */
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
  await fetch(raw.sessionWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: reply.text } }),
  })
}
