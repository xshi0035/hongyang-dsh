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

/** Keys the workbench panel renders. */
export type WorkbenchKey =
  | 'editAllocation' | 'allocationTotal' | 'allocationSplitTotal' | 'allocationReason' | 'periodStart' | 'periodEnd' | 'removeSplit' | 'addSplit' | 'approveAllocation' | 'reversalTitle' | 'reversalHelp' | 'reversalEmpty' | 'reversed' | 'reversalDraftBlocked' | 'reversePayment' | 'reversalSelected' | 'reversalDate' | 'reversalReason' | 'confirmReversal' | 'cancelReversal' | 'actionReversePayment'
  | 'voucherWithdraw' | 'voucherWithdrawReason' | 'actionWithdrawVoucher'
  | 'voucherQueue' | 'voucherAllocated' | 'voucherDrafted' | 'voucherPending' | 'voucherUnclaimed' | 'voucherHelp' | 'voucherResult' | 'voucherMatched' | 'voucherDiffs' | 'voucherDownload' | 'voucherSelect' | 'voucherBuildSelected' | 'actionCorrectAllocation'
  | 'reviews' | 'reviewsHelp' | 'reviewsEmpty' | 'approve' | 'reject' | 'reviewBusy' | 'reviewFailed'
  | 'reviewApproved' | 'reviewRejected' | 'submittedAt' | 'paymentDate' | 'evidence' | 'transactionNo'
  | 'actionSubmitPayment' | 'actionApprovePayment' | 'actionRejectPayment'
  | 'title' | 'nav' | 'refresh' | 'loading' | 'loadFailed' | 'prevDay' | 'nextDay' | 'dateLabel' | 'yuan'
  | 'tileRegistrations' | 'tilePendingClaims' | 'tileOverdue' | 'tileDocuments' | 'tileDocumentsSub' | 'tileTodos'
  | 'todos' | 'todosClear' | 'todoPendingClaims' | 'todoUnlabelledPos' | 'todoOverdue' | 'todoReport' | 'todoVoucher'
  | 'actRunClaims' | 'actListOverdue' | 'actBuildReport' | 'actBuildVoucher'
  | 'noticeSent' | 'noticeNoSession' | 'noticeFailed'
  | 'registrations' | 'registrationsEmpty' | 'receipts' | 'receiptCountUnit' | 'activity' | 'activityEmpty'
  | 'colTime' | 'colSource' | 'colMerchant' | 'colFee' | 'colAmount' | 'colStatus' | 'colActor' | 'colAction' | 'colDetail'
  | 'statusBooked' | 'statusPending' | 'statusReversal'
  | 'actorWeb' | 'actorDingtalk' | 'actorTool' | 'actorImport' | 'actorEngine'
  | 'actionRegister' | 'actionConfirmPayment' | 'actionConfirmClaim' | 'actionRunClaims' | 'actionLearnPayer'
  | 'actionBuildReport' | 'actionBuildVoucher' | 'actionImport' | 'actionOther'
  | 'footer' | 'loadedAt'

/** Dictionary namespace of the workbench panel. */
export const WORKBENCH_NS = 'hyFinance.workbench'

/**
 * Chinese workbench copy.
 */
