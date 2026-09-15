/**
 * The finance workbench: one day's registrations, what still needs a
 * person, and the audit trail, with quick actions that hand a request to
 * the current session's agent. Every figure is the Host's; the panel only
 * renders.
 */

import { PaymentAllocationEditor, PaymentReversals } from './PaymentActions.tsx'
import { VoucherSelection } from './VoucherSelection.tsx'
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChecklistOutline14, IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { WorkbenchWire } from '../shared/wire.ts'
import type { WorkbenchFace } from './workbench.ts'
import type { WorkbenchKey } from './locales.ts'
import css from './WorkbenchPanel.module.css'

/** Props the renderer binds for the panel. */
export type WorkbenchPanelProps = PropsRuntime<'main'> & PropsLocale<'hyFinance.workbench'> & InjectFace<WorkbenchFace>

type Translate = (key: WorkbenchKey) => string

/** Join the truthy class names. */
function clsx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

function clock(iso: string): string {
  if (!iso.includes('T')) return iso
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' })
}

const ACTOR_KEY: Record<WorkbenchWire['activity'][number]['actorKind'], WorkbenchKey> = {
  web: 'actorWeb', dingtalk: 'actorDingtalk', tool: 'actorTool', import: 'actorImport', engine: 'actorEngine',
}

const ACTION_KEY: Record<string, WorkbenchKey> = {
  reverse_payment: 'actionReversePayment', withdraw_voucher: 'actionWithdrawVoucher', correct_allocation: 'actionCorrectAllocation', submit_payment: 'actionSubmitPayment', approve_payment: 'actionApprovePayment', reject_payment: 'actionRejectPayment',
  register_payment: 'actionRegister', confirm_payment: 'actionConfirmPayment', confirm_claim: 'actionConfirmClaim',
  run_claims: 'actionRunClaims', learn_payer: 'actionLearnPayer', build_report: 'actionBuildReport',
  build_voucher: 'actionBuildVoucher', import_file: 'actionImport',
}

function Tile(props: { label: string; value: string; sub?: string | undefined; tone?: 'warn' | 'ok' | undefined }) {
  return (
    <div className={clsx(css.tile, props.tone === 'warn' && css.tileWarn, props.tone === 'ok' && css.tileOk)}>
      <div className={css.tileLabel}>{props.label}</div>
      <div className={css.tileValue}>{props.value}</div>
      {props.sub === undefined ? null : <div className={css.tileSub}>{props.sub}</div>}
    </div>
  )
}

