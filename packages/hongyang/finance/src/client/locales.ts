/** Dictionaries of the finance settings card; Chinese is the product default. */

/** Keys the card renders. */
export type FinanceSettingsKey =
  | 'title' | 'description' | 'expand' | 'collapse'
  | 'dbPath' | 'dbPathHint'
  | 'autoOpenCards' | 'autoOpenCardsHint'
  | 'compareTolerance' | 'compareToleranceHint'
  | 'outputTax13' | 'outputTax13Hint' | 'outputTax3' | 'outputTax3Hint'
  | 'companyName' | 'companyNameHint'
  | 'unconfirmed' | 'overridden' | 'reset'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber' | 'readOnly'

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.hyFinance'

/**
 * Chinese finance settings copy.
 */
export const zh: Record<FinanceSettingsKey, string> = {
  title: '弘阳财务',
  description: '主数据、流水导入、收款认领、收入日报表、金蝶凭证与欠费查询',
  expand: '展开',
  collapse: '收起',
  dbPath: '数据库文件',
  dbPathHint: '留空使用 $DSH_HOME/hongyang/finance.db；修改后下次启动生效',
  autoOpenCards: '审阅卡片默认展开',
  autoOpenCardsHint: '关闭后待认领、日报表、凭证卡片默认折叠，点击展开',
  compareTolerance: '比对金额容差（分）',
  compareToleranceHint: '与贺部长台账逐行比对时允许的金额差异',
  outputTax13: '13% 销项税科目',
  outputTax13Hint: '电费；客户已确认科目 2221.01.02.13',
  outputTax3: '3% 销项税科目',
  outputTax3Hint: '水费；客户已确认科目 2221.01.02.03',
  companyName: '收款主体',
  companyNameHint: '付款截图上的收款方必须是它',
  unconfirmed: '待确认',
  overridden: '已修改',
  reset: '恢复默认',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '保存失败，请重试',
  invalidNumber: '请输入非负整数',
  readOnly: '当前连接不允许修改设置',
}

/**
 * English finance settings copy.
 */
export const en: Record<FinanceSettingsKey, string> = {
  title: 'Hongyang Finance',
  description: 'Master data, statement import, receipt claiming, daily income report, Kingdee vouchers, arrears queries',
  expand: 'Expand',
  collapse: 'Collapse',
  dbPath: 'Database file',
  dbPathHint: 'Blank uses $DSH_HOME/hongyang/finance.db; takes effect on next start',
  autoOpenCards: 'Open review cards expanded',
  autoOpenCardsHint: 'When off, pending-claim, report, and voucher cards start collapsed',
  compareTolerance: 'Compare tolerance (cents)',
  compareToleranceHint: 'Amount difference allowed when matching rows against the manual ledger',
  outputTax13: '13% output-VAT account',
  outputTax13Hint: 'Electricity; client-confirmed account 2221.01.02.13',
  outputTax3: '3% output-VAT account',
  outputTax3Hint: 'Water; client-confirmed account 2221.01.02.03',
  companyName: 'Receiving entity',
  companyNameHint: 'Payment screenshots must name this payee',
  unconfirmed: 'Unconfirmed',
  overridden: 'Overridden',
  reset: 'Reset',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'Save failed, try again',
  invalidNumber: 'Enter a non-negative integer',
  readOnly: 'This connection cannot change settings',
}

/** Keys of the pending-claims review card. */
export type ClaimsCardKey =
  | 'title' | 'remaining' | 'autoBooked' | 'autoSection' | 'noSuggestion' | 'shopPlaceholder'
  | 'confirm' | 'confirming' | 'suspense' | 'learned' | 'unlabelledPos' | 'hint' | 'noSession' | 'running' | 'done' | 'failed'
  | 'colDate' | 'colSource' | 'colPayer' | 'colAmount' | 'colRemark' | 'colSuggestion' | 'colShop'

/** Dictionary namespace of the claims card. */
export const CLAIMS_NS = 'hyFinance.claims'

/**
 * Chinese pending claims copy.
 */
export const claimsZh: Record<ClaimsCardKey, string> = {
  title: '待认领收款',
  remaining: '剩余 {n} 笔',
  autoBooked: '本轮自动登记 {n} 笔',
  autoSection: '自动登记',
  noSuggestion: '无建议',
  shopPlaceholder: '铺位号',
  confirm: '确认登记',
  confirming: '登记中…',
  suspense: '挂暂收款',
  learned: '已记住付款人',
  unlabelledPos: 'POS 无附言订单 {n} 笔，等运营部上报',
  hint: '点建议直接填入铺位，也可手输；确认后按未收顺序拆分费项，余额挂暂收款',
  noSession: '当前没有会话',
  running: '认领中…',
  done: '已完成',
  failed: '认领失败',
  colDate: '日期',
  colSource: '来源',
  colPayer: '付款人',
  colAmount: '金额',
  colRemark: '备注',
  colSuggestion: '建议',
  colShop: '铺位',
}

