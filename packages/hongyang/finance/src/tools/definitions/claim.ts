/**
 * `finance_claim`: run the claim engine, list the queue, confirm one item,
 * or teach a payer mapping. The structured result carries the queue so the
 * pending-claims card renders from `tool/result` metadata without parsing
 * prose.
 * @module @deepseek-ai/dsh-hy-finance/tools/definitions/claim
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { HyFinanceService } from '../../service/finance-service.ts'
import { formatCents, toCents } from '../../rules/tax.ts'
import { FEE_TYPES, FEE_RULES, type FeeType } from '../../rules/fee-types.ts'
import { SOURCE_LABELS } from '../../service/types.ts'
import type { PendingItem, UnlabelledPos } from '../../provider/claim/engine.ts'
import type { ClaimMetaWire, PendingItemWire, UnlabelledPosWire } from '../../shared/wire.ts'

const ACTIONS = ['run', 'list', 'confirm', 'learn'] as const

/** Structural twin of the tools package's lossless JSON type, for the `json` output node. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Bound on queue rows carried in metadata and text; the rest is summarized. */
const QUEUE_CAP = 60

function pendingWire(items: readonly PendingItem[]): PendingItemWire[] {
  return items.slice(0, QUEUE_CAP).map(p => ({
    itemId: p.itemId, kind: p.kind, date: p.date, source: SOURCE_LABELS[p.source], amount: formatCents(p.amount),
    payerName: p.payerName, remark: p.remark,
    suggestions: p.suggestions.map(s => ({
      shopNo: s.shopNo, name: s.name, brand: s.brand, confidence: Math.round(s.confidence * 100) / 100, reason: s.reason,
    })),
  }))
}

function unlabelledWire(rows: readonly UnlabelledPos[]): UnlabelledPosWire[] {
  return rows.map(r => ({ date: r.date, count: r.count, amount: formatCents(r.amount) }))
}

function queueText(pending: readonly PendingItemWire[], total: number, unlabelled: readonly UnlabelledPosWire[]): string[] {
  const lines: string[] = []
  lines.push(`待认领 ${String(total)} 笔：`)
  for (const p of pending) {
    const best = p.suggestions[0]
    const hint = best === undefined ? '无建议' : `建议 ${best.shopNo} ${best.name}${best.brand ? `（${best.brand}）` : ''} 置信 ${String(best.confidence)}：${best.reason}`
    lines.push(`  - [${p.itemId}] ${p.date} ${p.source} ${p.amount} 元 ${p.payerName}${p.remark ? ` “${p.remark}”` : ''} → ${hint}`)
  }
  if (total > pending.length) lines.push(`  …另有 ${String(total - pending.length)} 笔未列出`)
  if (unlabelled.length > 0) {
    const count = unlabelled.reduce((s, u) => s + u.count, 0)
    lines.push(`POS 无附言订单 ${String(count)} 笔（${unlabelled.map(u => `${u.date} ${String(u.count)} 笔 ${u.amount} 元`).join('；')}），需运营部上报或人工认领。`)
  }
  return lines
}

/**
 * Build the tool bound to one service instance.
 * @param service - the finance service.
 * @returns the tool.
 */
