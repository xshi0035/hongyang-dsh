/** Human selection of allocated receipts, with durable draft and full-day coverage. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { HY_FINANCE_API, type WorkbenchWire } from '../shared/wire.ts'
import type { WorkbenchKey } from './locales.ts'
import css from './WorkbenchPanel.module.css'

/** Render the selected day's draft queue.
 * @param props - Provider coverage, locale and refresh action.
 * @returns Receipt selection and document links.
 */
export function VoucherSelection(props: { date: string; queue: WorkbenchWire['voucherQueue']; t: (key: WorkbenchKey) => string; refresh: () => void }) {
  const { queue, t } = props
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<{ id: string; lines: number; matched: number; diffs: number }>()
  async function build(): Promise<void> {
    setBusy(true); setError(undefined); setResult(undefined)
    try {
      const response = await fetch(`${HY_FINANCE_API}/voucher/draft`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: props.date, receiptIds: selected }) })
      const body = await response.json() as {
        ok: boolean
        message?: string
        voucher: { id: string; lines: unknown[] }
        compare: { matched: number; diffs: unknown[] }
      }
      if (!response.ok || !body.ok) throw new Error(body.message ?? String(response.status))
      setResult({ id: body.voucher.id, lines: body.voucher.lines.length, matched: body.compare.matched, diffs: body.compare.diffs.length })
      setSelected([]); props.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function withdraw(id: string): Promise<void> {
    setBusy(true); setError(undefined)
    try {
      const response = await fetch(`${HY_FINANCE_API}/voucher/withdraw`, { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, reason }) })
      const body = await response.json() as { ok: boolean; message?: string }
      if (!response.ok || !body.ok) throw new Error(body.message ?? String(response.status))
      setResult(undefined); setReason(''); props.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <section className={css.section}>
    <h2 className={css.sectionTitle}>{t('voucherQueue')} <span className={css.count}>{queue.pendingCount}</span></h2>
    <p>{t('voucherAllocated')} {queue.allocatedAmount} · {t('voucherDrafted')} {queue.draftedCount} / {queue.draftedAmount} · {t('voucherPending')} {queue.pendingCount} / {queue.pendingAmount}</p>
    <p className={css.empty}>{t('voucherUnclaimed')} {queue.unclaimedCount} / {queue.unclaimedAmount} · {t('voucherHelp')}</p>
    {error === undefined ? null : <p role="alert" className={css.noticeWarn}>{error}</p>}
    {result === undefined ? null : <p role="status">{t('voucherResult')} {result.lines} · {t('voucherMatched')} {result.matched} · {t('voucherDiffs')} {result.diffs} · <a href={`${HY_FINANCE_API}/voucher/file?id=${encodeURIComponent(result.id)}`}>{t('voucherDownload')}</a></p>}
    <div className={css.tableWrap}><table className={css.table}>
      <thead><tr><th>{t('voucherSelect')}</th><th>{t('colMerchant')}</th><th>{t('colSource')}</th><th>{t('colFee')}</th><th>{t('colAmount')}</th><th>{t('colStatus')}</th></tr></thead>
      <tbody>{queue.receipts.map(row => <tr key={row.receiptId}>
        <td><input type="checkbox" aria-label={`${t('voucherSelect')} ${row.shopNo} ${row.merchantName} ${row.amount}`} disabled={busy || row.voucherId !== undefined} checked={selected.includes(row.receiptId)} onChange={(event) => { setSelected(event.currentTarget.checked ? [...selected, row.receiptId] : selected.filter(id => id !== row.receiptId)) }} /></td>
        <td>{row.shopNo} {row.merchantName}<div className={css.empty}>{row.remark}</div></td>
        <td>{row.source}</td><td>{row.fees}</td><td className={css.num}>{row.amount}</td>
        <td>{row.voucherId === undefined ? t('voucherPending') : <><a href={`${HY_FINANCE_API}/voucher/file?id=${encodeURIComponent(row.voucherId)}`}>{t('voucherDrafted')}</a><Button size="sm" disabled={busy || !reason.trim()} onClick={() => { if (row.voucherId !== undefined) void withdraw(row.voucherId) }}>{t('voucherWithdraw')}</Button></>}</td>
      </tr>)}</tbody>
    </table></div>
    {queue.draftedCount === 0 ? null : <label>{t('voucherWithdrawReason')}<input aria-label={t('voucherWithdrawReason')} value={reason} onChange={(event) => { setReason(event.currentTarget.value) }} /></label>}
    <Button disabled={busy || selected.length === 0} onClick={() => { void build() }}>{busy ? t('reviewBusy') : t('voucherBuildSelected')}</Button>
  </section>
}
