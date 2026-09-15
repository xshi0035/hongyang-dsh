import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { dayBounds, listActivity, localDay, recordActivity } from '../src/provider/activity/log.ts'
import { confirmPayment } from '../src/provider/register/conversation.ts'
import { workbenchSummary } from '../src/provider/query/workbench.ts'
import { toWorkbenchWire } from '../src/webServer/workbench-wire.ts'

await test('local days roll over at Shanghai midnight, not UTC', () => {
  assert.equal(localDay(new Date('2026-09-15T15:59:59Z')), '2026-09-15')
  assert.equal(localDay(new Date('2026-09-15T16:00:00Z')), '2026-09-16')
  assert.deepEqual(dayBounds('2026-09-16'), { start: '2026-09-15T16:00:00.000Z', end: '2026-09-16T16:00:00.000Z' })
})

await test('activity rows are keyed by local day and listed newest first', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    recordActivity(db, { actor: { kind: 'dingtalk', id: 'u1' }, action: 'confirm_payment', target: 'txn_1', amount: 20000, detail: '登记', at: new Date('2026-09-15T01:00:00Z') })
    recordActivity(db, { actor: { kind: 'web', id: 's1' }, action: 'build_report', target: '2026-09-15', detail: '日报', at: new Date('2026-09-15T02:00:00Z') })
    recordActivity(db, { actor: { kind: 'tool', id: '' }, action: 'run_claims', detail: '昨天', at: new Date('2026-09-14T15:00:00Z') })
    const today = listActivity(db, '2026-09-15')
    assert.deepEqual(today.map(entry => [entry.action, entry.actor.kind, entry.amount]), [['build_report', 'web', undefined], ['confirm_payment', 'dingtalk', 20000]])
    assert.equal(listActivity(db, '2026-09-14').length, 1)
  } finally { db.close() }
})

await test('the workbench summary counts today\'s registrations, to-dos, and document status', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    db.exec(`INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','3F-3032','周军伟','作业帮');
      INSERT INTO receivable (id,merchant_id,fee_type,period,due_date,amount_due,amount_relief) VALUES ('r','m','rent','2026-04','2026-04-30',10000,0);
      INSERT INTO "transaction" (id,source,channel,txn_time,amount,payer_name,status) VALUES ('bank1','bank2038','transfer','2026-09-15',5000,'无名','pending');
      INSERT INTO "transaction" (id,source,channel,txn_time,amount,status,raw) VALUES ('dt-pending','dingtalk','transfer','2026-09-15',30000,'pending','水费 300元');`)
    const result = confirmPayment(db, '电费 200\n作业帮', '3F-3032')
    assert.equal(result.booked, true)
    const summary = workbenchSummary(db, localDay(), { overdueDays: 30, extraTodos: [{ id: 'dingtalk-drafts', label: '钉钉待确认草稿', count: 2 }] })
    assert.equal(summary.registrations.length, 2)
    assert.deepEqual(summary.registrations.map(row => [row.origin, row.cents, row.shopNo]), [['dingtalk', 20000, '3F-3032'], ['pending', 30000, '']])
    assert.deepEqual(summary.registrationTotal, { count: 2, cents: 50000 })
    assert.equal(summary.todos.pendingClaims, 2, 'the bank credit and the unfinished DingTalk report both wait for a person')
    assert.equal(summary.todos.pendingClaimsCents, 35000)
    assert.equal(summary.todos.overdueMerchants, 1)
    assert.equal(summary.todos.overdueCents, 10000)
    assert.equal(summary.todos.reportBuilt, false)
    assert.equal(summary.todos.extra[0]?.count, 2)
    db.exec(`INSERT INTO daily_report (id,date,built_at,rows_json) VALUES ('rpt','${localDay()}','now','[]')`)
    assert.equal(workbenchSummary(db, localDay(), { overdueDays: 30, extraTodos: [] }).todos.reportBuilt, true)
    const yesterday = workbenchSummary(db, '2000-01-01', { overdueDays: 30, extraTodos: [] })
    assert.equal(yesterday.registrations.length, 0)
    const wire = toWorkbenchWire(summary)
    assert.equal(wire.registrationTotal.amount, '500.00')
    assert.equal(wire.registrations[0]?.amount, '200.00')
    assert.equal(wire.todos.overdueAmount, '100.00')
  } finally { db.close() }
})