export function financeClaimTool(service: HyFinanceService) {
  return defineTool({
    name: 'finance_claim',
    description: '收款认领。action=run：对所有未认领收款跑三层匹配（付款人映射/户名一致、备注里的商户或铺位、金额等于未收），置信度≥0.85 的自动登记并按未收顺序拆分费项，其余进待认领队列；同时把微信电费订单按“商户-铺位”落到商户，停车费到账记停车费。action=list：列出待认领队列和建议。action=confirm：把一笔待认领登记到某铺位（itemId 来自队列，shopNo 为铺位号；可带 splits 指定费项金额），并记住该付款人。action=learn：只记住付款人→铺位映射。金额单位元。',
    parameters: {
      action: { type: 'string', required: true, enum: ACTIONS },
      itemId: { type: 'string', description: 'confirm：队列条目 id，如 txn:… 或 ptx:…' },
      shopNo: { type: 'string', description: 'confirm/learn：铺位号，如 5F-5008；confirm 时留空表示整笔挂暂收款' },
      payerName: { type: 'string', description: 'learn：付款人（对方户名）' },
      splits: {
        type: 'array', description: 'confirm 可选：费项拆分，金额为元，合计须等于收款',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            feeType: { type: 'string', required: true, enum: FEE_TYPES },
            amount: { type: 'number', required: true },
            periodStart: { type: 'string', description: 'YYYY-MM-DD' },
            periodEnd: { type: 'string', description: 'YYYY-MM-DD' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          pendingTotal: { type: 'integer', required: true },
          meta: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => value.meta,
    },
    async execute(args) {
      switch (args.action) {
        case 'run': {
          const r = service.runClaims()
          const pending = pendingWire(r.pending)
          const unlabelled = unlabelledWire(r.unlabelledPos)
          const meta: ClaimMetaWire = {
            card: 'hy-finance/claims', action: 'run', pending, unlabelledPos: unlabelled,
            autoBooked: r.autoBooked.map(a => ({ ...a, amount: formatCents(a.amount), confidence: Math.round(a.confidence * 100) / 100 })),
          }
          const lines = [
            `认领完成：银行转账 ${String(r.bankReviewed)} 笔中自动登记 ${String(r.bankAuto)} 笔，停车费到账 ${String(r.parkingAuto)} 笔记停车费；微信电费订单落到商户 ${String(r.wechatElectricity)} 笔，微信停车订单 ${String(r.wechatParking)} 笔；POS 按附言自动登记 ${String(r.posAuto)} 笔。`,
          ]
          for (const a of meta.autoBooked) lines.push(`  ✓ ${a.payerName} ${a.amount} 元 → ${a.shopNo} ${a.name}：${a.booked}（置信 ${String(a.confidence)}）`)
          lines.push(...queueText(pending, r.pending.length, unlabelled))
          return { action: 'run', summary: lines.join('\n'), pendingTotal: r.pending.length, meta: meta as unknown as JsonValue }
        }
        case 'list': {
          const q = service.listPending()
          const pending = pendingWire(q.pending)
          const unlabelled = unlabelledWire(q.unlabelledPos)
          const meta: ClaimMetaWire = { card: 'hy-finance/claims', action: 'list', pending, unlabelledPos: unlabelled, autoBooked: [] }
          return { action: 'list', summary: queueText(pending, q.pending.length, unlabelled).join('\n'), pendingTotal: q.pending.length, meta: meta as unknown as JsonValue }
        }
        case 'confirm': {
          if (args.itemId === undefined) throw new Error('confirm 需要 itemId')
          const splits = args.splits?.map((s) => {
            const cents = toCents(s.amount)
            if (cents === undefined) throw new Error(`金额无效：${String(s.amount)}`)
            return { feeType: s.feeType as FeeType, amount: cents, periodStart: s.periodStart, periodEnd: s.periodEnd }
          })
          const r = service.confirmClaim(args.itemId, args.shopNo ?? '', splits, 'user')
          const q = service.listPending()
          const pending = pendingWire(q.pending)
          const unlabelled = unlabelledWire(q.unlabelledPos)
          const shop = r.merchant?.shopNo ?? ''
          const name = r.merchant?.name ?? '暂收款'
          const meta: ClaimMetaWire = {
            card: 'hy-finance/claims', action: 'confirm', pending, unlabelledPos: unlabelled, autoBooked: [],
            confirmed: { itemId: r.itemId, shopNo: shop, name, booked: r.booked },
          }
          const summary = `已登记 ${r.itemId} → ${shop} ${name}：${r.booked}${r.learned ? '；已记住该付款人，下次自动认领' : ''}。待认领剩余 ${String(q.pending.length)} 笔。`
          return { action: 'confirm', summary, pendingTotal: q.pending.length, meta: meta as unknown as JsonValue }
        }
        case 'learn': {
          if (args.payerName === undefined || args.shopNo === undefined) throw new Error('learn 需要 payerName 和 shopNo')
          const m = service.learnPayer(args.payerName, args.shopNo)
          const meta: ClaimMetaWire = { card: 'hy-finance/claims', action: 'learn', pending: [], unlabelledPos: [], autoBooked: [] }
          return { action: 'learn', summary: `已记住：${args.payerName} → ${m.shopNo} ${m.name}${m.brand ? `（${m.brand}）` : ''}。`, pendingTotal: 0, meta: meta as unknown as JsonValue }
        }
        default: {
          const never: never = args.action
          throw new Error(String(never))
        }
      }
    },
  })
}

/** Chinese label of a fee, exported for the DingTalk bridge's replies. */
export function feeLabelOf(fee: FeeType): string {
  return FEE_RULES[fee].label
}
