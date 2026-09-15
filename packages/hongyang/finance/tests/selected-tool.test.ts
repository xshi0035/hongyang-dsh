import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { allocate } from '../src/provider/claim/allocate.ts'
import { voucherQueue } from '../src/provider/voucher/queue.ts'
import { financeVoucherTool } from '../src/tools/definitions/voucher.ts'
import type { HyFinanceService } from '../src/service/finance-service.ts'
import type { MerchantId, TransactionId } from '../src/service/identifiers.ts'

await test('voucher tool presents pending receipt keys and refuses an implicit full-day selection', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    db.exec(`INSERT INTO merchant(id,shop_no,name) VALUES('m','101','验收商户');
      INSERT INTO "transaction"(id,source,channel,txn_time,amount,status) VALUES('t','bank2038','transfer','2026-04-03',10900,'manual');`)
    allocate(db, { transactionId: 't' as TransactionId, merchantId: 'm' as MerchantId, amount: 10900,
      origin: 'user', splits: [{ feeType: 'rent', amount: 10900 }] })
    const service = { voucherQueue: (date: string) => voucherQueue(db, date) } as unknown as HyFinanceService
    const tool = financeVoucherTool(service)
    if (tool.execute === undefined) throw new Error('voucher tool has no executor')
    const execute = tool.execute.bind(tool)
    const exec = {} as Parameters<typeof execute>[1]
    const result = await execute({ action: 'list', date: '2026-04-03' }, exec) as { summary: string }
    assert.equal(result.summary + '\n', await readFile(new URL('./expected/voucher-queue.txt', import.meta.url), 'utf8'))
    await assert.rejects(async () => execute({ action: 'build', date: '2026-04-03' }, exec), /由用户选择/)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM voucher').get()?.n, 0)
  } finally { db.close() }
})
