/**
 * Optional settings section: when the settings service is composed, the
 * plugin's configuration becomes editable from the browser card under the
 * `hy-finance` namespace and changes reach the service live.
 * @module @deepseek-ai/dsh-hy-finance/settings/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, HY_FINANCE_NS } from '../config.ts'

/** Cordis plugin name. */
export const name = 'hy-finance-settings'
/** Required services. */
export const inject = ['hyFinance']

/**
 * Install the section when a settings provider exists.
 * @param ctx - context owning the section.
 * @param config - the composition-layer configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let source = (): Config => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, HY_FINANCE_NS, Config, config, {
      setSource: (current) => { source = current },
      onChange: () => { ctx.hyFinance.reconfigure(source()) },
    })
  })
}
