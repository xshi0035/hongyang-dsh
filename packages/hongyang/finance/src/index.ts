/**
 * Root composition plugin of the Hongyang finance assistant. Mounted by the
 * web profile as a bare package name so DSH discovers the `dsh.client`
 * manifest; it then mounts the service, the tools, the bundled skills, the
 * settings section, and the always-on system-prompt identity in its own
 * fiber.
 *
 * Model experience: one short identity section is always in the system
 * prompt; the detailed accounting rules load on demand as skills so they cost
 * tokens only when a task needs them. Every amount, tax, split, and voucher
 * line is computed by the provider — the model reads results, it never does
 * the arithmetic.
 * @module @deepseek-ai/dsh-hy-finance
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config } from './config.ts'
import { HyFinanceService } from './service/finance-service.ts'
import * as settingsPlugin from './settings/plugin.ts'
import * as skillsPlugin from './skills/plugin.ts'
import * as toolsPlugin from './tools/plugin.ts'
import * as webPlugin from './webServer/plugin.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Hongyang finance domain: master data, receipts, claims, reports, vouchers. */
    hyFinance: HyFinanceService
  }
}

export { Config, HY_FINANCE_NS, resolveConfig } from './config.ts'
export type { ResolvedConfig } from './config.ts'
export { HyFinanceService } from './service/finance-service.ts'
export type { WorkbenchTodoProvider } from './service/finance-service.ts'
export type { WorkbenchSummary, WorkbenchRegistration, WorkbenchTodoSource } from './provider/query/workbench.ts'
export { HY_TIME_ZONE, localDay } from './provider/activity/log.ts'
export * from './service/types.ts'
export * from './service/identifiers.ts'
export { FinanceError, type FinanceErrorCode } from './service/errors.ts'
export type { ImportOutcome } from './provider/import/index.ts'
export type { SplitResult, SettlementMatch } from './provider/split/settlement.ts'
export type { ClaimRunResult, ConfirmResult, PendingItem, UnlabelledPos } from './provider/claim/engine.ts'
export type { Split } from './provider/claim/allocate.ts'
export type { DailyReport, ReportRow, CompareResult, DiffRow } from './provider/report/daily-report.ts'
export type * from './shared/wire.ts'
export * from './rules/fee-types.ts'
export * from './rules/tax.ts'
export * from './rules/summary.ts'
export type { PaymentSubmission, PaymentSubmissionInput } from './provider/register/submission.ts'
export type { PaymentImageExtraction, ImageRegistrationOptions } from './provider/register/image.ts'
export { parsePaymentImageExtraction, registerPaymentFromImage } from './provider/register/image.ts'
export { parsePaymentText, registrationSummary } from './provider/register/payment.ts'

/** Cordis plugin name. */
export const name = 'hy-finance'
/** Nothing is required at the root; each role declares its own services. */
export const inject: string[] = []

/** Prompt text the model always sees; the detailed rules live in the skills. */
const IDENTITY = [
  '你在为衡阳弘阳广场（法人主体：衡阳诚远商业管理有限公司）的财务部和运营部工作。',
  '业务对象：商户（按铺位号识别）、应收（租金、经营服务费、推广费、水电费等 22 个费项）、收款（建行 2038/2035 户、平安银行、POS、企业微信 706/380）、收入日报表（34 列）、金蝶云星空凭证（21 列）。',
  '规则：金额、税额、日结拆分、认领分配、凭证行全部由 finance_* 工具计算，你只负责理解用户意图、选择工具、解释结果；不要自己心算或改写工具给出的金额。',
  '遇到银行流水、收款认领、日报表、凭证、欠费查询相关任务，先加载 hy-finance 技能了解口径，再调用工具。',
].join('\n')

/**
 * Compose the finance plugin roles.
 * @param ctx - the root context of this fiber.
 * @param config - validated configuration from the cordis.yml row.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(HyFinanceService, config)
  ctx.plugin(toolsPlugin)
  ctx.plugin(skillsPlugin)
  ctx.plugin(settingsPlugin, config)
  ctx.plugin(webPlugin)
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'hy-finance:identity',
      order: promptCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 10,
      text: IDENTITY,
    })
  })
}
