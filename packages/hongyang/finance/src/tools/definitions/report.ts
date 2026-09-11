/**
 * `finance_daily_report`: build the 34-column daily income report for one
 * day from allocations, export it as xlsx into the session workspace, and
 * compare it with the manual ledger. The result carries the numbers the
 * report card renders; the model only relays them.
 * @module @deepseek-ai/dsh-hy-finance/tools/definitions/report
 */

import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { FEE_RULES, FEE_TYPES } from '../../rules/fee-types.ts'
import { formatCents } from '../../rules/tax.ts'
import { SOURCE_LABELS, type Source } from '../../service/types.ts'
import type { CompareResult, DailyReport } from '../../provider/report/daily-report.ts'
import type { ReportMetaWire } from '../../shared/wire.ts'

const ACTIONS = ['build', 'export', 'compare'] as const

/** Structural twin of the tools package's lossless JSON type. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function metaOf(report: DailyReport, xlsxPath: string | undefined, compare: CompareResult | undefined): ReportMetaWire {
  return {
    card: 'hy-finance/report',
    reportId: String(report.id),
    date: report.date,
    rows: report.rows.length,
    grandTotal: formatCents(report.grandTotal),
    totals: FEE_TYPES
      .filter(f => (report.totals[f] ?? 0) !== 0)
      .map(f => ({ fee: FEE_RULES[f].label, amount: formatCents(report.totals[f] ?? 0) })),
    bySource: (Object.keys(report.bySource) as Source[]).map(s => ({
      source: SOURCE_LABELS[s], count: report.bySource[s]?.count ?? 0, amount: formatCents(report.bySource[s]?.amount ?? 0),
    })),
    xlsxPath,
    compare: compare === undefined ? undefined : {
      ledgerRows: compare.ledgerRows,
      matched: compare.matched,
      missing: compare.diffs.filter(d => d.kind === 'missing').length,
      extra: compare.diffs.filter(d => d.kind === 'extra').length,
      amountDiffs: compare.diffs.filter(d => d.kind === 'amount').length,
      reportTotal: formatCents(compare.reportTotal),
      ledgerTotal: formatCents(compare.ledgerTotal),
      diffs: compare.diffs.slice(0, 40).map(d => ({
        kind: d.kind, shopNo: d.shopNo, merchantName: d.merchantName, source: d.source,
        reportAmount: d.reportAmount === undefined ? '' : formatCents(d.reportAmount),
        ledgerAmount: d.ledgerAmount === undefined ? '' : formatCents(d.ledgerAmount),
        note: d.note,
      })),
    },
  }
}

function summaryOf(meta: ReportMetaWire): string {
  const lines = [
    `${meta.date} 收入日报表：${String(meta.rows)} 行，合计 ${meta.grandTotal} 元。`,
    `来源：${meta.bySource.map(s => `${s.source} ${String(s.count)} 行 ${s.amount} 元`).join('；')}。`,
    `费项：${meta.totals.map(t => `${t.fee} ${t.amount}`).join('；')}。`,
  ]
  if (meta.xlsxPath !== undefined) lines.push(`已导出：${meta.xlsxPath}`)
  const c = meta.compare
  if (c !== undefined) {
    lines.push(`与台账比对：台账 ${String(c.ledgerRows)} 行，逐行一致 ${String(c.matched)} 行，缺失 ${String(c.missing)}，多出 ${String(c.extra)}，金额差异 ${String(c.amountDiffs)}；合计 生成 ${c.reportTotal} / 台账 ${c.ledgerTotal}。`)
    for (const d of c.diffs) {
      const label = d.kind === 'missing' ? '台账有、生成无' : d.kind === 'extra' ? '生成有、台账无' : '金额不同'
      lines.push(`  - [${label}] ${d.shopNo} ${d.merchantName} ${d.source} 生成 ${d.reportAmount || '—'} / 台账 ${d.ledgerAmount || '—'}：${d.note}`)
    }
  }
  return lines.join('\n')
}

/**
 * Build the tool bound to one service instance.
 * @param service - the finance service.
 * @returns the tool.
 */
export function financeDailyReportTool(service: HyFinanceService) {
  return defineTool({
    name: 'finance_daily_report',
    description: '收入日报表。action=build：把某一天所有已认领的收款汇成 34 列日报表。action=export 或 compare：生成 xlsx 后，用户需要查看时必须在同一轮自动调用 Univer 的 univer_import 打开，不能要求用户再次发打开指令。action=compare：同时与已导入台账逐行比对。日期格式 YYYY-MM-DD。',
    parameters: {
      action: { type: 'string', required: true, enum: ACTIONS },
      date: { type: 'string', required: true, description: 'YYYY-MM-DD' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          date: { type: 'string', required: true },
          rows: { type: 'integer', required: true },
          grandTotal: { type: 'string', required: true },
          xlsxPath: { type: 'string' },
          summary: { type: 'string', required: true },
          meta: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => value.meta,
    },
    async execute(args, exec) {
      const date = args.date.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date 必须是 YYYY-MM-DD')
      const report = service.buildDailyReport(date)
      let xlsxPath: string | undefined
      if (args.action === 'export' || args.action === 'compare') {
        const cwd = exec.agent?.session.header.cwd
        const dir = cwd === undefined ? join(service.config.dbPath, '..', 'reports') : join(cwd, '财务产物')
        xlsxPath = await service.exportDailyReport(report, dir)
      }
      const compare = args.action === 'compare' ? service.compareDailyReport(report) : undefined
      const meta = metaOf(report, xlsxPath, compare)
      return {
        action: args.action, date, rows: report.rows.length, grandTotal: meta.grandTotal,
        ...(xlsxPath === undefined ? {} : { xlsxPath }),
        summary: summaryOf(meta), meta: meta as unknown as JsonValue,
      }
    },
  })
}
