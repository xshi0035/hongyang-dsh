/**
 * Browser half of the finance plugin: registers the card copy and the
 * "弘阳财务" card under the `hy-finance` namespace on the plugin
 * configuration tab. Review cards and tool rows join here as they land.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FinanceSettingsCard } from './FinanceSettingsCard.tsx'
import { PendingClaimsCard, type ClaimsCardFace } from './PendingClaimsCard.tsx'
import { claimsDefinition, selectClaims } from './claims-turn-data.ts'
import { claimsEn, claimsZh, CLAIMS_NS, en, NS, zh, type ClaimsCardKey, type FinanceSettingsKey } from './locales.ts'
import { HY_FINANCE_API, type ConfirmResponseWire, type MerchantWire } from '../shared/wire.ts'
import { FinanceCardController, HY_FINANCE_NS, type FinanceCardFace, type FinanceSettings } from './settings-card.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Finance settings card copy. */
    'settings.hyFinance': FinanceSettingsKey
    /** Pending-claims card copy. */
    'hyFinance.claims': ClaimsCardKey
  }
}

export type { FinanceCardFace, FinanceCardState, FinanceSettings } from './settings-card.ts'
export type { FinanceSettingsKey } from './locales.ts'

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope', 'uiConversation']

/**
 * Register dictionaries and the settings card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hy-finance: dictionaries')
  const card = new FinanceCardController(ctx.settingsScope.bind<FinanceSettings>({ namespace: HY_FINANCE_NS }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: HY_FINANCE_NS,
    locale: NS,
    inject: (): FinanceCardFace => card.inject(),
  }, FinanceSettingsCard))

  // Pending-claims review card at the tail of a Turn that left a queue.
  ctx.effect(() => ctx.locale.register(CLAIMS_NS, { zh: claimsZh, en: claimsEn }), 'hy-finance: claims dictionaries')
  ctx.uiConversation.events.register(claimsDefinition)
  const financeScope = ctx.settingsScope.bind<FinanceSettings>({ namespace: HY_FINANCE_NS })
  const face: ClaimsCardFace = {
    autoOpen: () => financeScope.getSnapshot().value?.autoOpenCards !== false,
    loadMerchants: async () => {
      const response = await fetch(`${HY_FINANCE_API}/merchants`, { credentials: 'same-origin' })
      const body = await response.json() as { merchants: MerchantWire[] }
      return body.merchants
    },
    confirm: async (sessionId, itemId, shopNo) => {
      const response = await fetch(`${HY_FINANCE_API}/claim/confirm`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, itemId, shopNo }),
      })
      return await response.json() as ConfirmResponseWire
    },
  }
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectClaims,
    locale: CLAIMS_NS,
    inject: (): ClaimsCardFace => face,
  }, PendingClaimsCard))
}
