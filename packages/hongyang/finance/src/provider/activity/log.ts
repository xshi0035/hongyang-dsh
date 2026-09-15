/**
 * Audit trail behind the finance workbench: every money-moving or
 * document-producing service operation appends one row here, keyed by the
 * local calendar day so "what happened today" is a plain lookup rather than a
 * reconstruction from session logs.
 * @module @deepseek-ai/dsh-hy-finance/provider/activity/log
 */

import type { DatabaseSync } from 'node:sqlite'
import { newId, type ActivityId } from '../../service/identifiers.ts'
import type { ActivityAction, ActivityActor, ActivityEntry } from '../../service/types.ts'

/** Calendar the finance team works in; days roll over at local midnight, not UTC. */
export const HY_TIME_ZONE = 'Asia/Shanghai'

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: HY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * Local calendar day of an instant.
 * @param instant - Point in time; defaults to now.
 * @returns `YYYY-MM-DD` in {@link HY_TIME_ZONE}.
 */
export function localDay(instant: Date = new Date()): string {
  return dayFormat.format(instant)
}

/**
 * UTC instants bounding one local calendar day, for range queries over ISO timestamps.
 * @param day - `YYYY-MM-DD` in {@link HY_TIME_ZONE}.
 * @returns ISO start (inclusive) and end (exclusive).
 */
export function dayBounds(day: string): { start: string; end: string } {
  const probe = new Date(`${day}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: HY_TIME_ZONE, timeZoneName: 'longOffset' }).formatToParts(probe)
  const offset = parts.find(part => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT([+-])(\d{2}):(\d{2})/u.exec(offset)
  const minutes = match === null ? 0 : (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
  const start = new Date(`${day}T00:00:00Z`).getTime() - minutes * 60_000
  return { start: new Date(start).toISOString(), end: new Date(start + 24 * 60 * 60_000).toISOString() }
}

/** Fields the caller supplies for one audit row. */
export interface ActivityInput {
  readonly actor: ActivityActor
  readonly action: ActivityAction
  readonly target?: string
  readonly amount?: number
  readonly detail?: string
  readonly at?: Date
}

interface ActivityRow {
  id: string
  at: string
  day: string
  actor_kind: ActivityActor['kind']
  actor: string
  action: ActivityAction
  target: string
  amount: number | null
  detail: string
}

function rowToEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id as ActivityId, at: row.at, day: row.day, actor: { kind: row.actor_kind, id: row.actor }, action: row.action,
    target: row.target, amount: row.amount ?? undefined, detail: row.detail,
  }
}

/**
 * Append one audit row.
 * @param db - Open finance database.
 * @param input - Actor, action, and what it addressed.
 * @returns The stored entry.
 */
export function recordActivity(db: DatabaseSync, input: ActivityInput): ActivityEntry {
  const at = input.at ?? new Date()
  const entry: ActivityEntry = {
    id: newId('act'), at: at.toISOString(), day: localDay(at), actor: input.actor, action: input.action,
    target: input.target ?? '', amount: input.amount, detail: input.detail ?? '',
  }
  db.prepare('INSERT INTO activity_log (id, at, day, actor_kind, actor, action, target, amount, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(entry.id, entry.at, entry.day, entry.actor.kind, entry.actor.id, entry.action, entry.target, entry.amount ?? null, entry.detail)
  return entry
}

/**
 * Audit rows of one local day, newest first.
 * @param db - Open finance database.
 * @param day - `YYYY-MM-DD` in {@link HY_TIME_ZONE}.
 * @param limit - Maximum rows returned.
 * @returns Entries newest first.
 */
export function listActivity(db: DatabaseSync, day: string, limit = 200): ActivityEntry[] {
  const rows = db.prepare('SELECT * FROM activity_log WHERE day = ? ORDER BY at DESC LIMIT ?').all(day, limit) as unknown as ActivityRow[]
  return rows.map(rowToEntry)
}
