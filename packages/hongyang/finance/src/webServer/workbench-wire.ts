/**
 * Projection of the workbench summary into its browser wire shape: cents
 * become yuan strings and branded ids become plain strings.
 * @module @deepseek-ai/dsh-hy-finance/webServer/workbench-wire
 */

import { FEE_RULES, type FeeType } from '../rules/fee-types.ts'
import { SOURCE_LABELS } from '../service/types.ts'
import type { WorkbenchSummary } from '../provider/query/workbench.ts'
import { formatCents } from '../rules/tax.ts'
import type { WorkbenchWire } from '../shared/wire.ts'

/**
 * Convert one day's workbench summary for the browser.
 * @param summary - Provider summary with integer cents.
 * @returns The same data with yuan strings.
 */
export function toWorkbenchWire(summary: WorkbenchSummary): WorkbenchWire {
  return {
    date: summary.date,
    voucherQueue: {
      allocatedAmount: formatCents(summary.voucherQueue.allocatedAmount),
      draftedCount: summary.voucherQueue.draftedCount, draftedAmount: formatCents(summary.voucherQueue.draftedAmount),
      pendingCount: summary.voucherQueue.pendingCount, pendingAmount: formatCents(summary.voucherQueue.pendingAmount),
      unclaimedCount: summary.voucherQueue.unclaimedCount, unclaimedAmount: formatCents(summary.voucherQueue.unclaimedAmount),
      receipts: summary.voucherQueue.receipts.map(row => ({ receiptId: row.receiptId, shopNo: row.shopNo, merchantName: row.merchantName || (row.amounts.parking === undefined ? '' : FEE_RULES.parking.label),
        source: SOURCE_LABELS[row.source], amount: formatCents(row.subtotal), remark: row.source === 'dingtalk' ? '' : row.remark, voucherId: row.voucherId,
        fees: Object.entries(row.amounts).map(([fee, amount]) => `${FEE_RULES[fee as FeeType].label} ${formatCents(amount)}`).join(' + ') })),
    },
    pendingReviews: summary.pendingReviews.map(row => ({
      id: row.id, submittedAt: row.submittedAt, shopNo: row.shopNo, merchantName: row.merchantName,
      duplicateMessage: row.duplicateMessage,
      summary: row.summary, text: row.text, paymentDate: row.paymentDate, transactionNo: row.image?.transactionNo ?? '',
    })),
    receipts: summary.receipts.map(row => ({ source: row.source, count: row.count, amount: formatCents(row.cents) })),
    registrations: summary.registrations.map(row => ({
      at: row.at, source: row.source, shopNo: row.shopNo, merchantName: row.merchantName, fee: row.fee,
      amount: formatCents(row.cents), origin: row.origin, status: row.status, transactionId: row.transactionId,
    })),
    registrationTotal: { count: summary.registrationTotal.count, amount: formatCents(summary.registrationTotal.cents) },
    todos: {
      pendingClaims: summary.todos.pendingClaims,
      pendingClaimsAmount: formatCents(summary.todos.pendingClaimsCents),
      unlabelledPos: summary.todos.unlabelledPos,
      overdueMerchants: summary.todos.overdueMerchants,
      overdueAmount: formatCents(summary.todos.overdueCents),
      reportBuilt: summary.todos.reportBuilt,
      voucherBuilt: summary.todos.voucherBuilt,
      extra: summary.todos.extra.map(item => ({ id: item.id, label: item.label, count: item.count })),
    },
    activity: summary.activity.map(entry => ({
      id: entry.id, at: entry.at, actorKind: entry.actor.kind, actor: entry.actor.id, action: entry.action, target: entry.target,
      amount: entry.amount === undefined ? undefined : formatCents(entry.amount), detail: entry.detail,
    })),
  }
}
