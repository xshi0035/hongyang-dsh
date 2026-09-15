import { join } from 'node:path'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { compareVoucher } from '../../provider/voucher/compare.ts'
import { exportVoucher } from '../../provider/voucher/export.ts'
import type { VoucherMetaWire } from '../../shared/wire.ts'

const ACTIONS = ['list', 'build', 'export', 'compare'] as const
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/**
 * Bind voucher generation, export, and comparison to one finance service.
 * @param service - Finance service owning the operation.
 * @returns The registry-ready finance_voucher tool.
 */
export function financeVoucherTool(service: HyFinanceService): ToolDefinition {
  return defineTool({
    name: 'finance_voucher',
    description: '先用 list 展示待制证 receiptIds，由用户选择收款后使用 receiptIds 生成草稿；不得自动选择全天收款或把未认领款项凑成已认领。保留全日覆盖统计。从指定日期日报表生成金蝶 21 列凭证，校验借贷平衡和税率科目，并可与客户 voucher_row 逐行比较。用户要求出凭证、导出或查看时，agent 必须在同一轮自动调用 Univer 的 univer_import 打开 xlsx，不要等待用户再次说明。',
    parameters: {
      action: { type: 'string', required: true, enum: ACTIONS },
      date: { type: 'string', required: true, description: 'YYYY-MM-DD' },
      receiptIds: { type: 'array', items: { type: 'string' }, description: '用户选择的收款键，来自 list；build/export/compare 必填' },
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
      if (args.action === 'list') {
        const queue = service.voucherQueue(date)
        const summary = `${date} 待制证 ${String(queue.pendingCount)} 笔 ${(queue.pendingAmount / 100).toFixed(2)} 元；已有草稿 ${String(queue.draftedCount)} 笔；未认领 ${String(queue.unclaimedCount)} 笔 ${(queue.unclaimedAmount / 100).toFixed(2)} 元\n${queue.receipts.map(row => `${row.receiptId} | ${row.shopNo} ${row.merchantName} | ${(row.subtotal / 100).toFixed(2)} 元 | ${row.voucherId === undefined ? '待制证' : '已有草稿'}`).join('\n')}`
        return { action: args.action, date, lines: 0, balanced: true, summary, meta: queue as unknown as JsonValue }
      }
      if (args.receiptIds === undefined) throw new Error('请先列出待制证收款，并由用户选择 receiptIds')
      const voucher = service.buildVoucher(date, { kind: 'tool', id: String(exec.agent?.session.id ?? '') }, args.receiptIds)
      let xlsxPath: string | undefined
      {
        const cwd = exec.agent?.session.header.cwd
        xlsxPath = await exportVoucher(voucher, cwd === undefined ? join(service.config.dbPath, '..', '凭证') : join(cwd, '财务产物'))
      }
      service.db().prepare('UPDATE voucher SET xlsx_path=? WHERE id=?').run(xlsxPath, voucher.id)
      const compare = args.action === 'compare' ? compareVoucher(service.db(), voucher) : undefined
      const meta: VoucherMetaWire = {
        card: 'hy-finance/voucher', voucherId: String(voucher.id), date, lines: voucher.lines.length,
        voucherLines: voucher.lines.map(line => ({
          lineNo: line.lineNo, summary: line.summary, subject: line.subject, subjectName: line.subjectName,
          debit: (line.debit / 100).toFixed(2), credit: (line.credit / 100).toFixed(2),
          ...(line.warning === undefined ? {} : { warning: line.warning }),
        })),
        receiptIds: voucher.receiptIds, coverage: {
          ...voucher.coverage, totalAmount: (voucher.coverage.totalAmount / 100).toFixed(2),
          selectedAmount: (voucher.coverage.selectedAmount / 100).toFixed(2),
          remainingAmount: (voucher.coverage.remainingAmount / 100).toFixed(2),
        },
        balanced: voucher.checks.balanced, warnings: voucher.checks.warnings,
        xlsxPath,
        ...(compare === undefined ? {} : { compare: { matched: compare.matched, diffs: compare.diffs } }),
      }
      const diffSummary = compare === undefined ? '' : `；逐行一致 ${String(compare.matched)} 行，差异 ${String(compare.diffs.length)} 行${compare.diffs.slice(0, 5).map(d => `；差异行 ${String(d.line)} 客户科目 ${(d.expected as { subject?: string } | null)?.subject ?? '—'} / 系统科目 ${(d.actual as { subject?: string } | null)?.subject ?? '—'}`).join('')}`
      const summary = `${date} 已选 ${String(voucher.coverage.selectedCount)} 笔，未选 ${String(voucher.coverage.remainingCount)} 笔；凭证草稿 ${String(meta.lines)} 行，借贷平衡：${meta.balanced ? '是' : '否'}；${meta.warnings.length > 0 ? `待确认：${meta.warnings.join('、')}` : '税率科目检查通过'}${diffSummary}；已导出 ${xlsxPath}（请用 Univer 打开）`
      return { action: args.action, date, lines: meta.lines, balanced: meta.balanced, summary, meta: meta as unknown as JsonValue }
    },
  })
}
