/**
 * Normalized message with delivery identity for duplicate suppression.
 */
export interface DingtalkTextMessage {
  readonly deliveryId: string
  readonly userId: string
  readonly conversationId: string
  readonly text: string
  readonly imageUrl?: string
}
/**
 * Reply text and optional card; text is retained for delivery fallback.
 */
export interface DingtalkReply {
  readonly text: string
  readonly card?: DingtalkInteractiveCardOptions
}
/**
 * Card event identity and untrusted callback fields.
 */
export interface DingtalkCardCallback {
  readonly deliveryId: string
  readonly userId?: string
  readonly conversationId?: string
  readonly value: Record<string, unknown>
}
/**
 * Stream lifecycle, disposable handler registrations, and optional card delivery.
 */
export interface DingtalkStreamClient {
  connect(): Promise<void>
  close(): Promise<void>
  onMessage(handler: (message: DingtalkTextMessage) => Promise<DingtalkReply>): () => void
  onCard(handler: (callback: DingtalkCardCallback) => Promise<void>): () => void
  sendCard?(options: DingtalkInteractiveCardOptions): Promise<void>
}
/**
 * DingTalk application credentials and SDK logging settings.
 */
export interface DingtalkConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly debug?: boolean
}
/**
 * Template, recipient, and serialized public card variables.
 */
export interface DingtalkInteractiveCardOptions {
  readonly templateId: string
  readonly conversationId?: string
  readonly userId?: string
  readonly cardData: Record<string, string>
  readonly callbackRouteKey?: string
}
/**
 * Authenticated conversion from DingTalk download codes to image data URLs.
 */
export interface DingtalkImageDownloader {
  download(downloadCode: string): Promise<string>
}
