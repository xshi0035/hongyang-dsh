import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { toYuan } from '../../rules/tax.ts'
import type { VoucherBuild } from './build.ts'

/**
 * Export a voucher with all three monetary columns expressed in yuan.
 * @param voucher - provider-calculated voucher, with amounts in cents.
 * @param dir - output directory, created when absent.
 * @returns the exported workbook path.
 */
export async function exportVoucher(voucher: VoucherBuild, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, `凭证_${voucher.date}.xlsx`)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('凭证', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.addRow([
    '日期', '会计年度', '期间', '凭证字', '凭证号', '摘要', '科目编码', '科目全名', '币别', '原币金额',
    '借方金额', '贷方金额', '制单', '审核', '过账', '出纳', '附件数', '来源系统', '业务类型', '审核状态', '作废状态',
  ])
  for (const line of voucher.lines) {
    ws.addRow([
      line.date, line.date.slice(0, 4), Number(line.date.slice(5, 7)), '记', line.voucherNo,
      line.summary, line.subject, line.subjectName, '人民币', toYuan(line.debit || line.credit),
      toYuan(line.debit), toYuan(line.credit), '', '', '', '', 0, '弘阳财务', '收款', line.warning ? '草稿' : '', '',
    ])
  }
  ws.getRow(1).font = { bold: true }
  for (let column = 1; column <= 21; column++) ws.getColumn(column).width = 14
  ws.getColumn(6).width = 55
  ws.getColumn(8).width = 48
  for (const column of [10, 11, 12]) ws.getColumn(column).numFmt = '#,##0.00'
  await wb.xlsx.writeFile(file)
  return file
}
