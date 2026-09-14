export interface DingtalkTextMessage {
  readonly deliveryId: string
  readonly userId: string
  readonly conversationId: string
  readonly text: string
  readonly imageUrl?: string
}
export interface DingtalkReply { readonly text: string }
export interface DingtalkCardCallback {
  readonly deliveryId: string
  readonly userId?: string
  readonly conversationId?: string
  readonly value: Record<string, unknown>
}
export interface DingtalkStreamClient {
  connect(): Promise<void>
  close(): Promise<void>
  onMessage(handler: (message: DingtalkTextMessage) => Promise<DingtalkReply>): () => void
  onCard(handler: (callback: DingtalkCardCallback) => Promise<void>): () => void
}
export interface DingtalkConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly debug?: boolean
}
export interface DingtalkImageDownloader {
  download(downloadCode: string): Promise<string>
}
