/**
 * Tool views for the `finance_*` calls. A settled `finance_claim` result
 * renders the pending-claims card and a settled `finance_daily_report` result
 * renders the report card, both from the persisted result metadata so replay
 * and live streaming show the same thing. A running call, an error, or a
 * result without card metadata shows a compact status row.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { DailyReportCard, type ReportCardFace } from './DailyReportCard.tsx'
import { PendingClaimsCard, type ClaimsCardFace } from './PendingClaimsCard.tsx'
import type { ClaimMetaWire, ReportMetaWire } from '../shared/wire.ts'
import css from './PendingClaimsCard.module.css'

function isClaimMeta(value: unknown): value is ClaimMetaWire {
  return typeof value === 'object' && value !== null && (value as { card?: unknown }).card === 'hy-finance/claims'
    && Array.isArray((value as { pending?: unknown }).pending)
}

function isReportMeta(value: unknown): value is ReportMetaWire {
  return typeof value === 'object' && value !== null && (value as { card?: unknown }).card === 'hy-finance/report'
}

function StatusRow(props: { title: string; detail: string }) {
  return (
    <section className={css.card}>
      <div className={css.header}>
        <span className={css.title}>{props.title}</span>
        <span className={css.subtitle}>{props.detail}</span>
      </div>
    </section>
  )
}

/** Props of the `finance_claim` view. */
export type ClaimToolViewProps = PropsRuntime<'tool.call.toolview'> & PropsLocale<'hyFinance.claims'> & InjectFace<ClaimsCardFace>

/**
 * Render a `finance_claim` call.
 * @param props - tool block, session identity, locale copy, Host calls.
 * @returns the card or a status row.
 */
export function ClaimToolView(props: ClaimToolViewProps) {
  const { block, t } = props
  if (!('kind' in block)) return <StatusRow title={t('title')} detail={t('running')} />
  if (block.isError) return <StatusRow title={t('title')} detail={t('failed')} />
  if (!isClaimMeta(block.meta)) return <StatusRow title={t('title')} detail={t('done')} />
  return (
    <PendingClaimsCard
      meta={block.meta}
      seq={block.seq}
      sessionId={String(props.sessionId)}
      t={t}
      loadMerchants={props.loadMerchants}
      confirm={props.confirm}
      autoOpen={props.autoOpen}
    />
  )
}

/** Props of the `finance_daily_report` view. */
export type ReportToolViewProps = PropsRuntime<'tool.call.toolview'> & PropsLocale<'hyFinance.report'> & InjectFace<ReportCardFace>

/**
 * Render a `finance_daily_report` call.
 * @param props - tool block, locale copy.
 * @returns the card or a status row.
 */
export function ReportToolView(props: ReportToolViewProps) {
  const { block, t } = props
  if (!('kind' in block)) return <StatusRow title={t('titleShort')} detail={t('running')} />
  if (block.isError) return <StatusRow title={t('titleShort')} detail={t('failed')} />
  if (!isReportMeta(block.meta)) return <StatusRow title={t('titleShort')} detail={t('done')} />
  return <DailyReportCard meta={block.meta} t={t} autoOpen={props.autoOpen} />
}
