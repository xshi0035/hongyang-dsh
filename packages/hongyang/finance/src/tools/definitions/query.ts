import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { formatCents } from '../../rules/tax.ts'
import { merchantBalance, overdue, receivableSummary, todayReceipts } from '../../provider/query/dashboard.ts'
const KINDS = ['receivable_summary', 'merchant_balance', 'overdue', 'today'] as const
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
const money = (cents: number): string => formatCents(cents)
const merchantText = (rows: readonly { shopNo: string; name: string; brand: string; openCents: number }[]): string[] => rows.map(row => row.shopNo + ' ' + row.name + (row.brand ? '（' + row.brand + '）' : '') + '：' + money(row.openCents) + ' 元')
/**
 * Bind dashboard queries to one finance service.
 * @param service - Finance service owning the operation.
 * @returns The registry-ready finance_query tool.
 */
export function financeQueryTool(service: HyFinanceService): ToolDefinition {
  return defineTool({
    name: 'finance_query',
    description: '查询财务数据。receivable_summary 返回应收未收汇总；merchant_balance 按铺位号、商户名或品牌查询欠费；overdue 查询逾期应收；today 查询指定日期已登记收款。金额由 provider 计算，单位元。',
    parameters: { kind: { type: 'string', required: true, enum: KINDS }, query: { type: 'string', description: 'merchant_balance：商户名、品牌或铺位号' }, days: { type: 'integer', description: 'overdue：逾期天数，默认30' }, date: { type: 'string', description: 'today：YYYY-MM-DD' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, summary: { type: 'string', required: true }, data: { type: 'json', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.summary }] },
    async execute(args) {
      await Promise.resolve()
      switch (args.kind) {
        case 'receivable_summary': { const result = receivableSummary(service.db()); return { kind: args.kind, summary: '应收未收：' + money(result.openCents) + ' 元，涉及 ' + String(result.merchantCount) + ' 个商户。' + result.byFee.map(row => row.label + ' ' + money(row.cents) + ' 元').join('；'), data: result as unknown as JsonValue } }
        case 'merchant_balance': { if (!args.query?.trim()) throw new Error('merchant_balance 需要 query'); const result = merchantBalance(service.db(), args.query); return { kind: args.kind, summary: result.length === 0 ? '没有找到“' + args.query + '”的未收应收。' : merchantText(result).join('\n'), data: result as unknown as JsonValue } }
        case 'overdue': { const days = args.days ?? 30; const date = args.date ?? new Date().toISOString().slice(0, 10); const result = overdue(service.db(), days, date); return { kind: args.kind, summary: result.length === 0 ? '没有超过 ' + String(days) + ' 天的逾期应收。' : '逾期超过 ' + String(days) + ' 天：\n' + merchantText(result).join('\n'), data: result as unknown as JsonValue } }
        case 'today': { const date = args.date ?? new Date().toISOString().slice(0, 10); const result = todayReceipts(service.db(), date); return { kind: args.kind, summary: result.length === 0 ? date + ' 没有已登记收款。' : date + ' 收款：\n' + result.map(row => row.source + ' ' + String(row.count) + ' 笔 ' + money(row.cents) + ' 元').join('\n'), data: result as unknown as JsonValue } }
        default: { const never: never = args.kind; throw new Error(String(never)) }
      }
    },
  })
}
