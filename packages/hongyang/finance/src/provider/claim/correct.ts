/** Explicit, audited replacement of a receipt's allocations before voucher drafting. */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '../db/repo.ts'
import { allocate, describeAllocations, type Split } from './allocate.ts'
import { recordActivity } from '../activity/log.ts'
import { FEE_TYPES } from '../../rules/fee-types.ts'
import type { ActivityActor, Allocation } from '../../service/types.ts'
import type { MerchantId, PlatformTxnId, TransactionId } from '../../service/identifiers.ts'

/** Human-supplied correction, including the version of allocations actually reviewed. */
export interface AllocationCorrection {
  requestId: string
  itemId: string
  shopNo: string
  splits: readonly Split[]
  expectedAllocationIds: readonly string[]
  reason: string
}

/** Replace only the reviewed receipt, retaining before/after evidence; identical requests are idempotent.
 * @param db - Database holding the receipt.
 * @param input - Explicit splits and supporting reason.
 * @param actor - Person authorizing the correction.
 * @returns New allocations, or the saved result of an identical request.
 */
export function correctAllocation(db: DatabaseSync, input: AllocationCorrection, actor: ActivityActor): Allocation[] {
  if (!input.requestId.trim() || !input.reason.trim()) throw new Error('更正必须提供请求编号和确认依据')
  if (input.splits.length === 0 || input.splits.some(split => !FEE_TYPES.includes(split.feeType) || !Number.isSafeInteger(split.amount) || split.amount <= 0)) throw new Error('拆分费项必须有效且金额为正整数分')
  return transaction(db, () => {
    const request = JSON.stringify(input)
    const prior = db.prepare('SELECT request_json,after_json FROM allocation_revision WHERE request_id=?').get(input.requestId) as { request_json: string; after_json: string } | undefined
    if (prior !== undefined) {
      if (prior.request_json !== request) throw new Error('该更正请求已使用，不能更改内容')
      return (JSON.parse(prior.after_json) as Allocation[]).map(row => ({ ...row,
        platformTxnId: row.platformTxnId, merchantId: row.merchantId, receivableId: row.receivableId,
        periodStart: row.periodStart, periodEnd: row.periodEnd,
      }))
    }
    const match = /^(txn|ptx):(.+)$/u.exec(input.itemId)
    if (match === null) throw new Error('收款编号必须是 txn: 或 ptx:')
    const platform = match[1] === 'ptx'
    const id = match[2] ?? ''
    const receipt = platform
      ? db.prepare('SELECT transaction_id AS txn, amount FROM platform_txn WHERE id=? AND transaction_id IS NOT NULL').get(id) as { txn: string; amount: number } | undefined
      : db.prepare('SELECT id AS txn,amount FROM "transaction" WHERE id=? AND status IN (\'auto\',\'manual\') AND channel NOT IN (\'tenpay\',\'unionpay\')').get(id) as { txn: string; amount: number } | undefined
    if (receipt === undefined) throw new Error('收款不存在、尚未认领或属于汇总结算，不能更正')
    if (db.prepare('SELECT 1 FROM payment_reversal WHERE original_id=? OR reversal_id=?').get(receipt.txn, receipt.txn) !== undefined) {
      throw new Error('该付款已有关联冲正，不能直接更改原分配')
    }
    if (input.splits.reduce((sum, split) => sum + split.amount, 0) !== receipt.amount) throw new Error('拆分合计与原收款不一致')
    const before = platform ? db.prepare('SELECT * FROM allocation WHERE platform_txn_id=? ORDER BY id').all(id)
      : db.prepare('SELECT * FROM allocation WHERE transaction_id=? AND platform_txn_id IS NULL ORDER BY id').all(id)
    const actualIds = before.map(row => String(row.id)).sort()
    if (actualIds.length === 0 || JSON.stringify(actualIds) !== JSON.stringify([...input.expectedAllocationIds].sort())) throw new Error('分配已变化，请重新核对后更正')
    const keys = before.map(row => `${platform ? id : receipt.txn}|${String(row.merchant_id ?? '')}`)
    // Daily parking grouping also reserves all child allocations through its null-merchant group.
    const parked = platform ? db.prepare('SELECT merchant_account,txn_time FROM platform_txn WHERE id=?').get(id) as { merchant_account: string; txn_time: string } : undefined
    if (parked?.merchant_account === '1723333380') keys.push(`wechat380:${parked.txn_time.slice(0, 10)}|`)
    if (keys.some(key => db.prepare('SELECT 1 FROM voucher_receipt WHERE receipt_id=?').get(key) !== undefined)) throw new Error('该收款已有凭证草稿，需要先复核草稿，不能直接更正')
    const merchant = input.shopNo === '' ? undefined : db.prepare('SELECT id FROM merchant WHERE shop_no=?').get(input.shopNo) as { id: string } | undefined
    if (input.shopNo !== '' && merchant === undefined) throw new Error('找不到指定铺位')
    if (platform) db.prepare('DELETE FROM allocation WHERE platform_txn_id=?').run(id)
    else db.prepare('DELETE FROM allocation WHERE transaction_id=? AND platform_txn_id IS NULL').run(id)
    const after = allocate(db, { transactionId: receipt.txn as TransactionId, platformTxnId: platform ? id as PlatformTxnId : undefined,
      merchantId: merchant?.id as MerchantId | undefined, amount: receipt.amount, splits: input.splits, origin: 'user' })
    if (platform) db.prepare('UPDATE platform_txn SET merchant_id=? WHERE id=?').run(merchant?.id ?? null, id)
    else db.prepare('UPDATE "transaction" SET merchant_id=?,status=\'manual\' WHERE id=?').run(merchant?.id ?? null, id)
    db.prepare('INSERT INTO allocation_revision(request_id,item_id,request_json,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(input.requestId, input.itemId, request, JSON.stringify(before), JSON.stringify(after), new Date().toISOString())
    recordActivity(db, { actor, action: 'correct_allocation', target: input.itemId, amount: receipt.amount,
      detail: `${input.reason}；更正分配：${describeAllocations(after)}；修改前后证据 ${input.requestId}` })
    return after
  })
}
