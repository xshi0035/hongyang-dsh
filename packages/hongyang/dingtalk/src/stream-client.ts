import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream, type RobotMessage } from 'dingtalk-stream'
import type { DingtalkConfig, DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

/** Production adapter for DingTalk Stream. Credentials are supplied by the host. */
export function createDingtalkStreamClient(config: DingtalkConfig): DingtalkStreamClient {
  const client = new DWClient(config)
  const handlers = new Set<(message: DingtalkTextMessage) => Promise<DingtalkReply>>()
  let connected = false
  client.registerAllEventListener((downstream) => {
    for (const handler of handlers) void dispatchRobotMessage(downstream, handler)
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

async function dispatchRobotMessage(downstream: DWClientDownStream, handler: (message: DingtalkTextMessage) => Promise<DingtalkReply>) {
  if (downstream.headers.topic !== TOPIC_ROBOT) return
  const message = JSON.parse(downstream.data) as RobotMessage
  const reply = await handler({
    deliveryId: message.msgId,
    userId: message.senderStaffId || message.senderId,
    conversationId: message.conversationId,
    text: message.text.content.trim(),
  })
  await fetch(message.sessionWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: reply.text } }),
  })
}
