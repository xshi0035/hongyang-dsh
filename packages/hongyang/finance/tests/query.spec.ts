import { expect, it } from 'vitest'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { merchantBalance, overdue, receivableSummary, todayReceipts } from '../src/provider/query/dashboard.ts'

it('query provider calculates open receivable from provider allocations', async () => {
  const db = await openFinanceDatabase(':memory:')
  try {
    db.exec(`INSERT INTO merchant (id,shop_no,name,brand) VALUES ('m','101','测试商户','测试品牌');
      INSERT INTO receivable (id,merchant_id,fee_type,period,due_date,amount_due,amount_relief) VALUES ('r','m','rent','2026-04','2026-04-30',10000,0);
      INSERT INTO "transaction" (id,source,channel,txn_time,amount,status) VALUES ('t','bank2038','transfer','2026-04-03',4000,'manual');
      INSERT INTO allocation (id,transaction_id,merchant_id,receivable_id,fee_type,amount_incl_tax,tax_rate,tax_amount,origin,created_at)
      VALUES ('a','t','m','r','rent',4000,0.09,330,'user','2026-04-03');`)
    expect(receivableSummary(db).openCents).toBe(6000)
    expect(merchantBalance(db, '测试品牌')[0]?.byFee[0]?.cents).toBe(6000)
    expect(overdue(db, 30, '2026-06-01')[0]?.oldestDueDate).toBe('2026-04-30')
    expect(todayReceipts(db, '2026-04-03')[0]?.cents).toBe(4000)
  } finally { db.close() }
})