function Todos(props: { t: Translate; data: WorkbenchWire; ask: WorkbenchFace['ask'] }) {
  const { t, data, ask } = props
  const todos = data.todos
  const rows: { key: string; text: string; count: number; action?: () => void; actionLabel?: string }[] = [
    { key: 'claims', text: `${t('todoPendingClaims')} ${t('yuan')} ${todos.pendingClaimsAmount}`, count: todos.pendingClaims, action: () => { ask('runClaims') }, actionLabel: t('actRunClaims') },
    { key: 'pos', text: t('todoUnlabelledPos'), count: todos.unlabelledPos },
    { key: 'overdue', text: `${t('todoOverdue')} ${t('yuan')} ${todos.overdueAmount}`, count: todos.overdueMerchants, action: () => { ask('listOverdue') }, actionLabel: t('actListOverdue') },
    { key: 'report', text: t('todoReport'), count: todos.reportBuilt ? 0 : 1, action: () => { ask('buildReport') }, actionLabel: t('actBuildReport') },
    { key: 'voucher', text: t('todoVoucher'), count: todos.voucherBuilt ? 0 : 1, action: () => { ask('buildVoucher') }, actionLabel: t('actBuildVoucher') },
    ...todos.extra.map(item => ({ key: item.id, text: item.label, count: item.count })),
  ]
  const open = rows.filter(row => row.count > 0)
  return (
    <section className={css.section}>
      <h2 className={css.sectionTitle}>{t('todos')} <span className={css.count}>{String(open.length)}</span></h2>
      {open.length === 0 ? <p className={css.empty}>{t('todosClear')}</p> : (
        <ul className={css.todoList}>
          {open.map(row => (
            <li key={row.key} className={css.todo}>
              <span className={css.todoBadge}>{String(row.count)}</span>
              <span className={css.todoText}>{row.text}</span>
              {row.action === undefined ? null : <Button size="sm" onClick={row.action}>{row.actionLabel}</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Reviews(props: { refresh: () => void; t: Translate; data: WorkbenchWire; review: WorkbenchFace['review']; reviewing: string | undefined }) {
  const { t, data, review, reviewing } = props
  return (
    <section className={css.section}>
      <h2 className={css.sectionTitle}>{t('reviews')} <span className={css.count}>{String(data.pendingReviews.length)}</span></h2>
      <p className={css.empty}>{t('reviewsHelp')}</p>
      {data.pendingReviews.length === 0 ? <p className={css.empty}>{t('reviewsEmpty')}</p> : (
        <ul className={css.reviewList}>
          {data.pendingReviews.map(row => (
            <li key={row.id} className={css.reviewItem}>
              <div className={css.reviewContent}>
                <strong>{row.shopNo} {row.merchantName}</strong>
                <p>{row.summary}</p>
                {row.duplicateMessage === undefined ? null : <p className={css.noticeWarn}>{row.duplicateMessage}</p>}
                <div className={css.reviewMeta}>{t('submittedAt')} {new Date(row.submittedAt).toLocaleString()} · {t('paymentDate')} {row.paymentDate}</div>
                <details><summary>{t('evidence')}</summary><p className={css.evidence}>{row.text}</p>
                  {row.transactionNo === '' ? null : <p>{t('transactionNo')} {row.transactionNo}</p>}
                </details>
                <PaymentAllocationEditor id={row.id} t={t} refresh={props.refresh}
                  disabled={reviewing !== undefined || row.duplicateMessage !== undefined} />
              </div>
              <div className={css.reviewActions}>
                <Button size="sm" disabled={reviewing !== undefined} onClick={() => { review(row.id, 'reject') }}>{t('reject')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Registrations(props: { t: Translate; data: WorkbenchWire }) {
  const { t, data } = props
  return (
    <section className={css.section}>
      <h2 className={css.sectionTitle}>
        {t('registrations')} <span className={css.count}>{String(data.registrationTotal.count)}</span>
        <span className={css.sectionMeta}>{t('yuan')} {data.registrationTotal.amount}</span>
      </h2>
      {data.registrations.length === 0 ? <p className={css.empty}>{t('registrationsEmpty')}</p> : (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>{t('colTime')}</th><th>{t('colSource')}</th><th>{t('colMerchant')}</th><th>{t('colFee')}</th>
                <th className={css.num}>{t('colAmount')}</th><th>{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {data.registrations.map(row => (
                <tr key={row.transactionId}>
                  <td className={css.mono}>{clock(row.at)}</td>
                  <td>{row.source}</td>
                  <td>{row.shopNo === '' ? row.merchantName : `${row.shopNo} ${row.merchantName}`}</td>
                  <td>{row.fee}</td>
                  <td className={clsx(css.num, css.mono)}>{row.amount}</td>
                  <td>
                    <span className={clsx(css.status, row.status === 'pending' ? css.statusPending : css.statusBooked)}>
                      {row.status === 'pending' ? t('statusPending') : row.status === 'reversed' ? t('reversed')
                        : row.status === 'reversal' ? t('statusReversal') : t('statusBooked')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Receipts(props: { t: Translate; data: WorkbenchWire }) {
  const { t, data } = props
  if (data.receipts.length === 0) return null
  return (
    <section className={css.section}>
      <h2 className={css.sectionTitle}>{t('receipts')}</h2>
      <ul className={css.receiptList}>
        {data.receipts.map(row => (
          <li key={row.source} className={css.receipt}>
            <span>{row.source}</span>
            <span className={css.receiptCount}>{String(row.count)} {t('receiptCountUnit')}</span>
            <span className={clsx(css.num, css.mono)}>{row.amount}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Activity(props: { t: Translate; data: WorkbenchWire }) {
  const { t, data } = props
  return (
    <section className={css.section}>
      <h2 className={css.sectionTitle}>{t('activity')} <span className={css.count}>{String(data.activity.length)}</span></h2>
      {data.activity.length === 0 ? <p className={css.empty}>{t('activityEmpty')}</p> : (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr><th>{t('colTime')}</th><th>{t('colActor')}</th><th>{t('colAction')}</th><th>{t('colDetail')}</th><th className={css.num}>{t('colAmount')}</th></tr>
            </thead>
            <tbody>
              {data.activity.map(row => (
                <tr key={row.id}>
                  <td className={css.mono}>{clock(row.at)}</td>
                  <td>{t(ACTOR_KEY[row.actorKind])}{row.actor === '' ? '' : ` ${row.actor.slice(0, 12)}`}</td>
                  <td>{t(ACTION_KEY[row.action] ?? 'actionOther')}</td>
                  <td className={css.detail}>{row.detail}</td>
                  <td className={clsx(css.num, css.mono)}>{row.amount ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * Render the workbench panel.
 * @param props - locale copy, the panel snapshot, and its actions.
 */
export function WorkbenchPanel(props: WorkbenchPanelProps) {
  const { t } = props
  const state = props.useWorkbench(s => s)
  useEffect(() => {
    props.refresh()
    const refresh = () => { props.refresh() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [])
  const data = state.data
  const todosOpen = data === undefined ? 0 : [
    data.pendingReviews.length, data.todos.pendingClaims, data.todos.unlabelledPos, data.todos.overdueMerchants,
    data.todos.reportBuilt ? 0 : 1, data.todos.voucherBuilt ? 0 : 1, ...data.todos.extra.map(item => item.count),
  ].filter(count => count > 0).length
  return (
    <div className={css.panel} data-dsh-plugin="hy-finance" data-dsh-part="workbench">
      <header className={css.header}>
        <span className={css.headerIcon}><IconChecklistOutline14 size={16} /></span>
        <h1 className={css.title}>{t('title')}</h1>
        <span className={css.spacer} />
        <div className={css.dateNav}>
          <Button size="sm" onClick={() => { props.shiftDate(-1) }}>{t('prevDay')}</Button>
          <input
            className={css.dateInput}
            type="date"
            value={state.date}
            aria-label={t('dateLabel')}
            onChange={(event) => { if (event.currentTarget.value !== '') props.setDate(event.currentTarget.value) }}
          />
          <Button size="sm" onClick={() => { props.shiftDate(1) }}>{t('nextDay')}</Button>
        </div>
        <Button size="sm" disabled={state.loading} onClick={() => { props.refresh() }}>
          <IconRefreshOutline14 size={14} /> {state.loading ? t('loading') : t('refresh')}
        </Button>
      </header>
      {state.notice === undefined ? null : (
        <p className={clsx(css.notice, state.notice !== 'sent' && css.noticeWarn)}>
          {state.notice === 'sent' ? t('noticeSent') : state.notice === 'noSession' ? t('noticeNoSession') : t('noticeFailed')}
        </p>
      )}
      {state.reviewError === undefined ? null : <p role="alert" className={clsx(css.notice, css.noticeWarn)}>{t('reviewFailed')} {state.reviewError}</p>}
      {state.reviewNotice === undefined ? null : <p role="status" className={css.notice}>{t(state.reviewNotice === 'approved' ? 'reviewApproved' : 'reviewRejected')}</p>}
      {state.error === undefined ? null : <p className={clsx(css.notice, css.noticeWarn)}>{t('loadFailed')} {state.error}</p>}
      {data === undefined ? (state.loading ? <p className={css.empty}>{t('loading')}</p> : null) : (
        <div className={css.body}>
          <div className={css.tiles}>
            <Tile label={t('tileRegistrations')} value={String(data.registrationTotal.count)} sub={`${t('yuan')} ${data.registrationTotal.amount}`} />
            <Tile label={t('tilePendingClaims')} value={String(data.todos.pendingClaims)} sub={`${t('yuan')} ${data.todos.pendingClaimsAmount}`} tone={data.todos.pendingClaims > 0 ? 'warn' : 'ok'} />
            <Tile label={t('tileOverdue')} value={String(data.todos.overdueMerchants)} sub={`${t('yuan')} ${data.todos.overdueAmount}`} tone={data.todos.overdueMerchants > 0 ? 'warn' : 'ok'} />
            <Tile label={t('tileDocuments')} value={`${data.todos.reportBuilt ? '✓' : '—'} / ${data.todos.voucherBuilt ? '✓' : '—'}`} sub={t('tileDocumentsSub')} tone={data.todos.reportBuilt && data.todos.voucherBuilt ? 'ok' : undefined} />
            <Tile label={t('tileTodos')} value={String(todosOpen)} tone={todosOpen > 0 ? 'warn' : 'ok'} />
          </div>
          <Reviews refresh={props.refresh} t={t} data={data} review={props.review} reviewing={state.reviewing} />
          <div className={css.columns}>
            <div className={css.column}>
              <Todos t={t} data={data} ask={props.ask} />
              <Receipts t={t} data={data} />
            </div>
            <div className={css.column}>
              <Registrations t={t} data={data} />
            </div>
          </div>
          <VoucherSelection key={state.date} date={state.date} queue={data.voucherQueue} t={t} refresh={props.refresh} />
          <PaymentReversals key={state.date} date={state.date} t={t} revision={state.loadedAt} refresh={props.refresh} />
          <Activity t={t} data={data} />
          <p className={css.footer}>{t('footer')}{state.loadedAt === undefined ? '' : ` · ${t('loadedAt')} ${clock(state.loadedAt)}`}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Sidebar entry icon for the workbench panel.
 * @param props - icon size and whether the panel is active.
 */
export function WorkbenchIcon(props: PropsRuntime<'sidebar.panellist'>) {
  return <span className={clsx(css.navIcon, props.active && css.navIconActive)}><IconChecklistOutline14 size={props.size} /></span>
}
