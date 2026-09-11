/**
 * Fee-type vocabulary of the client's daily income report. The 22 amount
 * columns of `收入日报表格式.xlsx` (row 3, columns J..AE) define both the order
 * and the Chinese labels; tax rates and prepaid-revenue ledger accounts come
 * from the client's Kingdee vouchers. Codes marked `null` are still
 * unconfirmed with the client and must be supplied through configuration
 * before a voucher line for that fee can be generated.
 * @module @deepseek-ai/dsh-hy-finance/rules/fee-types
 */

/** Stable machine names of the 22 report columns, in column order. */
export const FEE_TYPES = [
  'rent', 'service', 'promo', 'multi_warehouse', 'multi_ad', 'fixed_spot', 'temp_spot',
  'water_post', 'elec_post', 'elec_pre', 'decor_mgmt', 'garbage', 'cert', 'parking',
  'earnest', 'decor_deposit', 'guarantee', 'unclaimed', 'fire_water', 'other', 'coupon',
] as const

/** One of {@link FEE_TYPES}. */
export type FeeType = typeof FEE_TYPES[number]

/** VAT rate applied to a fee; `0` marks a non-taxable receipt (deposits, suspense). */
export type TaxRate = 0 | 0.03 | 0.06 | 0.09 | 0.13

/** Static description of one fee column. */
export interface FeeRule {
  /** Column header exactly as the client's report prints it. */
  readonly label: string
  /** VAT rate embedded in the received amount. */
  readonly taxRate: TaxRate
  /** Prepaid-revenue (or deposit) ledger account credited when the fee is received; `null` until the client confirms. */
  readonly subject: string | null
  /** Ledger account name shown in the voucher's `科目全名` column when known. */
  readonly subjectName: string | null
}

/** The rule table, keyed by fee type. Column order follows {@link FEE_TYPES}. */
export const FEE_RULES: Readonly<Record<FeeType, FeeRule>> = {
  rent: { label: '租金', taxRate: 0.09, subject: '2203.01.01', subjectName: '预收账款_预收账款_商户_预收租金' },
  service: { label: '经营服务费', taxRate: 0.06, subject: '2203.01.02', subjectName: '预收账款_预收账款_商户_预收经营服务费' },
  promo: { label: '宣传服务费-推广', taxRate: 0.06, subject: '2203.01.03', subjectName: '预收账款_预收账款_商户_预收推广费' },
  multi_warehouse: { label: '多经收入-仓库', taxRate: 0.06, subject: null, subjectName: null },
  multi_ad: { label: '多经收入-广告位', taxRate: 0.06, subject: null, subjectName: null },
  fixed_spot: { label: '固定点位-服务费收入', taxRate: 0.06, subject: null, subjectName: null },
  temp_spot: { label: '临时点位收入-服务费收入', taxRate: 0.06, subject: null, subjectName: null },
  water_post: { label: '后付水费', taxRate: 0.03, subject: null, subjectName: null },
  elec_post: { label: '后付电费', taxRate: 0.13, subject: null, subjectName: null },
  elec_pre: { label: '预付电费', taxRate: 0.13, subject: null, subjectName: null },
  decor_mgmt: { label: '装修管理费', taxRate: 0.06, subject: '2203.06', subjectName: '预收账款_装修管理费' },
  garbage: { label: '垃圾清运费', taxRate: 0.06, subject: '2203.11', subjectName: '预收账款_垃圾清运费' },
  cert: { label: '证件工本费', taxRate: 0.06, subject: '2203.05', subjectName: '预收账款_证件工本费' },
  parking: { label: '停车费', taxRate: 0.06, subject: null, subjectName: null },
  earnest: { label: '诚意金', taxRate: 0, subject: '2241.02', subjectName: '其他应付款_诚意金' },
  decor_deposit: { label: '装修押金', taxRate: 0, subject: null, subjectName: null },
  guarantee: { label: '保证金', taxRate: 0, subject: '2241.05', subjectName: '其他应付款_保证金' },
  unclaimed: { label: '暂收款', taxRate: 0, subject: '2203.01.05', subjectName: '预收账款_预收账款_商户_预收账款_暂收款' },
  fire_water: { label: '消防泄水费', taxRate: 0.06, subject: null, subjectName: null },
  other: { label: '其他', taxRate: 0.06, subject: null, subjectName: null },
  coupon: { label: '购券', taxRate: 0, subject: null, subjectName: null },
}

