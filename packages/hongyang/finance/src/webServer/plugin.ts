/**
 * Host HTTP routes behind the browser cards, registered on the Connection
 * fetch registry so they ride the authenticated API channel:
 *
 * - `GET  /api/hy-finance/merchants`        the merchant picker list;
 * - `POST /api/hy-finance/claim/confirm`    book one queued receipt to a shop;
 * - `GET  /api/hy-finance/workbench?date=`  one day's registrations, to-dos, and audit trail.
 *
 * A confirmation from the card also reaches the model: the Agent of the
 * viewing Session receives a plugin-sourced user message describing what the
 * person decided, so the next reply can continue from it.
 * @module @deepseek-ai/dsh-hy-finance/webServer/plugin
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exportVoucher } from '../provider/voucher/export.ts'
import { withdrawVoucherDraft } from '../provider/voucher/queue.ts'
import type { VoucherId, TransactionId } from '../service/identifiers.ts'
import { reversiblePayments, reversePayment } from '../provider/register/reversal.ts'
import { validPaymentDay } from '../provider/register/review.ts'
import { FEE_RULES, FEE_TYPES } from '../rules/fee-types.ts'
import { compareVoucher } from '../provider/voucher/compare.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { decidePayment, paymentReviewDetails } from '../provider/register/submission.ts'
import type { PaymentSubmissionId } from '../service/identifiers.ts'
import { FinanceError } from '../service/errors.ts'
import { HY_FINANCE_API, type ConfirmRequestWire, type ConfirmResponseWire, type MerchantWire } from '../shared/wire.ts'
import { toWorkbenchWire } from './workbench-wire.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/u

/** Cordis plugin name. */
export const name = 'hy-finance-web'
/** Required services. */
export const inject = ['connection', 'hyFinance', 'agents']

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Register the routes.
 * @param ctx - context owning the registrations.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/payment/details`, methods: ['GET'], requestBody: 'buffered',
    fetch: (request) => {
      try {
        const id = new URL(request.url).searchParams.get('id') ?? ''
        const options = { companyName: ctx.hyFinance.config.companyName }
        const details = paymentReviewDetails(ctx.hyFinance.db(), id as PaymentSubmissionId, options)
        return Promise.resolve(json({ ...details,
          fees: FEE_TYPES.map(fee => ({ value: fee, label: FEE_RULES[fee].label })) }))
      } catch (error) { return Promise.resolve(json({ message: error instanceof Error ? error.message : String(error) }, 409)) }
    },
  }), 'hy-finance: review allocation defaults')
  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/payment/reversals`, methods: ['GET'], requestBody: 'buffered',
    fetch: (request) => {
      const date = new URL(request.url).searchParams.get('date') ?? ''
      if (!validPaymentDay(date)) return Promise.resolve(json({ message: 'invalid date' }, 400))
      return Promise.resolve(json({ payments: reversiblePayments(ctx.hyFinance.db(), date) }))
    },
  }), 'hy-finance: payment reversal list')
  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/payment/reverse`, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body: unknown
      try { body = await request.json() } catch { return json({ message: 'request body must be JSON' }, 400) }
      if (body === null || typeof body !== 'object' || !('transactionId' in body) || typeof body.transactionId !== 'string'
        || !('date' in body) || typeof body.date !== 'string' || !('reason' in body) || typeof body.reason !== 'string'
        || !('allocationIds' in body) || !Array.isArray(body.allocationIds) || !body.allocationIds.every((id: unknown) => typeof id === 'string')) return json({ message: 'invalid reversal request' }, 400)
      try {
        const id = reversePayment(ctx.hyFinance.db(), { transactionId: body.transactionId as TransactionId,
          date: body.date, reason: body.reason, allocationIds: body.allocationIds }, { kind: 'web', id: 'workbench' })
        return json({ ok: true, transactionId: id })
      } catch (error) { return json({ message: error instanceof Error ? error.message : String(error) }, 409) }
    },
  }), 'hy-finance: payment reversal')
  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/voucher/draft`, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body: unknown
      try { body = await request.json() } catch { return json({ ok: false, message: 'request body must be JSON' }, 400) }
      if (body === null || typeof body !== 'object' || !('date' in body) || typeof body.date !== 'string' || !DAY.test(body.date)
        || !('receiptIds' in body) || !Array.isArray(body.receiptIds) || !body.receiptIds.every((id: unknown) => typeof id === 'string')) return json({ ok: false, message: 'date and receiptIds are required' }, 400)
      try {
        const voucher = ctx.hyFinance.buildVoucher(body.date, { kind: 'web', id: 'workbench' }, body.receiptIds)
        const path = await exportVoucher(voucher, join(dirname(ctx.hyFinance.config.dbPath), '凭证'))
        ctx.hyFinance.db().prepare('UPDATE voucher SET xlsx_path=? WHERE id=?').run(path, voucher.id)
        return json({ ok: true, voucher, compare: compareVoucher(ctx.hyFinance.db(), voucher) })
      } catch (error) { return json({ ok: false, message: error instanceof Error ? error.message : String(error) }, 409) }
    },
  }), 'hy-finance: selected voucher draft')
  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/voucher/withdraw`, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body: unknown
      try { body = await request.json() } catch { return json({ ok: false, message: 'request body must be JSON' }, 400) }
      if (body === null || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string'
        || !('reason' in body) || typeof body.reason !== 'string') return json({ ok: false, message: 'id and reason are required' }, 400)
      try {
        withdrawVoucherDraft(ctx.hyFinance.db(), body.id as VoucherId, body.reason, { kind: 'web', id: 'workbench' })
        return json({ ok: true })
      } catch (error) { return json({ ok: false, message: error instanceof Error ? error.message : String(error) }, 409) }
    },
  }), 'hy-finance: withdraw voucher draft')
  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/voucher/file`, methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      const row = ctx.hyFinance.db().prepare('SELECT xlsx_path FROM voucher WHERE id=? AND NOT EXISTS (SELECT 1 FROM voucher_void WHERE voucher_id=voucher.id)').get(id) as { xlsx_path: string | null } | undefined
      if (!row?.xlsx_path) return json({ ok: false, message: 'voucher export not found' }, 404)
      return new Response(new Uint8Array(await readFile(row.xlsx_path)), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="voucher.xlsx"', 'cache-control': 'no-store' } })
    },
  }), 'hy-finance: voucher download')

  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/payment/review`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body: unknown
      try { body = await request.json() } catch { return json({ ok: false, message: 'request body must be JSON' }, 400) }
      if (body === null || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string'
        || !('decision' in body) || (body.decision !== 'approve' && body.decision !== 'reject')) {
        return json({ ok: false, message: 'id and approve/reject decision are required' }, 400)
      }
      try {
        const options = { companyName: ctx.hyFinance.config.companyName }
        const result = decidePayment(ctx.hyFinance.db(), body.id as PaymentSubmissionId, body.decision, options, 'review' in body ? body.review : undefined)
        return json({ ok: true, id: result.id, status: result.status, transactionId: result.transactionId })
      } catch (error) {
        return json({ ok: false, message: error instanceof Error ? error.message : String(error) }, 409)
      }
    },
  }), 'hy-finance: payment review route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/merchants`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const merchants: MerchantWire[] = ctx.hyFinance.merchants().map(m => ({ shopNo: m.shopNo, name: m.name, brand: m.brand }))
      return Promise.resolve(json({ merchants }))
    },
  }), 'hy-finance: merchants route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/claim/confirm`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body: ConfirmRequestWire
      try {
        body = await request.json() as ConfirmRequestWire
      } catch {
        return json({ ok: false, code: 'INVALID_INPUT', message: 'request body must be JSON' } satisfies ConfirmResponseWire, 400)
      }
      if (typeof body.itemId !== 'string' || typeof body.shopNo !== 'string' || typeof body.sessionId !== 'string') {
        return json({ ok: false, code: 'INVALID_INPUT', message: 'itemId, shopNo, sessionId are required' } satisfies ConfirmResponseWire, 400)
      }
      try {
        const r = ctx.hyFinance.confirmClaim(body.itemId, body.shopNo, undefined, 'user', { kind: 'web', id: body.sessionId })
        const shopNo = r.merchant?.shopNo ?? ''
        const merchantName = r.merchant?.name ?? '暂收款'
        const agent = ctx.agents.get(body.sessionId as SessionId)
        if (agent !== undefined) {
          try {
            agent.inject(createUserMessage({
              content: [{
                type: 'text',
                text: `【卡片操作】用户在待认领卡片里把 ${body.itemId} 登记到 ${shopNo} ${merchantName}：${r.booked}${r.learned ? '，并记住了该付款人' : ''}。`,
              }],
              source: { kind: 'plugin', plugin: 'hy-finance' },
            }))
          } catch {
            // A disposed agent cannot take context; the booking itself already succeeded.
          }
        }
        const ok: ConfirmResponseWire = { ok: true, itemId: r.itemId, shopNo, name: merchantName, booked: r.booked, learned: r.learned }
        return json(ok)
      } catch (error) {
        if (error instanceof FinanceError) {
          return json({ ok: false, code: error.code, message: error.message } satisfies ConfirmResponseWire)
        }
        return json({ ok: false, code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } satisfies ConfirmResponseWire, 500)
      }
    },
  }), 'hy-finance: confirm route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: `${HY_FINANCE_API}/workbench`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => {
      const date = new URL(request.url).searchParams.get('date') ?? undefined
      if (date !== undefined && !DAY.test(date)) {
        return Promise.resolve(json({ ok: false, code: 'INVALID_INPUT', message: 'date must be YYYY-MM-DD' }, 400))
      }
      try {
        return Promise.resolve(json(toWorkbenchWire(ctx.hyFinance.workbench(date))))
      } catch (error) {
        return Promise.resolve(json({ ok: false, code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }, 500))
      }
    },
  }), 'hy-finance: workbench route')
}
