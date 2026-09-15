import { randomUUID } from 'node:crypto'
import { FinanceError, type HyFinanceService } from '@deepseek-ai/dsh-hy-finance'
import { extractPaymentFromImage, type PaymentVisionClient } from './vision.ts'
import type { DingtalkDraft, DingtalkStateStore } from './store.ts'
import type { DingtalkCardCallback, DingtalkCardUpdate, DingtalkReply, DingtalkStreamClient, DingtalkTextMessage } from './types.ts'

type FinanceRegistrationService = Pick<HyFinanceService, 'previewPayment' | 'previewPaymentImage' | 'submitPayment'>

/** Durable state plus the optional card template and screenshot extraction client. */
export interface FinanceDingtalkBridgeOptions {
  readonly store: DingtalkStateStore
  /** Published card template id; absent means text-only confirmation. */
  readonly cardTemplateId?: string
  readonly cardCallbackRouteKey?: string
  readonly vision?: PaymentVisionClient
  readonly now?: () => number
  readonly newId?: () => string
}

const DRAFT_TTL_MS = 30 * 60 * 1000
const MAX_DRAFTS = 1000
const MAX_CANDIDATES = 5
const CANCEL_TEXT = /^(取消|取消登记|重新开始)$/u
const CONFIRM_TEXT = /^(?:确认|确定|选择)(?:\s+(.*))?$/u
const PLACEHOLDER_SHOP = /^(编号|铺位|铺位号|商户|商户编号)?$/u
const GREETING = /^(你好|您好|帮助|怎么用)[！!。]?$/u

interface MerchantCandidate { readonly shopNo: string; readonly name: string; readonly brand: string }

function primaryBrand(candidate: MerchantCandidate): string {
  return candidate.brand.split(/[/,、|；;]+/u).map(part => part.trim()).find(part => part.length > 0) ?? ''
}

/**
 * Label one candidate with enough detail to tell similar tenants apart.
 * @param candidate - Merchant candidate from the finance preview.
 * @returns Shop number, leading brand, and the contracting party when it differs.
 */
export function candidateDisplayName(candidate: MerchantCandidate): string {
  const brand = primaryBrand(candidate)
  const label = brand || candidate.name
  return candidate.name.length > 0 && candidate.name !== label ? `${candidate.shopNo} ${label}（${candidate.name}）` : `${candidate.shopNo} ${label}`
}

/** Rewrite the card text; a settled card also drops its candidate buttons. */
function cardUpdate(text: string, settled = false): DingtalkCardUpdate {
  return { cardParamMap: settled ? { content: text, summary: '', merchantList: '[]' } : { content: text, summary: '' } }
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : '请稍后再试'
}

const ASK_SHOP_NO = '请回复“确认 ”加上候选中的实际铺位号，例如“确认 3F-3032”。'
const NO_DRAFT = '当前没有待确认的付款，或草稿已过期。请重新发送付款信息。'
const STALE_CARD = '该卡片已失效（草稿已更新、已登记或已取消），请使用最新的确认卡片或重新发送付款信息。'

/**
 * Collect payment details and submit selected candidates for workbench review without booking money.
 * @param service - Finance service owning the operation.
 * @param stream - Transport receiving the registered payment handler.
 * @param options - Durable state, card template, and optional screenshot extraction.
 * @returns The supplied Stream client with its payment and card handlers installed.
 */
