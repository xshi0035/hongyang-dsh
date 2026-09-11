/**
 * The daily-report review card at the tail of a Turn that built a report:
 * the day's total, rows by source, fee totals, the exported file, and, when
 * the ledger was compared, the match badge and the difference lines.
 */

import { useState } from 'react'
import { IconChevronDownOutline14, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReportCardKey } from './locales.ts'
import type { ReportMetaWire } from '../shared/wire.ts'
import css from './PendingClaimsCard.module.css'

/** What the registration injects. */
export interface ReportCardFace {
  autoOpen: () => boolean
}

/** Props of the card body. */
export interface DailyReportCardProps extends ReportCardFace {
  meta: ReportMetaWire
  t: (key: ReportCardKey) => string
}

function clsx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

/**
 * Render the card.
 * @param props - the report meta selected for this Turn, locale copy.
 * @returns the card.
 */
export function DailyReportCard(props: DailyReportCardProps) {
  const { t, meta } = props
  const [open, setOpen] = useState(() => props.autoOpen())
  const c = meta.compare
  const allGood = c !== undefined && c.missing === 0 && c.extra === 0 && c.amountDiffs === 0
  return (
    <section className={css.card}>
      <button type="button" className={css.header} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <span className={css.title}>{t('title').replace('{date}', meta.date)}</span>
        <Tag tone="outline">{t('rows').replace('{n}', String(meta.rows))}</Tag>
        <span className={css.subtitle}>{t('total').replace('{amount}', meta.grandTotal)}</span>
        {c !== undefined
          ? (
            <Tag tone={allGood ? 'neutral' : 'outline'}>
              {allGood ? t('compareAllMatch') : t('compareBadge').replace('{matched}', String(c.matched)).replace('{n}', String(c.ledgerRows))}
            </Tag>
          )
          : null}
        <span className={css.spacer} />
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open && (
        <div className={css.body}>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr><th>{t('colSource')}</th><th className={css.amount}>{t('colCount')}</th><th className={css.amount}>{t('colAmount')}</th></tr>
              </thead>
              <tbody>
                {meta.bySource.map(s => (
                  <tr key={s.source}>
                    <td>{s.source}</td>
                    <td className={css.amount}>{s.count}</td>
                    <td className={css.amount}>{s.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={css.sectionTitle}>{t('feeSection')}</div>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <tbody>
                {meta.totals.map(x => (
                  <tr key={x.fee}><td>{x.fee}</td><td className={css.amount}>{x.amount}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {c !== undefined && (
            <>
              <div className={css.sectionTitle}>
                {t('compareSection')
                  .replace('{ledger}', String(c.ledgerRows)).replace('{matched}', String(c.matched))
                  .replace('{missing}', String(c.missing)).replace('{extra}', String(c.extra)).replace('{amount}', String(c.amountDiffs))}
                {' · '}
                {t('compareTotals').replace('{report}', c.reportTotal).replace('{ledger}', c.ledgerTotal)}
              </div>
              {c.diffs.length > 0 && (
                <div className={css.tableWrap}>
                  <table className={css.table}>
                    <thead>
                      <tr>
                        <th>{t('colKind')}</th><th>{t('colShop')}</th><th>{t('colMerchant')}</th><th>{t('colSource')}</th>
                        <th className={css.amount}>{t('colReport')}</th><th className={css.amount}>{t('colLedger')}</th><th>{t('colNote')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.diffs.map((d, i) => (
                        <tr key={`${d.shopNo}-${String(i)}`}>
                          <td><Tag tone={d.kind === 'amount' ? 'outline' : 'neutral'}>{t(d.kind === 'missing' ? 'kindMissing' : d.kind === 'extra' ? 'kindExtra' : 'kindAmount')}</Tag></td>
                          <td>{d.shopNo}</td>
                          <td>{d.merchantName}</td>
                          <td className={css.muted}>{d.source}</td>
                          <td className={css.amount}>{d.reportAmount || '—'}</td>
                          <td className={css.amount}>{d.ledgerAmount || '—'}</td>
                          <td className={css.muted}>{d.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <div className={css.footer}>
            {meta.xlsxPath !== undefined ? <span>{t('exported').replace('{path}', meta.xlsxPath)}</span> : null}
            <span>{t('hint')}</span>
          </div>
        </div>
      )}
    </section>
  )
}
