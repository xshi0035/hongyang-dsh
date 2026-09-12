import { defineTool } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { formatCents } from '../../rules/tax.ts'
import { registerPayment } from '../../provider/register/payment.ts'
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export function financeRegisterTool(service: HyFinanceService) {
  return defineTool({
    name: 'finance_register',
    description: '登记一笔付款。当前支持文字输入，provider 从文字中解析金额、日期、费项、商户和交易单号；商户和费项都明确时自动登记，否则保存为待确认，不猜商户、不生成正式凭证。截图输入暂待确认运行时图片字段格式。',
    parameters: { text: { type: 'string', required: true, description: '例如：2026-04-03 围辣转转火锅 电费 500 元，交易单号 ABC123' }, image: { type: 'string', description: '截图引用；当前版本暂不执行图片识别' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string', required: true }, pending: { type: 'boolean', required: true }, data: { type: 'json', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.summary }] },
    async execute(args) {
      await Promise.resolve()
      const result = registerPayment(service.db(), args.text)
      const summary = result.booked
        ? '已登记：' + (result.merchantShopNo ?? '') + ' ' + (result.merchantName ?? '') + ' ' + formatCents(result.parsed.amount) + ' 元；费项 ' + String(result.parsed.feeType)
        : '已记录 ' + formatCents(result.parsed.amount) + ' 元，但需要补充商户或费项后才能登记。'
      return { summary, pending: result.pending, data: result as unknown as JsonValue }
    },
  })
}