export const workbenchZh: Record<WorkbenchKey, string> = {
  editAllocation: '核对费项并入账',
  allocationTotal: '原付款金额',
  allocationSplitTotal: '分配合计',
  allocationReason: '分配依据',
  periodStart: '账期开始（可选）',
  periodEnd: '账期结束（可选）',
  removeSplit: '移除费项',
  addSplit: '增加费项',
  approveAllocation: '按以上分配确认入账',
  reversalTitle: '钉钉登记冲正',
  reversalHelp: '按上方付款日期列出。冲正保留原单，在指定日期生成等额负数记录；仅撤销本系统登记，不退款。已有凭证草稿须先撤回。',
  reversalEmpty: '该付款日期没有已入账的钉钉登记。',
  reversed: '已冲正',
  reversalDraftBlocked: '请先撤回凭证草稿',
  reversePayment: '冲正登记',
  reversalSelected: '即将冲正',
  reversalDate: '冲正日期',
  reversalReason: '冲正原因',
  confirmReversal: '确认冲正并保留原单',
  cancelReversal: '取消',
  actionReversePayment: '付款登记冲正',

  voucherWithdraw: '撤回草稿', voucherWithdrawReason: '撤回原因', actionWithdrawVoucher: '撤回凭证草稿',
  voucherQueue: '待制证清单',
  voucherAllocated: '全日已认领金额',
  voucherDrafted: '已生成草稿',
  voucherPending: '待制证',
  voucherUnclaimed: '尚未认领（笔／元）',
  voucherHelp: '仅已认领收款可选择；金额单位元。草稿不代表过账。',
  voucherResult: '草稿行数',
  voucherMatched: '客户基准匹配行数',
  voucherDiffs: '差异行数',
  voucherDownload: '下载凭证草稿',
  voucherSelect: '选择收款',
  voucherBuildSelected: '为所选收款生成草稿',
  actionCorrectAllocation: '人工更正分配',

  reviews: '钉钉待审核', reviewsHelp: '以下付款尚未入账。核对商户、金额和付款信息后确认入账；待审核单不受上方日期筛选影响。',
  reviewsEmpty: '暂无待审核付款。', approve: '确认入账', reject: '驳回', reviewBusy: '处理中…', reviewFailed: '审核未完成：',
  reviewApproved: '已确认入账。', reviewRejected: '已驳回，未入账。', submittedAt: '提交时间', paymentDate: '付款时间',
  evidence: '查看提交信息', transactionNo: '交易单号', actionSubmitPayment: '提交待审核', actionApprovePayment: '工作台确认入账', actionRejectPayment: '工作台驳回',

  title: '财务工作台',
  nav: '财务工作台',
  refresh: '刷新',
  loading: '加载中…',
  loadFailed: '加载失败：',
  prevDay: '前一天',
  nextDay: '后一天',
  dateLabel: '日期',
  yuan: '元',
  tileRegistrations: '今日登记',
  tilePendingClaims: '待认领',
  tileOverdue: '逾期商户',
  tileDocuments: '日报 / 凭证',
  tileDocumentsSub: '当日是否已生成',
  tileTodos: '待办项',
  todos: '待办',
  todosClear: '今天没有待办。',
  todoPendingClaims: '笔收款待认领，合计',
  todoUnlabelledPos: '笔 POS 订单缺商户标签',
  todoOverdue: '户商户逾期 30 天以上，欠费',
  todoReport: '当日收入日报表尚未生成',
  todoVoucher: '当日凭证草稿尚未生成',
  actRunClaims: '跑一遍认领',
  actListOverdue: '列出逾期',
  actBuildReport: '生成日报',
  actBuildVoucher: '生成凭证',
  noticeSent: '已发给当前会话的助手，切回对话查看进展。',
  noticeNoSession: '当前没有选中的会话，请先新建或打开一个对话。',
  noticeFailed: '发送失败，请稍后再试。',
  registrations: '今日登记',
  registrationsEmpty: '今天还没有人工或钉钉登记的付款。',
  receipts: '当日入账（按来源）',
  receiptCountUnit: '笔',
  activity: '今日操作记录',
  activityEmpty: '今天还没有记录到操作。',
  colTime: '时间',
  colSource: '来源',
  colMerchant: '商户',
  colFee: '费项',
  colAmount: '金额',
  colStatus: '状态',
  colActor: '操作者',
  colAction: '操作',
  colDetail: '说明',
  statusBooked: '已登记',
  statusReversal: '冲正记录',
  statusPending: '待补充',
  actorWeb: '网页',
  actorDingtalk: '钉钉',
  actorTool: '助手',
  actorImport: '导入',
  actorEngine: '引擎',
  actionRegister: '登记付款',
  actionConfirmPayment: '确认登记',
  actionConfirmClaim: '确认认领',
  actionRunClaims: '自动认领',
  actionLearnPayer: '记住付款人',
  actionBuildReport: '生成日报',
  actionBuildVoucher: '生成凭证',
  actionImport: '导入文件',
  actionOther: '其他',
  footer: '所有金额来自财务数据库；助手不参与计算。',
  loadedAt: '更新于',
}

/**
 * English workbench copy.
 */
