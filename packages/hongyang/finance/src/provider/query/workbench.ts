/**
 * Read-only aggregate behind the finance workbench page: what was registered
 * today, what still needs a person, and the day's audit trail. Every number
 * comes from the finance tables; nothing here writes.
 * @module @deepseek-ai/dsh-hy-finance/provider/query/workbench
 */

import { voucherQueue, type VoucherQueue } from '../voucher/queue.ts'
import type { DatabaseSync } from 'node:sqlite'
import { FEE_RULES, type FeeType } from '../../rules/fee-types.ts'
import { SOURCE_LABELS, type ActivityEntry, type AllocationOrigin, type Source } from '../../service/types.ts'
import { dayBounds, listActivity } from '../activity/log.ts'
import { pendingPayments, type PaymentSubmission } from '../register/submission.ts'
import { listPending } from '../claim/engine.ts'
import { overdue, type ReceiptToday } from './dashboard.ts'

/** One payment a person or DingTalk registered today. */
export interface WorkbenchRegistration {
  readonly at: string
  readonly source: string
  readonly shopNo: string
  readonly merchantName: string
  readonly fee: string
  /** Integer cents. */
  readonly cents: number
  readonly origin: AllocationOrigin | 'pending'
  readonly status: string
  readonly transactionId: string
}

/** A to-do counter contributed by another plugin (for example DingTalk drafts awaiting confirmation). */
export interface WorkbenchTodoSource {
  readonly id: string
  readonly label: string
  readonly count: number
}

/** Everything the workbench page shows for one day. */
export interface WorkbenchSummary {
  readonly voucherQueue: VoucherQueue
  readonly pendingReviews: readonly PaymentSubmission[]
  readonly date: string
  /** Booked money by source for receipts dated that day. */
  readonly receipts: readonly ReceiptToday[]
  /** Person- or DingTalk-registered payments created that day, newest first. */
  readonly registrations: readonly WorkbenchRegistration[]
  readonly registrationTotal: { readonly count: number; readonly cents: number }
  readonly todos: {
    readonly pendingClaims: number
    readonly pendingClaimsCents: number
    readonly unlabelledPos: number
    readonly overdueMerchants: number
    readonly overdueCents: number
    readonly reportBuilt: boolean
    readonly voucherBuilt: boolean
    readonly extra: readonly WorkbenchTodoSource[]
  }
  readonly activity: readonly ActivityEntry[]
}

/** Inputs the service resolves from configuration and registered plugins. */
export interface WorkbenchOptions {
  readonly overdueDays: number
  readonly extraTodos: readonly WorkbenchTodoSource[]
}

interface RegistrationRow {
  at: string
  source: Source
  shop_no: string | null
  merchant_name: string | null
  fee_type: FeeType
  cents: number
  origin: AllocationOrigin
  status: string
  transaction_id: string
  platform_txn_id: string | null
}

interface PendingRow {
  txn_time: string
  source: Source
  amount: number
  id: string
  raw: string
}

function registrations(db: DatabaseSync, date: string): WorkbenchRegistration[] {
  const { start, end } = dayBounds(date)
  const booked = db.prepare(`SELECT a.created_at AS at, t.source, m.shop_no, m.name AS merchant_name, a.fee_type, a.amount_incl_tax AS cents,
      a.origin, CASE
        WHEN EXISTS (SELECT 1 FROM payment_reversal WHERE original_id=t.id) THEN 'reversed'
        WHEN EXISTS (SELECT 1 FROM payment_reversal WHERE reversal_id=t.id) THEN 'reversal'
        ELSE t.status END AS status, t.id AS transaction_id, a.platform_txn_id
    FROM allocation a JOIN "transaction" t ON t.id = a.transaction_id LEFT JOIN merchant m ON m.id = a.merchant_id
    WHERE a.origin IN ('dingtalk', 'user') AND a.created_at >= ? AND a.created_at < ?
    ORDER BY a.created_at DESC`).all(start, end) as unknown as RegistrationRow[]
  const pending = db.prepare(`SELECT txn_time, source, amount, id, raw FROM "transaction"
    WHERE source = 'dingtalk' AND status = 'pending' AND txn_time = ? ORDER BY rowid DESC`).all(date) as unknown as PendingRow[]
  return [
    ...groupRegistrations(booked),
    ...pending.map(row => ({
      at: row.txn_time, source: SOURCE_LABELS[row.source], shopNo: '', merchantName: row.raw.split('\n').slice(-1)[0] ?? '',
      fee: '', cents: row.amount, origin: 'pending' as const, status: 'pending', transactionId: row.id,
    })),
  ]
}

function groupRegistrations(rows: readonly RegistrationRow[]): WorkbenchRegistration[] {
  const groups = new Map<string, WorkbenchRegistration>()
  for (const row of rows) {
    const key = `${row.transaction_id}|${row.platform_txn_id ?? ''}|${row.shop_no ?? ''}`
    const prior = groups.get(key)
    const fee = FEE_RULES[row.fee_type].label
    groups.set(key, { at: prior?.at ?? row.at, source: SOURCE_LABELS[row.source], shopNo: row.shop_no ?? '',
      merchantName: row.merchant_name ?? '', fee: prior === undefined ? fee : `${prior.fee} + ${fee}`,
      cents: (prior?.cents ?? 0) + row.cents, origin: row.origin, status: row.status, transactionId: row.transaction_id,
    })
  }
  return [...groups.values()]
}

/**
 * Assemble the workbench view for one local day.
 * @param db - Open finance database.
 * @param date - `YYYY-MM-DD` local day.
 * @param options - Overdue window and plugin-contributed to-do counters.
 * @returns Receipts, registrations, to-dos, and the audit trail for that day.
 */
export function workbenchSummary(db: DatabaseSync, date: string, options: WorkbenchOptions): WorkbenchSummary {
  const registered = registrations(db, date)
  const queue = listPending(db)
  const overdueRows = overdue(db, options.overdueDays, date)
  const vouchers = voucherQueue(db, date)
  const receiptSources = new Map<Source, ReceiptToday>()
  for (const row of vouchers.receipts) {
    const prior = receiptSources.get(row.source)
    receiptSources.set(row.source, {
      source: SOURCE_LABELS[row.source], count: (prior?.count ?? 0) + 1, cents: (prior?.cents ?? 0) + row.subtotal,
    })
  }
  const built = (table: 'daily_report' | 'voucher'): boolean =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE date = ?`).get(date) as { n: number }).n > 0
  return {
    date,
    voucherQueue: vouchers,
    pendingReviews: pendingPayments(db),
    receipts: [...receiptSources.values()],
    registrations: registered,
    registrationTotal: { count: registered.length, cents: registered.reduce((sum, row) => sum + row.cents, 0) },
    todos: {
      pendingClaims: queue.pending.length,
      pendingClaimsCents: queue.pending.reduce((sum, item) => sum + item.amount, 0),
      unlabelledPos: queue.unlabelledPos.reduce((sum, item) => sum + item.count, 0),
      overdueMerchants: overdueRows.length,
      overdueCents: overdueRows.reduce((sum, row) => sum + row.openCents, 0),
      reportBuilt: built('daily_report'),
      voucherBuilt: (db.prepare('SELECT COUNT(*) n FROM voucher WHERE date=? AND NOT EXISTS (SELECT 1 FROM voucher_void WHERE voucher_id=voucher.id)').get(date) as { n: number }).n > 0,
      extra: options.extraTodos,
    },
    activity: listActivity(db, date),
  }
}
