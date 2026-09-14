/**
 * Row access shared by the provider modules. Every write goes through one of
 * these helpers so column order and cents conventions live in one place.
 * @module @deepseek-ai/dsh-hy-finance/provider/db/repo
 */

import type { DatabaseSync } from 'node:sqlite'
import { newId, type BatchId, type MerchantId } from '../../service/identifiers.ts'
import type { ImportBatch, ImportKind, Merchant, PlatformTxn, Transaction } from '../../service/types.ts'

/**
 * Run `fn` inside one transaction; rolls back on throw.
 * @param db - Open finance database.
 * @param fn - Synchronous operation whose writes commit together.
 * @returns The operation result after commit.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * The batch already recorded for a file digest, if any.
 * @param db - Open finance database.
 * @param sha256 - SHA-256 digest of the source file.
 * @returns Existing batch metadata, or undefined.
 */
export function findBatchBySha(db: DatabaseSync, sha256: string): ImportBatch | undefined {
  const row = db.prepare('SELECT id, kind, file, sha256, rows, imported_at FROM import_batch WHERE sha256 = ?').get(sha256) as
    | { id: string; kind: string; file: string; sha256: string; rows: number; imported_at: string } | undefined
  if (row === undefined) return undefined
  return {
    id: row.id as BatchId, kind: row.kind as ImportKind, file: row.file, sha256: row.sha256, rows: row.rows, importedAt: row.imported_at,
  }
}

/**
 * Record one import batch.
 * @param db - Open finance database.
 * @param kind - Selected or detected import kind.
 * @param file - Source file path.
 * @param sha256 - SHA-256 digest of the source file.
 * @param rows - Number of imported source rows.
 * @returns Stored import batch metadata.
 */
export function insertBatch(db: DatabaseSync, kind: ImportKind, file: string, sha256: string, rows: number): ImportBatch {
  const id = newId('batch')
  const importedAt = new Date().toISOString()
  db.prepare('INSERT INTO import_batch (id, kind, file, sha256, rows, imported_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, kind, file, sha256, rows, importedAt)
  return { id, kind, file, sha256, rows, importedAt }
}

/**
 * Insert or update a merchant by shop number; a blank name never overwrites a known one.
 * @param db - Open finance database.
 * @param shopNo - Selected shop number.
 * @param name - Merchant name; blank retains the existing value.
 * @param brand - Brand text; blank retains the existing value.
 * @param floor - Floor text; blank retains the existing value.
 * @returns Inserted or existing merchant identifier.
 */
export function upsertMerchant(db: DatabaseSync, shopNo: string, name: string, brand: string, floor: string): MerchantId {
  const existing = db.prepare('SELECT id, name, brand, floor FROM merchant WHERE shop_no = ?').get(shopNo) as
    | { id: string; name: string; brand: string; floor: string } | undefined
  if (existing !== undefined) {
    db.prepare('UPDATE merchant SET name = ?, brand = ?, floor = ? WHERE id = ?').run(
      name || existing.name, brand || existing.brand, floor || existing.floor, existing.id,
    )
    return existing.id as MerchantId
  }
  const id = newId('mch')
  db.prepare('INSERT INTO merchant (id, shop_no, name, brand, floor) VALUES (?, ?, ?, ?, ?)').run(id, shopNo, name, brand, floor)
  return id
}

/**
 * All merchants, for matching.
 * @param db - Open finance database.
 * @returns Merchant records sorted by shop number.
 */
export function listMerchants(db: DatabaseSync): Merchant[] {
  const rows = db.prepare('SELECT id, shop_no, name, brand, floor FROM merchant ORDER BY shop_no').all() as
    { id: string; shop_no: string; name: string; brand: string; floor: string }[]
  return rows.map(r => ({ id: r.id as MerchantId, shopNo: r.shop_no, name: r.name, brand: r.brand, floor: r.floor }))
}

/**
 * Insert a transaction; returns false when its `(source, txn_no)` already exists.
 * @param db - Open finance database.
 * @param t - Receipt fields with integer-cent amounts.
 * @returns True when inserted, false for a duplicate source reference.
 */
export function insertTransaction(db: DatabaseSync, t: Transaction): boolean {
  if (t.txnNo !== '') {
    const dup = db.prepare('SELECT 1 FROM "transaction" WHERE source = ? AND txn_no = ?').get(t.source, t.txnNo)
    if (dup !== undefined) return false
  }
  db.prepare(`INSERT INTO "transaction"
    (id, batch_id, source, channel, txn_time, amount, payer_name, payer_account, remark, txn_no, parent_id, status, merchant_id, confidence, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    t.id, t.batchId ?? null, t.source, t.channel, t.txnTime, t.amount, t.payerName, t.payerAccount, t.remark, t.txnNo,
    t.parentId ?? null, t.status, t.merchantId ?? null, t.confidence, t.raw,
  )
  return true
}

/**
 * Insert a platform detail row; returns false on a duplicate order.
 * @param db - Open finance database.
 * @param p - Platform detail with integer-cent amounts.
 * @returns True when inserted, false for a duplicate platform order.
 */
export function insertPlatformTxn(db: DatabaseSync, p: PlatformTxn): boolean {
  const dup = db.prepare('SELECT 1 FROM platform_txn WHERE platform = ? AND merchant_account = ? AND order_no = ?')
    .get(p.platform, p.merchantAccount, p.orderNo)
  if (dup !== undefined) return false
  db.prepare(`INSERT INTO platform_txn
    (id, transaction_id, platform, merchant_account, order_no, txn_time, amount, fee, net, note, merchant_hint, shop_no, merchant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    p.id, p.transactionId ?? null, p.platform, p.merchantAccount, p.orderNo, p.txnTime, p.amount, p.fee, p.net, p.note,
    p.merchantHint, p.shopNo ?? null, p.merchantId ?? null,
  )
  return true
}

/**
 * Map a database row of `"transaction"` to the domain record.
 * @param r - SQLite row selected using transaction column names.
 * @returns Typed receipt with optional null values converted to undefined.
 */
export function rowToTransaction(r: Record<string, unknown>): Transaction {
  return {
    id: r.id as Transaction['id'],
    batchId: (r.batch_id ?? undefined) as Transaction['batchId'],
    source: r.source as Transaction['source'],
    channel: r.channel as Transaction['channel'],
    txnTime: r.txn_time as string,
    amount: r.amount as number,
    payerName: r.payer_name as string,
    payerAccount: r.payer_account as string,
    remark: r.remark as string,
    txnNo: r.txn_no as string,
    parentId: (r.parent_id ?? undefined) as Transaction['parentId'],
    status: r.status as Transaction['status'],
    merchantId: (r.merchant_id ?? undefined) as Transaction['merchantId'],
    confidence: r.confidence as number,
    raw: r.raw as string,
  }
}

/** Columns of `"transaction"` in `rowToTransaction` order. */
export const TRANSACTION_COLUMNS = 'id, batch_id, source, channel, txn_time, amount, payer_name, payer_account, remark, txn_no, parent_id, status, merchant_id, confidence, raw'
