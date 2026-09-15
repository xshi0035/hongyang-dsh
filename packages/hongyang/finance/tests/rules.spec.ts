/**
 * Pure-function coverage of the money-adjacent rule tables. Nothing here
 * touches a database or a sample file, so it runs anywhere (CI included) and
 * is meant to reach 100% coverage of `rules/*` — this is the layer that
 * `AGENTS.md`'s "model doesn't touch money" line is actually verified by.
 * @module @deepseek-ai/dsh-hy-finance/tests/rules
 */

import { describe, expect, it } from 'vitest'
import { ALLOCATION_PRIORITY, FEE_RULES, FEE_TYPES, feeTypesFromText } from '../src/rules/fee-types.ts'
import { feeSummary, periodText, suspenseSummary } from '../src/rules/summary.ts'
import { formatCents, splitTax, taxOf, toCents, toYuan } from '../src/rules/tax.ts'

describe('toCents', () => {
  it.each([
    [29650.92, 2965092],
    [200, 20000],
    [0, 0],
    [-3911.04, -391104],
  ])('parses the number %d to %d cents', (value, cents) => {
    expect(toCents(value)).toBe(cents)
  })

  it.each([
    ['29,650.92', 2965092],
    ['¥200.0', 20000],
    ['￥200', 20000],
    ['200元', 20000],
    ['-3911.04', -391104],
    [' 100.50 ', 10050],
  ])('parses the sheet/chat text %j to %d cents', (value, cents) => {
    expect(toCents(value)).toBe(cents)
  })

  it.each([
    ['', 'empty string'],
    ['abc', 'non-numeric text'],
    ['12.34.56', 'malformed number'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [null, 'null'],
    [undefined, 'undefined'],
    [{}, 'an object'],
  ])('returns undefined for %j (%s), never a guessed amount', (value, _label) => {
    expect(toCents(value)).toBeUndefined()
  })
})

describe('formatCents / toYuan', () => {
  it.each([
    [2965092, '29650.92'],
    [-391104, '-3911.04'],
    [5, '0.05'],
    [100, '1.00'],
    [0, '0.00'],
  ])('formats %d cents as %j', (cents, text) => {
    expect(formatCents(cents)).toBe(text)
  })

  it.each([
    [2965092, 29650.92],
    [-391104, -3911.04],
    [0, 0],
  ])('converts %d cents to %d yuan', (cents, yuan) => {
    expect(toYuan(cents)).toBe(yuan)
  })
})

describe('taxOf', () => {
  it('is zero for a non-taxable fee regardless of amount', () => {
    expect(taxOf(0, 0)).toBe(0)
    expect(taxOf(20062_56, 0)).toBe(0)
  })

  // Amounts chosen so `inclusive / (1 + rate)` divides exactly — the rounding
  // in `taxOf` cannot hide an off-by-one behind floating-point noise here.
  it.each([
    [1_060_000, 0.06, 60_000],
    [1_090_000, 0.09, 90_000],
    [1_130_000, 0.13, 130_000],
    [1_030_000, 0.03, 30_000],
  ])('splits %d cents at rate %d into %d cents of VAT', (inclusive, rate, tax) => {
    expect(taxOf(inclusive, rate as 0.03 | 0.06 | 0.09 | 0.13)).toBe(tax)
  })
})

describe('splitTax', () => {
  // Property: for every fee type the client can receive, net + tax must equal
  // the inclusive amount received — a lost fen here is a lost fen on the
  // ledger. This is the invariant the tax.ts module header promises.
  const sampleAmounts = [0, 1, 100, 999, 20_062_56, 55_743_60, 987_654_321]

  it.each(FEE_TYPES)('never loses a fen splitting %s at any sampled amount', (feeType) => {
    for (const inclusive of sampleAmounts) {
      const split = splitTax(feeType, inclusive)
      expect(split.net + split.tax).toBe(inclusive)
      expect(Number.isInteger(split.tax)).toBe(true)
      expect(Number.isInteger(split.net)).toBe(true)
      expect(split.rate).toBe(FEE_RULES[feeType].taxRate)
      expect(split.tax).toBeGreaterThanOrEqual(0)
      // A 1-fen receipt legitimately rounds to 0 tax even at a nonzero rate —
      // only assert "some tax" where the amount is large enough that it can't.
      if (split.rate === 0) expect(split.tax).toBe(0)
      else if (inclusive >= 100) expect(split.tax).toBeGreaterThan(0)
    }
  })
})

describe('feeTypesFromText', () => {
  it('extracts fee type and amount pairs from the client\'s own dictation example', () => {
    // spec.md §3 hy-claim: "阿妹泡菜电费1000元，水费200"→两行
    expect(feeTypesFromText('阿妹泡菜电费1000元，水费200')).toEqual(['elec_post', 'water_post'])
  })

  it('prefers the longer, more specific alias over a shorter one it contains', () => {
    expect(feeTypesFromText('本月预付电费到账')).toEqual(['elec_pre'])
    expect(feeTypesFromText('收到后付电费')).toEqual(['elec_post'])
    // Bare "电费" (without 前/后缀) falls back to the generic alias.
    expect(feeTypesFromText('电费到账')).toEqual(['elec_post'])
  })

  it('returns each matched fee type once, in order of first appearance', () => {
    expect(feeTypesFromText('租金和物业费都收到了，另外还有租金尾款')).toEqual(['rent', 'service'])
  })

  it('returns an empty list when nothing in the text names a fee', () => {
    expect(feeTypesFromText('')).toEqual([])
    expect(feeTypesFromText('张先涛')).toEqual([])
  })
})

describe('FEE_TYPES / FEE_RULES', () => {
  // spec.md §3 says the report has "22" amount columns, but its own
  // enumeration right under that sentence lists only 21 — and 9 fixed + 21
  // fee + 4 trailing columns is exactly the 34 total everyone agrees on
  // (CLAUDE.md, HANDOFF.md), so "22" is most likely a miscount in that one
  // sentence, not a missing column here. Still unconfirmed against the real
  // 收入日报表格式.xlsx header row — see HANDOFF.md known issue #17.
  it('currently defines 21 fee types, consistent with the 34-column report total', () => {
    expect(FEE_TYPES.length).toBe(21)
  })

  it('gives every fee type a rule with a valid tax rate', () => {
    for (const type of FEE_TYPES) {
      expect(FEE_RULES[type]).toBeDefined()
      expect([0, 0.03, 0.06, 0.09, 0.13]).toContain(FEE_RULES[type].taxRate)
      expect(FEE_RULES[type].label.length).toBeGreaterThan(0)
    }
  })

  it('flags which ledger accounts are still unconfirmed with the client', () => {
    const unconfirmed = FEE_TYPES.filter(t => FEE_RULES[t].subject === null)
    // Regression pin: an account being confirmed should shrink this list, not
    // grow it silently. See HANDOFF.md §5 — the voucher step must show these
    // as TBD, never emit a line for them. water_post/elec_post/elec_pre moved
    // out of this list on the `dev` baseline (2203.31/2203.30 confirmed).
    expect(unconfirmed).toEqual([
      'multi_warehouse', 'multi_ad', 'fixed_spot', 'temp_spot',
      'parking', 'decor_deposit', 'fire_water', 'other', 'coupon',
    ])
  })
})

describe('ALLOCATION_PRIORITY', () => {
  it('applies an unlabelled payment to rent, then service, promo, electricity, water — as spec.md §3 states', () => {
    expect(ALLOCATION_PRIORITY).toEqual(['rent', 'service', 'promo', 'elec_post', 'water_post'])
  })
})

describe('summary templates', () => {
  it('renders a fee summary exactly as the client\'s vouchers write it', () => {
    expect(feeSummary({
      feeType: 'rent', periodStart: '2026-04-01', periodEnd: '2026-04-30', shopNo: '5F-5008', merchantName: '邓家顺',
    })).toBe('收到商户租金2026.4.1-2026.4.30-5F-5008&邓家顺')
  })

  it('collapses a period-less fee (deposits) to an empty period, not "undefined"', () => {
    expect(feeSummary({ feeType: 'guarantee', shopNo: '5002A', merchantName: '炊牛大烩' }))
      .toBe('收到商户保证金-5002A&炊牛大烩')
  })

  it('renders the suspense-receipt summary', () => {
    expect(suspenseSummary('张先涛')).toBe('收到暂收款项-张先涛')
  })

  it('formats a period as dotted dates, or empty when either end is missing', () => {
    expect(periodText('2026-04-01', '2026-04-30')).toBe('2026.4.1-2026.4.30')
    expect(periodText(undefined, '2026-04-30')).toBe('')
    expect(periodText('2026-04-01', undefined)).toBe('')
  })
})