export function createFinanceDingtalkBridge(
  service: FinanceRegistrationService,
  stream: DingtalkStreamClient,
  options: FinanceDingtalkBridgeOptions,
): DingtalkStreamClient {
  const { store, vision } = options
  const now = options.now ?? Date.now
  const newId = options.newId ?? randomUUID
  const templateId = options.cardTemplateId?.trim() || undefined

  const settleDuplicate = (draftKey: string, error: unknown): DingtalkReply | undefined => {
    if (!(error instanceof FinanceError) || error.code !== 'DUPLICATE_PAYMENT') return undefined
    const draft = store.getDraft(draftKey, now())
    if (draft !== undefined) store.settleDraftCards(draft.id, 'cancelled', error.message)
    store.deleteDraft(draftKey)
    return { text: error.message }
  }

  const confirmDraft = (draftKey: string, draft: DingtalkDraft, shopNo: string, userId: string): DingtalkReply => {
    try {
      const result = service.submitPayment({ draftId: draft.id, text: draft.text, shopNo, submitter: userId, image: draft.image })
      const summary = result.status === 'approved' ? '该付款已在工作台确认入账，本次没有重复入账。'
        : result.status === 'rejected' ? '该付款已在工作台驳回，本次未入账。如需更正，请重新发送付款信息。'
          : `已提交工作台审核，尚未入账：${result.shopNo} ${result.merchantName}；${result.summary}。请在 DSH 财务工作台确认入账或驳回。`
      store.settleDraftCards(draft.id, 'submitted', summary)
      store.deleteDraft(draftKey)
      return { text: summary }
    } catch (error) {
      return settleDuplicate(draftKey, error) ?? { text: `确认未完成，草稿已保留：${failureText(error)}` }
    }
  }

  const deliverCard = async (
    message: DingtalkTextMessage, draftId: string, draftKey: string, summary: string, candidates: MerchantCandidate[],
  ): Promise<boolean> => {
    if (templateId === undefined || stream.sendCard === undefined) return false
    const outTrackId = `hy-${newId()}`
    const cardContent = `付款待确认（尚未登记）\n${summary}\n请核对候选商户，点击“确认”提交工作台审核，或点击“取消”。工作台确认后才入账。`
    store.putCard({ outTrackId, draftKey, draftId, userId: message.userId, status: 'open', result: undefined, transactionId: undefined, createdAt: now() })
    try {
      await stream.sendCard({
        templateId,
        outTrackId,
        userId: message.userId,
        conversationId: message.conversationId,
        ...(message.conversationType === undefined ? {} : { conversationType: message.conversationType }),
        ...(options.cardCallbackRouteKey === undefined ? {} : { callbackRouteKey: options.cardCallbackRouteKey }),
        cardData: {
          content: cardContent,
          summary: '',
          merchantList: JSON.stringify(candidates.map(m => ({ ...m, displayName: candidateDisplayName(m) }))),
        },
        streaming: { key: 'content', content: cardContent },
      })
      return true
    } catch (error) {
      console.error('hy-dingtalk: card delivery failed; replying with text instead:', failureText(error))
      store.settleCard(outTrackId, 'cancelled', '卡片未送达')
      return false
    }
  }

  const handler = async (message: DingtalkTextMessage): Promise<DingtalkReply> => {
    const at = now()
    if (!store.claimDelivery(`msg:${message.deliveryId}`, at)) return { text: '', silent: true }
    const key = JSON.stringify([message.conversationId, message.userId])
    store.setRevision(key, message.deliveryId)
    const text = message.text.trim()
    if (CANCEL_TEXT.test(text)) {
      const draft = store.getDraft(key, at)
      store.deleteDraft(key)
      if (draft !== undefined) store.settleDraftCards(draft.id, 'cancelled', '已取消草稿，本次没有登记流水。')
      return { text: '已取消草稿，本次没有登记流水。' }
    }
    const confirm = CONFIRM_TEXT.exec(text)
    if (confirm !== null) {
      const shopNo = confirm[1]?.trim() ?? ''
      if (PLACEHOLDER_SHOP.test(shopNo)) return { text: ASK_SHOP_NO }
      const draft = store.getDraft(key, at)
      if (draft === undefined) return { text: NO_DRAFT }
      return confirmDraft(key, draft, shopNo, message.userId)
    }
    if (GREETING.test(text)) {
      return { text: '你好，可以告诉我“电费200”，再补充商户名称。我会查询编号让你确认，再提交 DSH 工作台审核；工作台确认后才入账。' }
    }
    try {
      const previous = store.getDraft(key, at)
      let image = previous?.image
      if (message.imageUrl !== undefined) {
        if (!vision || !message.imageUrl.startsWith('data:')) {
          return { text: '已收到付款截图，但图片识别尚未配置；请补充一句商户和费项文字。' }
        }
        if (image !== undefined) return { text: '当前草稿已有付款截图，请先确认或取消，再发送下一笔。' }
        image = await extractPaymentFromImage(vision, { imageDataUrl: message.imageUrl })
        if (store.getRevision(key) !== message.deliveryId || store.getDraft(key, now())?.id !== previous?.id) {
          return { text: '识别期间草稿已变更，请重新发送截图；本次未登记。' }
        }
      }
      const combined = previous === undefined ? text : `${previous.text}\n${text}`
      if (combined.length > 4000) return { text: '本次信息过长，请回复“取消”后按笔重新发送。' }
      const preview = image === undefined ? service.previewPayment(combined) : service.previewPaymentImage(image, combined)
      if (previous === undefined && store.countDrafts(at) >= MAX_DRAFTS) return { text: '待确认草稿已满，请稍后再试。' }
      const draftId = newId()
      store.putDraft(key, {
        id: draftId, conversationId: message.conversationId, userId: message.userId, text: combined,
        ...(image === undefined ? {} : { image }), expires: now() + DRAFT_TTL_MS,
      })
      if (previous !== undefined) store.settleDraftCards(previous.id, 'cancelled', STALE_CARD)
      const candidates = preview.candidates.slice(0, MAX_CANDIDATES)
      const choices = candidates.map(m => `【${m.shopNo}】${candidateDisplayName(m).slice(m.shopNo.length + 1)}`).join('\n')
      const question = candidates.length === 0
        ? '这是哪个商户的付款？告诉我商户名称，我来查询编号。'
        : preview.ready
          ? '请核对商户和金额，回复“确认 ”加上铺位号提交工作台审核，工作台确认后才入账。'
          : '请补充金额或费项；之前的信息已保留。'
      const textReply = `付款待确认（尚未登记）\n${preview.summary}\n${choices}\n${question}\n可回复“取消”；草稿30分钟后过期。`
      if (candidates.length > 0 && preview.ready && await deliverCard(message, draftId, key, preview.summary, candidates)) {
        return { text: textReply, silent: true }
      }
      return { text: textReply }
    } catch (error) {
      return settleDuplicate(key, error) ?? { text: `暂未登记，原草稿已保留：${failureText(error)}` }
    }
  }

  const cardHandler = (callback: DingtalkCardCallback): DingtalkCardUpdate | undefined => {
    const at = now()
    const card = store.getCard(callback.outTrackId)
    if (card === undefined) {
      console.warn('hy-dingtalk: card callback for unknown card', callback.outTrackId)
      return undefined
    }
    if (callback.userId !== undefined && callback.userId !== card.userId) {
      console.warn('hy-dingtalk: card callback from another user ignored', callback.outTrackId)
      return undefined
    }
    if (card.status === 'submitted' || card.status === 'confirmed' || card.status === 'cancelled') return cardUpdate(card.result ?? STALE_CARD, true)
    if (card.status === 'confirming') return cardUpdate('正在处理，请稍候。')
    const action = typeof callback.params.action === 'string' ? callback.params.action : ''
    if (action === 'cancel') {
      const draft = store.getDraft(card.draftKey, at)
      if (draft !== undefined && draft.id === card.draftId) store.deleteDraft(card.draftKey)
      const text = '已取消草稿，本次没有登记流水。'
      store.settleDraftCards(card.draftId, 'cancelled', text)
      return cardUpdate(text, true)
    }
    if (action !== 'confirm') return cardUpdate('请核对候选商户，点击“确认”提交工作台审核，或点击“取消”。工作台确认后才入账。')
    const shopNo = typeof callback.params.shopNo === 'string' ? callback.params.shopNo.trim() : ''
    if (shopNo === '' || PLACEHOLDER_SHOP.test(shopNo)) return cardUpdate(`卡片未回传铺位号。${ASK_SHOP_NO}`)
    const draft = store.getDraft(card.draftKey, at)
    if (draft === undefined || draft.id !== card.draftId) {
      store.settleCard(card.outTrackId, 'cancelled', STALE_CARD)
      return cardUpdate(STALE_CARD, true)
    }
    if (!store.claimCard(card.outTrackId)) return cardUpdate('正在处理，请稍候。')
    const reply = confirmDraft(card.draftKey, draft, shopNo, card.userId)
    const finalStatus = store.getCard(card.outTrackId)?.status
    const settled = finalStatus === 'submitted' || finalStatus === 'cancelled'
    if (!settled) store.settleCard(card.outTrackId, 'open')
    return cardUpdate(reply.text, settled)
  }

  stream.onMessage(handler)
  stream.onCard(callback => Promise.resolve(cardHandler(callback)))
  return stream
}
