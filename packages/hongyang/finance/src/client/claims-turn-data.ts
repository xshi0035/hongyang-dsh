/**
 * Turn projection of the claim queue. A pure reducer over the Turn's
 * `tool/result` events: the latest `finance_claim` result's metadata is the
 * queue this Turn ends with, and confirmations made from the card are
 * layered on top locally until the next tool result replaces them. Nothing
 * here reads prose or calls the Host.
 */

import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClaimMetaWire } from '../shared/wire.ts'

/** The queue as published against one Turn. */
export interface ClaimsTurnData {
  /** Sequence of the tool result the queue came from. */
  readonly seq: number
  readonly meta: ClaimMetaWire
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Latest claim queue produced in this Turn. */
    hyFinanceClaims: ClaimsTurnData
  }
}

interface ClaimsState {
  readonly turn: number
  readonly latest: ClaimsTurnData | undefined
}

function isClaimMeta(value: unknown): value is ClaimMetaWire {
  return typeof value === 'object' && value !== null && (value as { card?: unknown }).card === 'hy-finance/claims'
    && Array.isArray((value as { pending?: unknown }).pending)
}

/** Turn-local accumulator of the last claim queue; it publishes no view Node. */
export const claimsDefinition: ConversationNodeDefinition<ClaimsState> = {
  kind: 'hyFinanceClaims',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('hyFinanceClaims start requires turn/start')
    return { turn: match.event.data.turn, latest: undefined }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const meta = (match.event.data as { meta?: unknown }).meta
    if (!isClaimMeta(meta)) return context.state
    return { ...context.state, latest: { seq: match.event.seq, meta } }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined || context.state.latest === undefined) return null
    if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === 'hyFinanceClaims'
      && previous.value === context.state.latest) return previous
    return { kind: 'turn', turn: context.state.turn, key: 'hyFinanceClaims', value: context.state.latest }
  },
}

/**
 * Claim the turn-tail chain only when the closing Turn produced a queue with rows.
 * @param owner - turn-tail owner currency.
 * @returns the queue, or null to decline before mount.
 */
export function selectClaims(owner: TurnTailOwnerProps): ClaimsTurnData | null {
  const data = owner.turn.data.get('hyFinanceClaims')
  if (data === undefined || data.seq > owner.seq) return null
  if (data.meta.pending.length === 0 && data.meta.unlabelledPos.length === 0 && data.meta.autoBooked.length === 0) return null
  return data
}