/**
 * English pending claims copy.
 */
export const claimsEn: Record<ClaimsCardKey, string> = {
  title: 'Receipts to claim',
  remaining: '{n} left',
  autoBooked: '{n} booked automatically',
  autoSection: 'Booked automatically',
  noSuggestion: 'No suggestion',
  shopPlaceholder: 'Shop no.',
  confirm: 'Confirm',
  confirming: 'Booking…',
  suspense: 'Hold as suspense',
  learned: 'payer remembered',
  unlabelledPos: '{n} POS orders without remark await the operations desk',
  hint: 'Click a suggestion to fill the shop, or type one; confirmation splits fees by unpaid order and holds any remainder as suspense',
  noSession: 'No active session',
  running: 'Claiming…',
  done: 'Done',
  failed: 'Claim failed',
  colDate: 'Date',
  colSource: 'Source',
  colPayer: 'Payer',
  colAmount: 'Amount',
  colRemark: 'Remark',
  colSuggestion: 'Suggestion',
  colShop: 'Shop',
}

/** Keys of the daily-report review card. */
export type ReportCardKey =
  | 'title' | 'rows' | 'total' | 'compareAllMatch' | 'compareBadge' | 'feeSection' | 'compareSection' | 'compareTotals'
  | 'exported' | 'hint' | 'kindMissing' | 'kindExtra' | 'kindAmount' | 'titleShort' | 'running' | 'done' | 'failed'
  | 'colSource' | 'colCount' | 'colAmount' | 'colKind' | 'colShop' | 'colMerchant' | 'colReport' | 'colLedger' | 'colNote'

/** Dictionary namespace of the report card. */
export const REPORT_NS = 'hyFinance.report'

/**
 * Chinese daily report copy.
 */
export const reportZh: Record<ReportCardKey, string> = {
  title: '{date} 收入日报表',
  rows: '{n} 行',
  total: '合计 {amount} 元',
  compareAllMatch: '与台账逐行一致',
  compareBadge: '与台账一致 {matched}/{n}',
  feeSection: '费项合计',
  compareSection: '台账 {ledger} 行：一致 {matched}，台账有生成无 {missing}，生成有台账无 {extra}，金额不同 {amount}',
  compareTotals: '合计 生成 {report} / 台账 {ledger}',
  exported: '已导出 {path}',
  hint: '让助手“用 Univer 打开”即可在会话里预览和修改；数字全部来自认领记录',
  kindMissing: '台账有',
  kindExtra: '生成有',
  kindAmount: '金额不同',
  titleShort: '收入日报表',
  running: '生成中…',
  done: '已完成',
  failed: '生成失败',
  colSource: '来源',
  colCount: '行数',
  colAmount: '金额',
  colKind: '类型',
  colShop: '铺位',
  colMerchant: '商户',
  colReport: '生成',
  colLedger: '台账',
  colNote: '说明',
}

/**
 * English daily report copy.
 */
export const reportEn: Record<ReportCardKey, string> = {
  title: 'Daily income report {date}',
  rows: '{n} rows',
  total: 'Total {amount}',
  compareAllMatch: 'Matches the ledger line by line',
  compareBadge: 'Ledger match {matched}/{n}',
  feeSection: 'Totals by fee',
  compareSection: 'Ledger {ledger} rows: matched {matched}, ledger-only {missing}, report-only {extra}, amount differs {amount}',
  compareTotals: 'Totals report {report} / ledger {ledger}',
  exported: 'Exported to {path}',
  hint: 'Ask the assistant to open it in Univer to preview or edit; every number comes from booked allocations',
  kindMissing: 'Ledger only',
  kindExtra: 'Report only',
  kindAmount: 'Amount differs',
  titleShort: 'Daily income report',
  running: 'Building…',
  done: 'Done',
  failed: 'Build failed',
  colSource: 'Source',
  colCount: 'Rows',
  colAmount: 'Amount',
  colKind: 'Kind',
  colShop: 'Shop',
  colMerchant: 'Merchant',
  colReport: 'Report',
  colLedger: 'Ledger',
  colNote: 'Note',
}
