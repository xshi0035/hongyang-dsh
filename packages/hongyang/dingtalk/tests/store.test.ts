import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { openDingtalkStateStore } from '../src/store.ts'

await test('deliveries, drafts, and cards persist across reopening the same file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hy-dingtalk-'))
  const path = join(dir, 'nested', 'dingtalk.db')
  try {
    const first = await openDingtalkStateStore(path)
    assert.equal(first.claimDelivery('msg:1', 1000), true)
    assert.equal(first.claimDelivery('msg:1', 1000), false)
    first.putDraft('k', { id: 'd1', conversationId: 'c', userId: 'u', text: '电费 200', expires: 5000 })
    first.putCard({ outTrackId: 'card1', draftKey: 'k', draftId: 'd1', userId: 'u', status: 'open', result: undefined, transactionId: undefined, createdAt: 1000 })
    first.close()

    const second = await openDingtalkStateStore(path)
    assert.equal(second.claimDelivery('msg:1', 2000), false)
    assert.equal(second.getDraft('k', 2000)?.text, '电费 200')
    assert.equal(second.countDrafts(2000), 1)
    assert.equal(second.getDraft('k', 5000), undefined, 'expired drafts vanish')
    assert.equal(second.countDrafts(5000), 0)
    assert.equal(second.claimCard('card1'), true)
    assert.equal(second.claimCard('card1'), false, 'a claimed card cannot be claimed again')
    assert.equal(second.getCard('card1')?.status, 'confirming')
    second.settleCard('card1', 'open')
    assert.equal(second.getCard('card1')?.status, 'open')
    second.settleDraftCards('d1', 'confirmed', '已登记', 'txn_1')
    assert.deepEqual([second.getCard('card1')?.status, second.getCard('card1')?.result, second.getCard('card1')?.transactionId], ['confirmed', '已登记', 'txn_1'])
    second.settleDraftCards('d1', 'cancelled', '不应覆盖已确认的卡片')
    assert.equal(second.getCard('card1')?.status, 'confirmed')
    second.close()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

await test('old deliveries are forgotten after the retention window', async () => {
  const store = await openDingtalkStateStore(':memory:')
  try {
    const week = 7 * 24 * 60 * 60 * 1000
    assert.equal(store.claimDelivery('a', 0), true)
    assert.equal(store.claimDelivery('a', week - 1), false)
    assert.equal(store.claimDelivery('a', week + 1), true)
  } finally { store.close() }
})

await test('version 1 text drafts migrate and image evidence survives a real reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hy-dingtalk-migrate-'))
  const path = join(dir, 'dingtalk.db')
  try {
    const old = new DatabaseSync(path)
    old.exec(`PRAGMA application_id = 1213809739; PRAGMA user_version = 1;
      CREATE TABLE draft (key TEXT PRIMARY KEY,id TEXT NOT NULL,conversation_id TEXT NOT NULL,user_id TEXT NOT NULL,text TEXT NOT NULL,expires INTEGER NOT NULL);
      INSERT INTO draft VALUES ('k','d','c','u','电费',5000);`)
    old.close()
    const migrated = await openDingtalkStateStore(path)
    const draft = migrated.getDraft('k', 1000)!
    assert.equal(draft.text, '电费')
    const image = { amountText: '200元', payee: '测试公司', paymentDate: '2026-04-03' }
    migrated.putDraft('k', { ...draft, image })
    migrated.setRevision('k', 'delivery')
    migrated.close()
    const reopened = await openDingtalkStateStore(path)
    try {
      assert.deepEqual(reopened.getDraft('k', 1000)?.image, image)
      assert.equal(reopened.getRevision('k'), 'delivery')
    } finally { reopened.close() }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

await test('reopening recovers an interrupted claim while preserving submitted outcomes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hy-dingtalk-recover-'))
  const path = join(dir, 'dingtalk.db')
  try {
    const first = await openDingtalkStateStore(path)
    first.putCard({ outTrackId: 'interrupted', draftKey: 'k', draftId: 'd', userId: 'u', status: 'open', result: undefined, transactionId: undefined, createdAt: 1000 })
    first.putCard({ outTrackId: 'settled', draftKey: 'k2', draftId: 'd2', userId: 'u', status: 'open', result: undefined, transactionId: undefined, createdAt: 1000 })
    first.claimCard('interrupted')
    first.settleDraftCards('d2', 'submitted', '已提交工作台审核，尚未入账')
    first.close()
    const reopened = await openDingtalkStateStore(path)
    try {
      assert.equal(reopened.claimCard('interrupted'), true)
      assert.equal(reopened.claimCard('settled'), false)
      assert.equal(reopened.getCard('settled')?.status, 'submitted')
      reopened.settleDraftCards('d2', 'cancelled', 'must not overwrite')
      assert.equal(reopened.getCard('settled')?.result, '已提交工作台审核，尚未入账')
    } finally { reopened.close() }
  } finally { await rm(dir, { recursive: true, force: true }) }
})
