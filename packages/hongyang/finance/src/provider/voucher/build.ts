/* oxlint-disable */
import type { DatabaseSync } from 'node:sqlite'
import { FEE_RULES, type FeeType } from '../../rules/fee-types.ts'
import { taxOf } from '../../rules/tax.ts'
import { newId, type VoucherId } from '../../service/identifiers.ts'
import { buildDailyReport } from '../report/daily-report.ts'

export interface VoucherLine { date:string; voucherNo:number; lineNo:number; summary:string; subject:string; subjectName:string; debit:number; credit:number; warning?:string }
export interface VoucherBuild { id:VoucherId; date:string; lines:VoucherLine[]; checks:{ balanced:boolean; warnings:string[] } }
export function buildVoucher(db: DatabaseSync, date:string, config:{ outputTaxSubject13:string; outputTaxSubject3:string }): VoucherBuild {
  const report = buildDailyReport(db,date); const lines:VoucherLine[]=[]; let n=1
  const add=(subject:string,name:string,debit:number,credit:number,summary:string,warning?:string)=>{ const l:VoucherLine={ date,voucherNo:1,lineNo:n++,summary,subject,subjectName:name,debit,credit }; if(warning) l.warning=warning; lines.push(l) }
  // Cash is determined from the settlement transaction, not the report display
  // source: WeChat orders are child rows of a bank 2038 settlement.
  const cash = db.prepare(`SELECT CASE WHEN p.platform = 'pos' THEN 'pos' ELSE 'bank' END AS bucket,
      COALESCE(SUM(a.amount_incl_tax), 0) AS cents
    FROM allocation a JOIN "transaction" t ON t.id = a.transaction_id
    LEFT JOIN platform_txn p ON p.id = a.platform_txn_id
    WHERE substr(COALESCE(p.txn_time, t.txn_time), 1, 10) = ?
    GROUP BY bucket`).all(date) as unknown as { bucket: string; cents: number }[]
  const bank = cash.find(x => x.bucket === 'bank')?.cents ?? 0
  const pos = cash.find(x => x.bucket === 'pos')?.cents ?? 0
  if(bank) add('1002.02','银行存款_银行收款',bank,0,`${date} 收款`)
  if(pos) add('1012.08','其他货币资金_POS收款',pos,0,`${date} 收款`)
  for(const r of report.rows) for(const [fee,v] of Object.entries(r.amounts) as [FeeType,number][]) {
    const rule=FEE_RULES[fee]; const summary=`${r.shopNo}${r.merchantName ? `-${r.merchantName}`:''} ${rule.label}`
    if(rule.subject===null){ add('', '',0,v,summary,'待确认预收科目'); continue }
    add(rule.subject,rule.subjectName??'',0,v,summary)
    if(rule.taxRate>0){ const tax=taxOf(v,rule.taxRate); const subj=rule.taxRate===0.13?config.outputTaxSubject13:rule.taxRate===0.03?config.outputTaxSubject3:'2221.01.02.06'; const warn=subj===''?'待确认销项税科目':undefined; add(rule.subject,rule.subjectName??'',tax,0,summary); add(subj,'应交税费_应交增值税_销项税额',0,tax,summary,warn) }
  }
  const debit=lines.reduce((s,l)=>s+l.debit,0), credit=lines.reduce((s,l)=>s+l.credit,0)
  const warnings=lines.flatMap(l=>l.warning?[l.warning]:[]); return { id:newId<VoucherId>('vcr'),date,lines,checks:{ balanced:debit===credit,warnings } }
}
