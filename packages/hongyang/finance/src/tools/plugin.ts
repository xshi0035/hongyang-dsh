/**
 * Tools Consumer: registers every `finance_*` tool against the live service.
 * Registration is effect-based, so disposing this fiber removes the tools.
 * @module @deepseek-ai/dsh-hy-finance/tools/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { financeStatusTool } from './definitions/status.ts'

/** Cordis plugin name. */
export const name = 'hy-finance-tools'
/** Required services. */
export const inject = ['tools', 'hyFinance']

/**
 * Register the tool set.
 * @param ctx - context owning the registrations.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(financeStatusTool(ctx.hyFinance))
}
