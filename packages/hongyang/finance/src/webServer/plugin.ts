/**
 * Host HTTP routes behind the browser cards, registered on the Connection
 * fetch registry so they ride the authenticated API channel:
 *
 * - `GET  /api/hy-finance/merchants`        the merchant picker list;
 * - `POST /api/hy-finance/claim/confirm`    book one queued receipt to a shop.
 *
 * A confirmation from the card also reaches the model: the Agent of the
 * viewing Session receives a plugin-sourced user message describing what the
 * person decided, so the next reply can continue from it.
 * @module @deepseek-ai/dsh-hy-finance/webServer/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { FinanceError } from '../service/errors.ts'
import { HY_FINANCE_API, type ConfirmRequestWire, type ConfirmResponseWire, type MerchantWire } from '../shared/wire.ts'

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
    path: `${HY_FINANCE_API}/merchants`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const merchants: MerchantWire[] = ctx.hyFinance.merchants().map(m => ({ shopNo: m.shopNo, name: m.name, brand: m.brand }))
      return json({ merchants })
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
        const r = ctx.hyFinance.confirmClaim(body.itemId, body.shopNo, undefined, 'user')
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
}
