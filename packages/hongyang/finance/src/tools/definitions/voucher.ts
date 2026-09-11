import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { compareVoucher } from '../../provider/voucher/compare.ts'
import { exportVoucher } from '../../provider/voucher/export.ts'
import type { VoucherMetaWire } from '../../shared/wire.ts'

const ACTIONS = ['build', 'export', 'compare'] as const
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export function financeVoucherTool(service: HyFinanceService) {
  return defineTool({
    name: 'finance_voucher',
    description: '从指定日期日报表生成金蝶 21 列凭证，校验借贷平衡和税率科目，并可与客户 voucher_row 逐行比较。',
    parameters: {
      action: { type: 'string', required: true, enum: ACTIONS },
      date: { type: 'string', required: true, description: 'YYYY-MM-DD' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true }, date: { type: 'string', required: true },
          lines: { type: 'integer', required: true }, balanced: { type: 'boolean', required: true },
          summary: { type: 'string', required: true }, meta: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => value.meta,
    },
    async execute(args, exec) {
      const date = args.date.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date 必须是 YYYY-MM-DD')
      const voucher = service.buildVoucher(date)
      let xlsxPath: string | undefined
      if (args.action === 'export') {
        const cwd = exec.agent?.session.header.cwd
        xlsxPath = await exportVoucher(voucher, cwd === undefined ? join(service.config.dbPath, '..', '凭证') : join(cwd, '财务产物'))
      }
      const compare = args.action === 'compare' ? compareVoucher(service.db(), voucher) : undefined
      const meta: VoucherMetaWire = {
        card: 'hy-finance/voucher', voucherId: String(voucher.id), date, lines: voucher.lines.length,
        balanced: voucher.checks.balanced, warnings: voucher.checks.warnings,
        ...(xlsxPath === undefined ? {} : { xlsxPath }),
        ...(compare === undefined ? {} : { compare: { matched: compare.matched, diffs: compare.diffs } }),
      }
      const summary = `${date} 凭证 ${String(meta.lines)} 行，借贷平衡：${meta.balanced ? '是' : '否'}；${meta.warnings.length > 0 ? `待确认：${meta.warnings.join('、')}` : '税率科目检查通过'}${compare === undefined ? '' : `；逐行一致 ${String(compare.matched)} 行，差异 ${String(compare.diffs.length)} 行`}${xlsxPath === undefined ? '' : `；已导出 ${xlsxPath}`}`
      return { action: args.action, date, lines: meta.lines, balanced: meta.balanced, summary, meta: meta as unknown as JsonValue }
    },
  })
}
