/**
 * Normalized message with delivery identity for duplicate suppression.
 */
export interface DingtalkTextMessage {
  readonly deliveryId: string
  readonly userId: string
  readonly conversationId: string
  /** `group` when the robot was mentioned in a group chat; single chats omit or use `single`. */
  readonly conversationType?: 'single' | 'group'
  readonly text: string
  readonly imageUrl?: string
}
/**
 * Reply text; `silent` suppresses the webhook post when a card already carried the reply.
 */
export interface DingtalkReply {
  readonly text: string
  readonly silent?: boolean
}
/**
 * Card event identity, the pressed button's private parameters, and the raw callback fields.
 */
export interface DingtalkCardCallback {
  readonly deliveryId: string
  /** Card instance id chosen by the sender; ties the click back to a stored draft. */
  readonly outTrackId: string
  readonly userId?: string
  readonly spaceType?: string
  readonly spaceId?: string
  /** Button parameters such as `action` and `shopNo`; untrusted until validated against the draft. */
  readonly params: Record<string, unknown>
  readonly actionIds: readonly string[]
  readonly value: Record<string, unknown>
}
/**
 * Card variables to overwrite after a callback; keys absent from the map keep their values.
 */
export interface DingtalkCardUpdate {
  readonly cardParamMap: Record<string, string>
}
/**
 * Stream lifecycle, disposable handler registrations, and optional card delivery.
 */
export interface DingtalkStreamClient {
  connect(): Promise<void>
  close(): Promise<void>
  onMessage(handler: (message: DingtalkTextMessage) => Promise<DingtalkReply>): () => void
  onCard(handler: (callback: DingtalkCardCallback) => Promise<DingtalkCardUpdate | undefined>): () => void
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
 * Template, card instance id, recipient, and serialized public card variables.
 */
export interface DingtalkInteractiveCardOptions {
  readonly templateId: string
  /** Caller-chosen card instance id; callbacks return it as `outTrackId`. */
  readonly outTrackId: string
  readonly userId: string
  readonly conversationId?: string
  readonly conversationType?: 'single' | 'group'
  readonly cardData: Record<string, string>
  readonly callbackRouteKey?: string
  /** AI-card templates start in "processing"; this streams the final text into `key` and marks the card finished. */
  readonly streaming?: { readonly key: string; readonly content: string }
}
/**
 * Authenticated conversion from DingTalk download codes to image data URLs.
 */
export interface DingtalkImageDownloader {
  download(downloadCode: string): Promise<string>
}
