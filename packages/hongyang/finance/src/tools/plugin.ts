/**
 * Tools Consumer: registers every `finance_*` tool against the live service.
 * Registration is effect-based, so disposing this fiber removes the tools.
 * @module @deepseek-ai/dsh-hy-finance/tools/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { financeClaimTool } from './definitions/claim.ts'
import { financeImportTool } from './definitions/import.ts'
import { financeDailyReportTool } from './definitions/report.ts'
import { financeStatusTool } from './definitions/status.ts'
import { financeVoucherTool } from './definitions/voucher.ts'
import { financeQueryTool } from './definitions/query.ts'
import { financeRegisterTool } from './definitions/register.ts'

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
  ctx.tools.register(financeImportTool(ctx.hyFinance))
  ctx.tools.register(financeClaimTool(ctx.hyFinance))
  ctx.tools.register(financeDailyReportTool(ctx.hyFinance))
  ctx.tools.register(financeVoucherTool(ctx.hyFinance))
  ctx.tools.register(financeQueryTool(ctx.hyFinance))
  ctx.tools.register(financeRegisterTool(ctx.hyFinance))
}
