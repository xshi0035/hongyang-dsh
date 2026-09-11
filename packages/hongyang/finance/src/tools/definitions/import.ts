/**
 * `finance_import`: load one client file into the finance database. The kind
 * is detected from the file's headers unless given; bank and platform
 * statements also re-run settlement splitting and report which daily
 * settlements tied out to their platform details.
 * @module @deepseek-ai/dsh-hy-finance/tools/definitions/import
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { formatCents } from '../../rules/tax.ts'
import type { ImportOutcome } from '../../provider/import/index.ts'

const KINDS = ['bank_ccb', 'wechat', 'unionpay_pos', 'recharge', 'receivable', 'ledger', 'voucher'] as const

/** Canonical value returned to the model. */
export interface ImportToolResult {
  kind: string
  file: string
  duplicate: boolean
  batchId: string
  summary: string
  rows: number
  settlement?: {
    matched: number
    unmatched: number
    unmatchedDetails: { date: string; channel: string; amount: string; detailDays: string[]; detailNet: string; reason: string }[]
  }
}

function describe(outcome: ImportOutcome, file: string): ImportToolResult {
  if (outcome.duplicate) {
    return { kind: outcome.kind, file, duplicate: true, batchId: outcome.batchId, rows: 0, summary: `这份文件已在 ${outcome.importedAt} 导入过（批次 ${outcome.batchId}），未重复导入。` }
  }
  const base = { kind: outcome.kind, file, duplicate: false as const, batchId: String(outcome.result.batchId) }
  const settlement = 'split' in outcome
    ? {
      matched: outcome.split.matched.length,
      unmatched: outcome.split.unmatched.length,
      unmatchedDetails: outcome.split.unmatched.map(u => ({
        date: u.date,
        channel: u.channel === 'tenpay' ? '财付通（微信）' : '银联商务（POS）',
        amount: formatCents(u.amount),
        detailDays: u.detailDays,
        detailNet: formatCents(u.detailNet),
        reason: u.detailRows === 0 ? `对账单里没有 ${u.detailDays.join('、')} 的明细，可能尚未导入该日期的对账单` : '明细净额与到账金额不相等',
      })),
    }
    : undefined
  switch (outcome.kind) {
    case 'bank_ccb': {
      const r = outcome.result
      const c = r.byChannel
      return {
        ...base, rows: r.inserted, ...(settlement === undefined ? {} : { settlement }),
        summary: `建行流水：${r.sheets.join('、')}，收入 ${String(r.credits)} 笔，新增 ${String(r.inserted)} 笔（重复 ${String(r.duplicates)}）。渠道：财付通 ${String(c.tenpay)}、银联商务 ${String(c.unionpay)}、捷停车 ${String(c.parking)}、对公/个人转账 ${String(c.transfer)}、抖音（忽略）${String(c.douyin)}、本公司内部划转（忽略）${String(c.internal)}。`,
      }
    }
    case 'wechat': case 'unionpay_pos': case 'recharge': {
      const r = outcome.result
      const label = outcome.kind === 'wechat' ? '微信对账单' : outcome.kind === 'unionpay_pos' ? '银联 POS 对账单' : '电表充值记录'
      return {
        ...base, rows: r.inserted, ...(settlement === undefined ? {} : { settlement }),
        summary: `${label}：商户号 ${r.merchantAccounts.join('、')}，${String(r.orders)} 笔，新增 ${String(r.inserted)}（重复 ${String(r.duplicates)}），净额合计 ${formatCents(r.netTotal)} 元，其中 ${String(r.withMerchantHint)} 笔带商户铺位信息。`,
      }
    }
    case 'receivable': {
      const r = outcome.result
      return {
        ...base, rows: r.receivables,
        summary: `应收明细表：${r.sheets.join('、')}；商户 ${String(r.merchants)} 家，应收行 ${String(r.receivables)}${r.unknownFeeLabels.length > 0 ? `；未识别费项按"其他"导入：${r.unknownFeeLabels.join('、')}` : ''}。`,
      }
    }
    case 'ledger': case 'voucher': {
      const r = outcome.result
      const label = outcome.kind === 'ledger' ? '收入日报表台账' : '金蝶凭证'
      const range = r.dateRange === undefined ? '' : `，日期 ${r.dateRange.from} 至 ${r.dateRange.to}`
      return { ...base, rows: r.rows, summary: `${label}：${String(r.rows)} 行${range}${r.extraColumns.length > 0 ? `；额外列：${r.extraColumns.join('、')}` : ''}。仅用于比对，不产生收款记录。` }
    }
    default: {
      const never: never = outcome
      throw new Error(String(never))
    }
  }
}

/**
 * Build the tool bound to one service instance.
 * @param service - the finance service.
 * @returns the tool.
 */
export function financeImportTool(service: HyFinanceService) {
  return defineTool({
    name: 'finance_import',
    description: '把客户的一份文件导入弘阳财务数据库。自动识别：建行流水 xls（建行2038/2035 两个 sheet）、微信商户平台对账单 csv、银联商务 POS 对账单 xlsx、电表充值记录 xls、租费应收明细表 xlsx（商户主数据与应收）、收入日报表台账 xlsx（比对基准）、金蝶凭证 xlsx（比对基准）。导入建行流水或平台对账单后会自动做日结拆分：财付通到账对前一日微信明细，银联到账对备注日期范围内的 POS 明细，金额分毫相等才算对平。同一文件不会重复导入。',
    parameters: {
      file: { type: 'string', required: true, description: '文件的绝对路径（用户拖入的附件路径或工作区内路径）' },
      kind: { type: 'string', enum: KINDS, description: '文件类型；省略时按表头自动识别' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          file: { type: 'string', required: true },
          duplicate: { type: 'boolean', required: true },
          batchId: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          rows: { type: 'integer', required: true },
          settlement: {
            type: 'object', additionalProperties: false,
            properties: {
              matched: { type: 'integer', required: true },
              unmatched: { type: 'integer', required: true },
              unmatchedDetails: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    date: { type: 'string', required: true },
                    channel: { type: 'string', required: true },
                    amount: { type: 'string', required: true },
                    detailDays: { type: 'array', required: true, items: { type: 'string' } },
                    detailNet: { type: 'string', required: true },
                    reason: { type: 'string', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [value.summary]
        if (value.settlement !== undefined) {
          lines.push(`日结拆分：对平 ${String(value.settlement.matched)} 笔，未对平 ${String(value.settlement.unmatched)} 笔。`)
          for (const u of value.settlement.unmatchedDetails) {
            lines.push(`  - ${u.date} ${u.channel} 到账 ${u.amount} 元，对应明细日 ${u.detailDays.join('、')}，明细净额 ${u.detailNet} 元：${u.reason}`)
          }
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta: (_args, value) => ({
        kind: value.kind, duplicate: value.duplicate, rows: value.rows,
        matched: value.settlement?.matched ?? null, unmatched: value.settlement?.unmatched ?? null,
      }),
    },
    async execute(args) {
      const outcome = await service.importFile(args.file, args.kind)
      return describe(outcome, args.file)
    },
  })
}