export const workbenchEn: Record<WorkbenchKey, string> = {
  editAllocation: 'Review fees and book',
  allocationTotal: 'Original payment',
  allocationSplitTotal: 'Allocated total',
  allocationReason: 'Allocation reason',
  periodStart: 'Period start (optional)',
  periodEnd: 'Period end (optional)',
  removeSplit: 'Remove fee',
  addSplit: 'Add fee',
  approveAllocation: 'Approve this allocation',
  reversalTitle: 'Reverse DingTalk registrations',
  reversalHelp: 'Payments follow the selected payment day. Reversal preserves the original and records an equal negative entry on the chosen date. It reverses this local registration without refunding money. Withdraw an existing voucher draft first.',
  reversalEmpty: 'No booked DingTalk payments on this date.',
  reversed: 'Reversed',
  reversalDraftBlocked: 'Withdraw voucher draft first',
  reversePayment: 'Reverse registration',
  reversalSelected: 'Selected payment',
  reversalDate: 'Reversal date',
  reversalReason: 'Reversal reason',
  confirmReversal: 'Confirm reversal; retain original',
  cancelReversal: 'Cancel',
  actionReversePayment: 'Reverse payment registration',

  voucherWithdraw: 'Withdraw draft', voucherWithdrawReason: 'Reason for withdrawal', actionWithdrawVoucher: 'Withdraw voucher draft',
  voucherQueue: 'Voucher queue',
  voucherAllocated: 'Allocated for the day',
  voucherDrafted: 'Drafted',
  voucherPending: 'Awaiting draft',
  voucherUnclaimed: 'Unclaimed (count / CNY)',
  voucherHelp: 'Select allocated receipts only. Amounts in CNY. Drafts are not posted.',
  voucherResult: 'Draft lines',
  voucherMatched: 'Reference matches',
  voucherDiffs: 'Differences',
  voucherDownload: 'Download draft',
  voucherSelect: 'Select receipt',
  voucherBuildSelected: 'Build selected draft',
  actionCorrectAllocation: 'Correct allocation',

  reviews: 'DingTalk payments awaiting review', reviewsHelp: 'These payments are not booked. Verify the merchant, amount and payment details before approving. Pending reviews appear across all dates.',
  reviewsEmpty: 'No payments awaiting review.', approve: 'Approve and book', reject: 'Reject', reviewBusy: 'Processing…', reviewFailed: 'Review failed:',
  reviewApproved: 'Payment approved and booked.', reviewRejected: 'Payment rejected without booking.', submittedAt: 'Submitted at', paymentDate: 'Payment date',
  evidence: 'View submission details', transactionNo: 'Transaction reference', actionSubmitPayment: 'Submit for review', actionApprovePayment: 'Approve in workbench', actionRejectPayment: 'Reject in workbench',

  title: 'Finance workbench',
  nav: 'Workbench',
  refresh: 'Refresh',
  loading: 'Loading…',
  loadFailed: 'Load failed:',
  prevDay: 'Previous day',
  nextDay: 'Next day',
  dateLabel: 'Date',
  yuan: 'CNY',
  tileRegistrations: 'Registered today',
  tilePendingClaims: 'Pending claims',
  tileOverdue: 'Overdue merchants',
  tileDocuments: 'Report / voucher',
  tileDocumentsSub: 'Built for the day',
  tileTodos: 'Open to-dos',
  todos: 'To-dos',
  todosClear: 'Nothing to do today.',
  todoPendingClaims: 'receipts wait for a claim, total',
  todoUnlabelledPos: 'POS orders lack a merchant label',
  todoOverdue: 'merchants overdue by 30+ days, owing',
  todoReport: 'The daily income report is not built yet',
  todoVoucher: 'The voucher draft is not built yet',
  actRunClaims: 'Run claims',
  actListOverdue: 'List overdue',
  actBuildReport: 'Build report',
  actBuildVoucher: 'Build voucher',
  noticeSent: 'Sent to the assistant of the current session; switch back to the conversation to follow it.',
  noticeNoSession: 'No session is selected; create or open a conversation first.',
  noticeFailed: 'Sending failed; try again later.',
  registrations: 'Registered today',
  registrationsEmpty: 'No payment was registered by a person or DingTalk today.',
  receipts: 'Booked today by source',
  receiptCountUnit: 'receipts',
  activity: 'Today\'s activity',
  activityEmpty: 'No operation recorded today.',
  colTime: 'Time',
  colSource: 'Source',
  colMerchant: 'Merchant',
  colFee: 'Fee',
  colAmount: 'Amount',
  colStatus: 'Status',
  colActor: 'Actor',
  colAction: 'Action',
  colDetail: 'Detail',
  statusBooked: 'Booked',
  statusReversal: 'Reversal entry',
  statusPending: 'Incomplete',
  actorWeb: 'Web',
  actorDingtalk: 'DingTalk',
  actorTool: 'Assistant',
  actorImport: 'Import',
  actorEngine: 'Engine',
  actionRegister: 'Register payment',
  actionConfirmPayment: 'Confirm registration',
  actionConfirmClaim: 'Confirm claim',
  actionRunClaims: 'Run claims',
  actionLearnPayer: 'Learn payer',
  actionBuildReport: 'Build report',
  actionBuildVoucher: 'Build voucher',
  actionImport: 'Import file',
  actionOther: 'Other',
  footer: 'Every amount comes from the finance database; the assistant does no arithmetic.',
  loadedAt: 'updated',
}
