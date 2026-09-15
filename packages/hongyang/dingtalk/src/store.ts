/**
 * Durable bridge state: inbound delivery ids, per-conversation drafts, and
 * interactive card instances. Lives in its own SQLite file next to the finance
 * database so a restart or a second Stream worker cannot register the same
 * payment twice. Money never lives here; the finance provider owns every row
 * that carries an amount.
 * @module @deepseek-ai/dsh-hy-dingtalk/store
 */

import { parsePaymentImageExtraction, type PaymentImageExtraction } from '@deepseek-ai/dsh-hy-finance'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Current schema version; version 1 drafts migrate without losing text or cards. */
export const HY_DINGTALK_STATE_VERSION = 2
const APPLICATION_ID = 0x4859444b
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Accumulated payment text for one conversation and user, with a revision id. */
export interface DingtalkDraft {
  /** Regenerated on every write so a stale card cannot confirm a newer draft. */
  readonly id: string
  readonly conversationId: string
  readonly userId: string
  readonly text: string
  readonly image?: PaymentImageExtraction
  readonly expires: number
}
/** Lifecycle of one delivered card instance. */
export type DingtalkCardStatus = 'open' | 'confirming' | 'confirmed' | 'submitted' | 'cancelled'
/** One interactive card instance and the draft revision it was rendered from. */
export interface DingtalkCardRecord {
  readonly outTrackId: string
  readonly draftKey: string
  readonly draftId: string
  readonly userId: string
  readonly status: DingtalkCardStatus
  readonly result: string | undefined
  readonly transactionId: string | undefined
  readonly createdAt: number
}
/** Durable bridge state shared by the text and card paths. */
export interface DingtalkStateStore {
  /** Record an inbound delivery id; false when it was already processed. */
  claimDelivery(id: string, now: number): boolean
  /** Advance the conversation revision on every accepted message, including cancellation. */
  setRevision(key: string, deliveryId: string): void
  getRevision(key: string): string | undefined
  getDraft(key: string, now: number): DingtalkDraft | undefined
  putDraft(key: string, draft: DingtalkDraft): void
  deleteDraft(key: string): void
  countDrafts(now: number): number
  putCard(card: DingtalkCardRecord): void
  getCard(outTrackId: string): DingtalkCardRecord | undefined
  /** Move an open card to `confirming`; false when it is not open. */
  claimCard(outTrackId: string): boolean
  /** Record the outcome of one card; `open` reopens a failed confirmation. */
  settleCard(outTrackId: string, status: 'open' | 'confirmed' | 'submitted' | 'cancelled', result?: string, transactionId?: string): void
  /** Settle every card still open or confirming for one draft revision. */
  settleDraftCards(draftId: string, status: 'confirmed' | 'submitted' | 'cancelled', result: string, transactionId?: string): void
  close(): void
}

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversation_revision (
  key TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery (
  id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS draft (
  key TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  image TEXT,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS card (
  out_track_id TEXT PRIMARY KEY,
  draft_key TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  transaction_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS card_draft ON card(draft_id);
`

function configure(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  const { application_id: appId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (version !== 0 && ((version !== 1 && version !== HY_DINGTALK_STATE_VERSION) || appId !== APPLICATION_ID)) {
    throw new Error(`dingtalk state database at "${path}" has schema version ${String(version)} (app ${String(appId)}), this build expects ${String(HY_DINGTALK_STATE_VERSION)}`)
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(SCHEMA)
    const current = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (current.user_version === 1) db.exec('ALTER TABLE draft ADD COLUMN image TEXT')
    db.exec(`PRAGMA application_id = ${String(APPLICATION_ID)}`)
    db.exec(`PRAGMA user_version = ${String(HY_DINGTALK_STATE_VERSION)}`)
    // One Stream owner opens this store; interrupted claims can retry the idempotent submission.
    db.exec("UPDATE card SET status = 'open' WHERE status = 'confirming'")
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }

}

interface DraftRow { id: string; conversation_id: string; user_id: string; text: string; image: string | null; expires: number }
interface CardRow {
  out_track_id: string
  draft_key: string
  draft_id: string
  user_id: string
  status: DingtalkCardStatus
  result: string | null
  transaction_id: string | null
  created_at: number
}

/**
 * Open (creating when missing) the bridge state database.
 * @param path - Absolute file path, or `:memory:` for tests.
 * @returns The store; close it with the owning plugin.
 */
export async function openDingtalkStateStore(path: string): Promise<DingtalkStateStore> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    configure(db, actual)
  } catch (error) {
    db.close()
    throw error
  }
  const purgeDrafts = (now: number): void => { db.prepare('DELETE FROM draft WHERE expires <= ?').run(now) }
  return {
    claimDelivery(id, now) {
      db.prepare('DELETE FROM delivery WHERE seen_at < ?').run(now - DELIVERY_RETENTION_MS)
      return db.prepare('INSERT OR IGNORE INTO delivery (id, seen_at) VALUES (?, ?)').run(id, now).changes === 1
    },
    setRevision(key, deliveryId) {
      db.prepare('INSERT OR REPLACE INTO conversation_revision (key, delivery_id) VALUES (?, ?)').run(key, deliveryId)
    },
    getRevision(key) {
      return (db.prepare('SELECT delivery_id FROM conversation_revision WHERE key = ?').get(key) as { delivery_id: string } | undefined)?.delivery_id
    },
    getDraft(key, now) {
      purgeDrafts(now)
      const row = db.prepare('SELECT id, conversation_id, user_id, text, image, expires FROM draft WHERE key = ?').get(key) as DraftRow | undefined
      if (row === undefined) return undefined
      return {
        id: row.id, conversationId: row.conversation_id, userId: row.user_id, text: row.text, expires: row.expires,
        ...(row.image === null ? {} : { image: parsePaymentImageExtraction(row.image) }),
      }
    },
    putDraft(key, draft) {
      db.prepare('INSERT OR REPLACE INTO draft (key, id, conversation_id, user_id, text, image, expires) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          key, draft.id, draft.conversationId, draft.userId, draft.text,
          draft.image === undefined ? null : JSON.stringify(draft.image), draft.expires,
        )
    },
    deleteDraft(key) { db.prepare('DELETE FROM draft WHERE key = ?').run(key) },
    countDrafts(now) {
      purgeDrafts(now)
      return (db.prepare('SELECT COUNT(*) AS n FROM draft').get() as { n: number }).n
    },
    putCard(card) {
      db.prepare(`INSERT INTO card (out_track_id, draft_key, draft_id, user_id, status, result, transaction_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          card.outTrackId, card.draftKey, card.draftId, card.userId, card.status,
          card.result ?? null, card.transactionId ?? null, card.createdAt,
        )
    },
    getCard(outTrackId) {
      const row = db.prepare('SELECT * FROM card WHERE out_track_id = ?').get(outTrackId) as CardRow | undefined
      return row === undefined ? undefined : {
        outTrackId: row.out_track_id, draftKey: row.draft_key, draftId: row.draft_id, userId: row.user_id, status: row.status,
        result: row.result ?? undefined, transactionId: row.transaction_id ?? undefined, createdAt: row.created_at,
      }
    },
    claimCard(outTrackId) {
      return db.prepare("UPDATE card SET status = 'confirming' WHERE out_track_id = ? AND status = 'open'").run(outTrackId).changes === 1
    },
    settleCard(outTrackId, status, result, transactionId) {
      db.prepare('UPDATE card SET status = ?, result = ?, transaction_id = ? WHERE out_track_id = ?')
        .run(status, result ?? null, transactionId ?? null, outTrackId)
    },
    settleDraftCards(draftId, status, result, transactionId) {
      db.prepare("UPDATE card SET status = ?, result = ?, transaction_id = ? WHERE draft_id = ? AND status IN ('open', 'confirming')")
        .run(status, result, transactionId ?? null, draftId)
    },
    close() { db.close() },
  }
}