/** Output-VAT ledger accounts confirmed from the client's vouchers, keyed by rate. */
export const OUTPUT_TAX_SUBJECTS: Readonly<Partial<Record<TaxRate, string>>> = {
  0.06: '2221.01.02.06',
  0.09: '2221.01.02.09',
}

/** Chinese label → fee type, for parsing the client's spreadsheets and free text. */
export const FEE_TYPE_BY_LABEL: ReadonlyMap<string, FeeType> = new Map(
  FEE_TYPES.map(type => [FEE_RULES[type].label, type]),
)

/**
 * Aliases the client's staff use in bank remarks, receivable sheets, and chat.
 * Longer aliases are matched first by {@link feeTypeFromText}.
 */
export const FEE_TYPE_ALIASES: ReadonlyArray<readonly [string, FeeType]> = [
  ['经营服务费', 'service'], ['服务费', 'service'], ['物业费', 'service'],
  ['宣传服务费', 'promo'], ['推广费', 'promo'], ['推广', 'promo'],
  ['后付电费', 'elec_post'], ['预付电费', 'elec_pre'], ['电费', 'elec_post'],
  ['后付水费', 'water_post'], ['水费', 'water_post'],
  ['装修管理费', 'decor_mgmt'], ['垃圾清运费', 'garbage'], ['垃圾费', 'garbage'],
  ['证件工本费', 'cert'], ['工本费', 'cert'],
  ['装修押金', 'decor_deposit'], ['保证金', 'guarantee'], ['押金', 'guarantee'],
  ['诚意金', 'earnest'], ['暂收款', 'unclaimed'],
  ['停车费', 'parking'], ['消防泄水费', 'fire_water'], ['购券', 'coupon'],
  ['多经收入-仓库', 'multi_warehouse'], ['仓库', 'multi_warehouse'],
  ['多经收入-广告位', 'multi_ad'], ['广告位', 'multi_ad'],
  ['固定点位', 'fixed_spot'], ['临时点位', 'temp_spot'], ['场地费', 'temp_spot'],
  // The receivable sheet's bare `多经收入` (gift machines, spot rentals) is booked under 固定点位-服务费收入 in the ledger.
  ['多经收入', 'fixed_spot'],
  ['房租', 'rent'], ['租费', 'rent'], ['铺租', 'rent'], ['租金', 'rent'],
]

/**
 * Find every fee type mentioned in free text, longest alias first, each at
 * most once, in order of first appearance.
 * @param text - a bank remark, chat message, or spreadsheet cell.
 * @returns the fee types found; empty when none matched.
 */
export function feeTypesFromText(text: string): FeeType[] {
  const hits: { index: number; type: FeeType }[] = []
  const sorted = [...FEE_TYPE_ALIASES].sort((a, b) => b[0].length - a[0].length)
  let scan = text
  for (const [alias, type] of sorted) {
    const index = scan.indexOf(alias)
    if (index < 0 || hits.some(h => h.type === type)) continue
    hits.push({ index, type })
    scan = scan.slice(0, index) + ' '.repeat(alias.length) + scan.slice(index + alias.length)
  }
  return hits.sort((a, b) => a.index - b.index).map(h => h.type)
}

/**
 * Order in which an unspecified payment is applied to a merchant's unpaid
 * receivables: rent first, then service, promotion, electricity, water.
 */
export const ALLOCATION_PRIORITY: readonly FeeType[] = ['rent', 'service', 'promo', 'elec_post', 'water_post']
