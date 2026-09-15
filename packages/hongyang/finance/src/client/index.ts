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
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FinanceSettingsCard } from './FinanceSettingsCard.tsx'
import type { ClaimsCardFace } from './PendingClaimsCard.tsx'
import type { ReportCardFace } from './DailyReportCard.tsx'
import { ClaimToolView, ReportToolView, VoucherToolView } from './FinanceToolViews.tsx'
import {
  claimsEn, claimsZh, CLAIMS_NS, en, NS, reportEn, reportZh, REPORT_NS, workbenchEn, workbenchZh, WORKBENCH_NS, zh,
  type ClaimsCardKey, type FinanceSettingsKey, type ReportCardKey, type WorkbenchKey,
} from './locales.ts'
import { fetchWorkbench, reviewPayment, WorkbenchController, type WorkbenchFace } from './workbench.ts'
import { WorkbenchIcon, WorkbenchPanel } from './WorkbenchPanel.tsx'
import { HY_FINANCE_API, type ConfirmResponseWire, type MerchantWire } from '../shared/wire.ts'
import { FinanceCardController, HY_FINANCE_NS, type FinanceCardFace, type FinanceSettings } from './settings-card.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Finance settings card copy. */
    'settings.hyFinance': FinanceSettingsKey
    /** Pending-claims card copy. */
    'hyFinance.claims': ClaimsCardKey
    /** Daily-report card copy. */
    'hyFinance.report': ReportCardKey
    /** Workbench panel copy. */
    'hyFinance.workbench': WorkbenchKey
  }
}

/** Main-panel key and sidebar entry id of the workbench; both registrations share it. */
export const WORKBENCH_PANEL_ID = 'hy-finance-workbench'

export type { FinanceCardFace, FinanceCardState, FinanceSettings } from './settings-card.ts'
export type { FinanceSettingsKey } from './locales.ts'

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope', 'sessions', 'layout']

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

  // Tool views: a settled finance_claim renders the pending-claims card, a
  // settled finance_daily_report the report card; both replay from result metadata.
  ctx.effect(() => ctx.locale.register(CLAIMS_NS, { zh: claimsZh, en: claimsEn }), 'hy-finance: claims dictionaries')
  ctx.effect(() => ctx.locale.register(REPORT_NS, { zh: reportZh, en: reportEn }), 'hy-finance: report dictionaries')
  const financeScope = ctx.settingsScope.bind<FinanceSettings>({ namespace: HY_FINANCE_NS })
  const autoOpen = (): boolean => financeScope.getSnapshot().value?.autoOpenCards !== false
  const claims: ClaimsCardFace = {
    autoOpen,
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
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'finance_claim', locale: CLAIMS_NS, inject: (): ClaimsCardFace => claims,
  }, ClaimToolView))
  const report: ReportCardFace = { autoOpen }
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'finance_daily_report', locale: REPORT_NS, inject: (): ReportCardFace => report,
  }, ReportToolView))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'finance_voucher', locale: REPORT_NS, inject: () => ({}),
  }, VoucherToolView))

  // Workbench: a global main panel plus its sidebar entry. Quick actions hand a
  // prompt to the current session's agent and switch back to the conversation.
  ctx.effect(() => ctx.locale.register(WORKBENCH_NS, { zh: workbenchZh, en: workbenchEn }), 'hy-finance: workbench dictionaries')
  const workbench = new WorkbenchController({
    review: reviewPayment,
    load: fetchWorkbench,
    send: async (text) => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return false
      const conversation = ctx.sessions.scope(current)?.get('conversation')
      if (conversation === undefined) return false
      await conversation.send(text)
      ctx.layout.selectPanel(null)
      return true
    },
  })
  const workbenchT = ctx.locale.bind(WORKBENCH_NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: WORKBENCH_PANEL_ID, locale: WORKBENCH_NS, inject: (): WorkbenchFace => workbench.inject(),
  }, WorkbenchPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: WORKBENCH_PANEL_ID, order: 30, label: () => workbenchT('nav'),
  }, WorkbenchIcon))
}
