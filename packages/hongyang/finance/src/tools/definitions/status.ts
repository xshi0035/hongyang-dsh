/**
 * `finance_status`: what the finance database currently holds and which
 * accounting codes are still unconfirmed. The model calls it before an import
 * or a report to know whether master data is loaded.
 * @module @deepseek-ai/dsh-hy-finance/tools/definitions/status
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { FEE_RULES, FEE_TYPES } from '../../rules/fee-types.ts'

/**
 * Build the tool definition bound to one service instance.
 * @param service - the finance service.
 * @returns the tool.
 */
export function financeStatusTool(service: HyFinanceService) {
  return defineTool({
    name: 'finance_status',
    description: '查看弘阳财务数据库的当前状态：已导入的批次、商户与应收数量、流水与待认领笔数、分配记录数，以及尚未确认的科目编码。开始导入、认领或出报表前先调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dbPath: { type: 'string', required: true },
          counts: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              batches: { type: 'integer', required: true },
              merchants: { type: 'integer', required: true },
              receivables: { type: 'integer', required: true },
              transactions: { type: 'integer', required: true },
              pending: { type: 'integer', required: true },
              platformTxns: { type: 'integer', required: true },
              allocations: { type: 'integer', required: true },
            },
          },
          unconfirmedSubjects: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `数据库：${value.dbPath}`,
          `批次 ${String(value.counts.batches)}，商户 ${String(value.counts.merchants)}，应收 ${String(value.counts.receivables)}，流水 ${String(value.counts.transactions)}（待认领 ${String(value.counts.pending)}），平台明细 ${String(value.counts.platformTxns)}，分配 ${String(value.counts.allocations)}`,
          value.unconfirmedSubjects.length === 0
            ? '所有费项科目已确认。'
            : `尚未确认科目的费项：${value.unconfirmedSubjects.join('、')}（生成这些费项的凭证行前需在设置中补齐）`,
        ].join('\n'),
      }],
    },
    async execute() {
      const unconfirmed = FEE_TYPES.filter(type => FEE_RULES[type].subject === null).map(type => FEE_RULES[type].label)
      return { dbPath: service.config.dbPath, counts: service.counts(), unconfirmedSubjects: unconfirmed }
    },
  })
}
