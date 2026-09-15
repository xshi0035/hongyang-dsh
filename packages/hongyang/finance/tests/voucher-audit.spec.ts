import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import { allocate } from '../src/provider/claim/allocate.ts'
import { openFinanceDatabase } from '../src/provider/db/schema.ts'
import { buildDailyReport, compareDailyReport } from '../src/provider/report/daily-report.ts'
import { buildVoucher } from '../src/provider/voucher/build.ts'
import { compareVoucher } from '../src/provider/voucher/compare.ts'
import { exportVoucher } from '../src/provider/voucher/export.ts'
import type { MerchantId, TransactionId } from '../src/service/identifiers.ts'

async function fixture(): Promise<DatabaseSync> {
  const db = await openFinanceDatabase(':memory:')
  db.exec(`INSERT INTO merchant (id, shop_no, name) VALUES ('m', '101', '测试商户');
    INSERT INTO "transaction" (id,source,channel,txn_time,amount,status)
    VALUES ('t','bank2038','transfer','2026-04-03',21500,'auto');
    INSERT INTO import_batch VALUES ('b','ledger','synthetic','synthetic',1,'2026-04-03');`)
  return db
}

describe('voucher build/compare/export', () => {
  let db: DatabaseSync | undefined
  afterEach(() => { db?.close(); db = undefined })

  it('same receipt with rent and service keeps separate VAT accounts and matches all seven reference lines', async () => {
    db = await fixture()
    allocate(db, {
      transactionId: 't' as TransactionId, merchantId: 'm' as MerchantId, amount: 21500, origin: 'user',
      splits: [{ feeType: 'rent', amount: 10900 }, { feeType: 'service', amount: 10600 }],
    })
    const voucher = buildVoucher(db, '2026-04-03', { outputTaxSubject13: '', outputTaxSubject3: '' })
    const expected = [
      ['1002.02', 21500, 0], ['2203.01.01', 0, 10900], ['2203.01.01', 900, 0],
      ['2221.01.02.09', 0, 900], ['2203.01.02', 0, 10600], ['2203.01.02', 600, 0], ['2221.01.02.06', 0, 600],
    ] as const
    expect(voucher.lines.map(l => [l.subject, l.debit, l.credit])).toEqual(expected)
    expect(voucher.checks.balanced).toBe(true)
    for (const [i, [subject, debit, credit]] of expected.entries()) {
      db.prepare(`INSERT INTO voucher_row (id,batch_id,date,voucher_no,line_no,subject,debit,credit)
        VALUES (?, 'b', '2026-04-03', 3, ?, ?, ?, ?)`).run(`v${String(i)}`, i + 1, subject, debit, credit)
    }
    expect(compareVoucher(db, voucher).matched).toBe(7)
    const dir = await mkdtemp(join(tmpdir(), 'hy-voucher-test-'))
    try {
      const file = await exportVoucher(voucher, dir)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(file)
      const sheet = workbook.getWorksheet('凭证')
      expect(sheet?.getCell('J2').value).toBe(215)
      expect(sheet?.getCell('K2').value).toBe(215)
      expect(sheet?.getCell('J3').value).toBe(109)
      expect(sheet?.getCell('L3').value).toBe(109)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('equal subtotal with different fee columns is a difference, not a matched ledger row', async () => {
    db = await fixture()
    allocate(db, {
      transactionId: 't' as TransactionId, merchantId: 'm' as MerchantId, amount: 21500, origin: 'user',
      splits: [{ feeType: 'rent', amount: 21500 }],
    })
    db.prepare(`INSERT INTO ledger_row (id,batch_id,date,shop_no,merchant_name,subtotal,source,amounts)
      VALUES ('l','b','2026-04-03','101','测试商户',21500,'银行转账2038',?)`)
      .run(JSON.stringify({ rent: 10900, service: 10600 }))
    const report = buildDailyReport(db, '2026-04-03')
    const result = compareDailyReport(db, report, 1)
    expect(result.matched).toBe(0)
    expect(result.diffs.map(d => [d.kind, d.note])).toEqual([
      ['amount', '费项金额差异：租金：生成 215.00 / 台账 109.00；经营服务费：生成 0.00 / 台账 106.00'],
    ])
    db.prepare('UPDATE ledger_row SET amounts=?').run(JSON.stringify({ rent: 21500 }))
    expect(compareDailyReport(db, report, 1).matched).toBe(1)
  })

  it('explicit current-period split does not consume an older receivable', async () => {
    db = await fixture()
    db.exec(`INSERT INTO receivable (id,merchant_id,fee_type,period,period_start,period_end,amount_due)
      VALUES ('old','m','rent','2025-01','2025-01-01','2025-01-31',21500),
      ('current','m','rent','2026-04','2026-04-01','2026-04-30',21500);`)
    const rows = allocate(db, {
      transactionId: 't' as TransactionId, merchantId: 'm' as MerchantId, amount: 21500, origin: 'user',
      splits: [{ feeType: 'rent', amount: 21500, periodStart: '2026-04-01', periodEnd: '2026-04-30' }],
    })
    expect(rows[0]?.receivableId).toBe('current')
  })
})
