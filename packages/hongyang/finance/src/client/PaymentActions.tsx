/** Human fee allocation and reversal controls; originals remain available for review. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { HY_FINANCE_API } from '../shared/wire.ts'
import { financeDay } from '../shared/day.ts'
import type { ReviewDetailsWire, ReversiblePaymentWire } from '../shared/payment-review.ts'
import type { WorkbenchKey } from './locales.ts'
import css from './WorkbenchPanel.module.css'

type Translate = (key: WorkbenchKey) => string
interface SplitInput { feeType: string; amount: string; start: string; end: string }

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${HY_FINANCE_API}${path}`, body === undefined ? undefined
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json() as T & { message?: string }
  if (!response.ok) throw new Error(value.message ?? String(response.status))
  return value
}

/** Approve original details or explicitly edit a pending submission's split.
 * @param props - Submission identity, locale and refresh callback.
 */
export function PaymentAllocationEditor(props: { id: string; t: Translate; refresh: () => void; approve: () => void; disabled: boolean }) {
  const { t } = props
  const [data, setData] = useState<ReviewDetailsWire>()
  const [splits, setSplits] = useState<SplitInput[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await operation() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const patch = (index: number, change: Partial<SplitInput>) => {
    setSplits(rows => rows.map((row, i) => i === index ? { ...row, ...change } : row))
  }
  const validAmount = splits.every(row => /^\d+(\.\d{1,2})?$/u.test(row.amount) && Number(row.amount) > 0)
  const total = splits.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)
  const valid = data !== undefined && validAmount && total === data.amount && reason.trim() !== ''
  return <div>
    {data === undefined ? <Button size="sm" disabled={busy || props.disabled} onClick={props.approve}>{t('approve')}</Button> : null}
    <Button size="sm" disabled={busy || props.disabled} onClick={() => { void run(async () => {
      if (data !== undefined) { setData(undefined); setSplits([]); setReason(''); return }
      const loaded = await request<ReviewDetailsWire>(`/payment/details?id=${encodeURIComponent(props.id)}`)
      setData(loaded); setSplits(loaded.splits.map(row => ({ feeType: row.feeType, amount: (row.amount / 100).toFixed(2), start: '', end: '' })))
    }) }}>{t(data === undefined ? 'editAllocation' : 'cancelAllocation')}</Button>
    {error === '' ? null : <p role="alert">{error}</p>}
    {data === undefined ? null : <div>
      <p>{t('allocationTotal')} {(data.amount / 100).toFixed(2)} · {t('allocationSplitTotal')} {Number.isFinite(total) ? (total / 100).toFixed(2) : '—'}</p>
      {splits.map((row, index) => <div key={index} className={css.reviewMeta}>
        <label>{t('colFee')} <select aria-label={`${t('colFee')} ${String(index + 1)}`} value={row.feeType} onChange={(e) => { patch(index, { feeType: e.target.value }) }}>
          {data.fees.map(fee => <option key={fee.value} value={fee.value}>{fee.label}</option>)}
        </select></label>
        <label>{t('colAmount')} <input aria-label={`${t('colAmount')} ${String(index + 1)}`} value={row.amount} onChange={(e) => { patch(index, { amount: e.target.value }) }} /></label>
        <label>{t('periodStart')} <input type="date" value={row.start} onChange={(e) => { patch(index, { start: e.target.value }) }} /></label>
        <label>{t('periodEnd')} <input type="date" value={row.end} onChange={(e) => { patch(index, { end: e.target.value }) }} /></label>
        <Button size="sm" disabled={busy || splits.length === 1} onClick={() => { setSplits(rows => rows.filter((_, i) => i !== index)) }}>{t('removeSplit')}</Button>
      </div>)}
      <Button size="sm" disabled={busy} onClick={() => { setSplits(rows => [...rows, { feeType: data.fees[0]?.value ?? '', amount: '', start: '', end: '' }]) }}>{t('addSplit')}</Button>
      <label>{t('allocationReason')} <input aria-label={t('allocationReason')} value={reason} onChange={(e) => { setReason(e.target.value) }} /></label>
      <Button size="sm" disabled={busy || !valid || props.disabled} onClick={() => { void run(async () => {
        await request('/payment/review', { id: props.id, decision: 'approve', review: { reason,
          splits: splits.map(row => ({ feeType: row.feeType, amount: Math.round(Number(row.amount) * 100),
            ...(row.start === '' && row.end === '' ? {} : { periodStart: row.start, periodEnd: row.end }) })) } })
        props.refresh()
      }) }}>{t('approveAllocation')}</Button>
    </div>}
  </div>
}

/** List booked DingTalk payments and expose an explicit, reasoned reversal.
 * @param props - Selected payment day, locale, refresh marker and callback.
 */
export function PaymentReversals(props: { date: string; t: Translate; revision?: string | undefined; refresh: () => void }) {
  const { t } = props
  const [payments, setPayments] = useState<ReversiblePaymentWire[]>([])
  const [selected, setSelected] = useState<ReversiblePaymentWire>()
  const [reason, setReason] = useState('')
  const [day, setDay] = useState(financeDay())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void request<{ payments: ReversiblePaymentWire[] }>(`/payment/reversals?date=${props.date}`).then((value) => {
      if (active) setPayments(value.payments)
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)) })
    return () => { active = false }
  }, [props.date, props.revision])
  return <section className={css.section}>
    <h2 className={css.sectionTitle}>{t('reversalTitle')}</h2>
    <p>{t('reversalHelp')}</p>
    {error === '' ? null : <p role="alert">{error}</p>}
    {payments.length === 0 ? <p>{t('reversalEmpty')}</p> : payments.map(row => <div key={row.transactionId} className={css.reviewItem}>
      <span>{row.shopNo} {row.merchantName} · {(row.amount / 100).toFixed(2)} · {row.date}</span>
      {row.reversed ? <span>{t('reversed')} {row.reversalDate}</span> : <Button size="sm" disabled={row.blocked || busy} onClick={() => {
        setSelected(row); setReason(''); setError('')
      }}>{row.blocked ? t('reversalDraftBlocked') : t('reversePayment')}</Button>}
    </div>)}
    {selected === undefined ? null : <div>
      <p>{t('reversalSelected')} {selected.shopNo} {selected.merchantName} · {(selected.amount / 100).toFixed(2)}</p>
      <label>{t('reversalDate')} <input type="date" value={day} onChange={(e) => { setDay(e.target.value) }} /></label>
      <label>{t('reversalReason')} <input aria-label={t('reversalReason')} value={reason} onChange={(e) => { setReason(e.target.value) }} /></label>
      <Button size="sm" disabled={busy || reason.trim() === '' || day === ''} onClick={() => {
        setBusy(true); setError('')
        void request('/payment/reverse', { transactionId: selected.transactionId, allocationIds: selected.allocationIds, reason, date: day }).then(() => {
          setSelected(undefined); props.refresh()
        }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setBusy(false) })
      }}>{t('confirmReversal')}</Button>
      <Button size="sm" disabled={busy} onClick={() => { setSelected(undefined) }}>{t('cancelReversal')}</Button>
    </div>}
  </section>
}
