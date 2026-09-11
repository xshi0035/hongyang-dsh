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
import { FinanceSettingsCard } from './FinanceSettingsCard.tsx'
import { en, NS, zh, type FinanceSettingsKey } from './locales.ts'
import { FinanceCardController, HY_FINANCE_NS, type FinanceCardFace, type FinanceSettings } from './settings-card.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Finance settings card copy. */
    'settings.hyFinance': FinanceSettingsKey
  }
}

export type { FinanceCardFace, FinanceCardState, FinanceSettings } from './settings-card.ts'
export type { FinanceSettingsKey } from './locales.ts'

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope']

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
}
