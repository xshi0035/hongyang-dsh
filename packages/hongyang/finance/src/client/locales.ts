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
  outputTax13Hint: '电费；客户尚未确认，留空时含电费的凭证只生成草稿',
  outputTax3: '3% 销项税科目',
  outputTax3Hint: '水费；客户尚未确认，留空时含水费的凭证只生成草稿',
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
  outputTax13Hint: 'Electricity; unconfirmed by the client, vouchers with electricity stay drafts while blank',
  outputTax3: '3% output-VAT account',
  outputTax3Hint: 'Water; unconfirmed by the client, vouchers with water stay drafts while blank',
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
  | 'confirm' | 'confirming' | 'suspense' | 'learned' | 'unlabelledPos' | 'hint' | 'noSession'
  | 'colDate' | 'colSource' | 'colPayer' | 'colAmount' | 'colRemark' | 'colSuggestion' | 'colShop'

/** Dictionary namespace of the claims card. */
export const CLAIMS_NS = 'hyFinance.claims'

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
  colDate: '日期',
  colSource: '来源',
  colPayer: '付款人',
  colAmount: '金额',
  colRemark: '备注',
  colSuggestion: '建议',
  colShop: '铺位',
}

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
  colDate: 'Date',
  colSource: 'Source',
  colPayer: 'Payer',
  colAmount: 'Amount',
  colRemark: 'Remark',
  colSuggestion: 'Suggestion',
  colShop: 'Shop',
}
