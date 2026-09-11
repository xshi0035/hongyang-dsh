/**
 * The pending-claims review card at the tail of a Turn whose `finance_claim`
 * result left receipts for a person to decide. Each row shows the receipt,
 * the engine's ranked suggestions (click one to fill the picker), a shop
 * picker with the merchant list, and a confirm button. Confirming posts to
 * the Host route, marks the row done locally, and the Host tells the model
 * what was decided.
 */

import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChevronDownOutline14, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ClaimsTurnData } from './claims-turn-data.ts'
import type { ClaimsCardKey } from './locales.ts'
import type { ConfirmResponseWire, MerchantWire, PendingItemWire, SuggestionWire } from '../shared/wire.ts'
import css from './PendingClaimsCard.module.css'

/** What the registration injects: the current session and the Host calls. */
export interface ClaimsCardFace {
  loadMerchants: () => Promise<MerchantWire[]>
  confirm: (sessionId: string, itemId: string, shopNo: string) => Promise<ConfirmResponseWire>
  autoOpen: () => boolean
}

/** Props the renderer binds. */
export type PendingClaimsCardProps =
  PropsRuntime<'conversation.chat.turnTail'>
  & { matched: ClaimsTurnData }
  & PropsLocale<'hyFinance.claims'>
  & InjectFace<ClaimsCardFace>

function clsx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

interface RowState {
  shopNo: string
  busy: boolean
  done?: { shopNo: string; name: string; booked: string; learned: boolean } | undefined
  error?: string | undefined
}

function confidenceClass(c: number): string {
  return clsx(css.confidence, c >= 0.85 ? css.confidenceHigh : c >= 0.6 ? css.confidenceMid : undefined)
}

interface SuggestionChipsProps {
  suggestions: readonly SuggestionWire[]
  onPick: (shopNo: string) => void
  t: (k: ClaimsCardKey) => string
}

function SuggestionChips(props: SuggestionChipsProps) {
  if (props.suggestions.length === 0) return <span className={css.muted}>{props.t('noSuggestion')}</span>
  return (
    <>
      {props.suggestions.map(s => (
        <button key={s.shopNo} type="button" className={css.suggestion} title={s.reason} onClick={() => { props.onPick(s.shopNo) }}>
          <span>{s.shopNo}</span>
          <span>{s.brand || s.name}</span>
          <span className={confidenceClass(s.confidence)}>{Math.round(s.confidence * 100)}%</span>
        </button>
      ))}
    </>
  )
}

/**
 * Render the card.
 * @param props - the queue selected for this Turn, locale copy, and Host calls.
 * @returns the card.
 */
export function PendingClaimsCard(props: PendingClaimsCardProps) {
  const { t } = props
  const data = props.matched
  const [open, setOpen] = useState(() => props.autoOpen())
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [merchants, setMerchants] = useState<MerchantWire[]>([])
  useEffect(() => {
    let live = true
    if (open && merchants.length === 0) {
      props.loadMerchants().then((list) => { if (live) setMerchants(list) }).catch(() => undefined)
    }
    return () => { live = false }
  }, [open, merchants.length, props])
  const pending: readonly PendingItemWire[] = data.meta.pending
  const remaining = pending.filter(p => rows[p.itemId]?.done === undefined).length
  const listId = useMemo(() => `hy-merchants-${String(data.seq)}`, [data.seq])
  const rowOf = (id: string): RowState => rows[id] ?? { shopNo: pending.find(p => p.itemId === id)?.suggestions[0]?.shopNo ?? '', busy: false }
  const setRow = (id: string, patch: Partial<RowState>): void => {
    setRows(prev => ({ ...prev, [id]: { ...rowOf(id), ...patch } }))
  }
  const confirm = async (item: PendingItemWire): Promise<void> => {
    const sessionId = props.sessionId as string | undefined
    if (sessionId === undefined) { setRow(item.itemId, { error: t('noSession') }); return }
    const state = rowOf(item.itemId)
    setRow(item.itemId, { busy: true, error: undefined })
    const response = await props.confirm(sessionId, item.itemId, state.shopNo.trim()).catch((error: unknown): ConfirmResponseWire => (
      { ok: false, code: 'NETWORK', message: error instanceof Error ? error.message : String(error) }
    ))
    if (response.ok) {
      const { shopNo, name, booked, learned } = response
      setRow(item.itemId, { busy: false, done: { shopNo, name, booked, learned } })
    } else {
      setRow(item.itemId, { busy: false, error: response.message })
    }
  }
  const unlabelledCount = data.meta.unlabelledPos.reduce((s, u) => s + u.count, 0)
  return (
    <section className={css.card}>
      <button type="button" className={css.header} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <span className={css.title}>{t('title')}</span>
        <Tag tone={remaining === 0 ? 'neutral' : 'outline'}>{t('remaining').replace('{n}', String(remaining))}</Tag>
        {data.meta.autoBooked.length > 0 ? <span className={css.subtitle}>{t('autoBooked').replace('{n}', String(data.meta.autoBooked.length))}</span> : null}
        <span className={css.spacer} />
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open && (
        <div className={css.body}>
          <datalist id={listId}>
            {merchants.map(m => <option key={m.shopNo} value={m.shopNo}>{`${m.name}${m.brand ? ` · ${m.brand}` : ''}`}</option>)}
          </datalist>
          {pending.length > 0 && (
            <div className={css.tableWrap}>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th>{t('colDate')}</th>
                    <th>{t('colSource')}</th>
                    <th>{t('colPayer')}</th>
                    <th className={css.amount}>{t('colAmount')}</th>
                    <th>{t('colRemark')}</th>
                    <th>{t('colSuggestion')}</th>
                    <th>{t('colShop')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((item) => {
                    const state = rowOf(item.itemId)
                    return (
                      <tr key={item.itemId}>
                        <td className={css.muted}>{item.date}</td>
                        <td className={css.muted}>{item.source}</td>
                        <td>{item.payerName || (item.kind === 'pos' ? 'POS' : '')}</td>
                        <td className={css.amount}>{item.amount}</td>
                        <td className={css.remark} title={item.remark}>{item.remark}</td>
                        <td>
                          {state.done === undefined
                            ? (
                              <SuggestionChips
                                suggestions={item.suggestions}
                                t={t}
                                onPick={(shopNo) => { setRow(item.itemId, { shopNo }) }}
                              />
                            )
                            : <span className={css.muted}>{item.suggestions[0]?.reason ?? ''}</span>}
                        </td>
                        <td>
                          {state.done === undefined
                            ? (
                              <span className={css.picker}>
                                <Input
                                  list={listId}
                                  value={state.shopNo}
                                  placeholder={t('shopPlaceholder')}
                                  disabled={state.busy}
                                  onChange={(event) => { setRow(item.itemId, { shopNo: event.currentTarget.value }) }}
                                />
                              </span>
                            )
                            : <span className={css.done}>✓ {state.done.shopNo} {state.done.name}</span>}
                        </td>
                        <td>
                          {state.done === undefined
                            ? (
                              <Button size="sm" variant="primary" disabled={state.busy} onClick={() => { void confirm(item) }}>
                                {state.busy ? t('confirming') : state.shopNo.trim() === '' ? t('suspense') : t('confirm')}
                              </Button>
                            )
                            : <span className={css.muted}>{state.done.booked}{state.done.learned ? ` · ${t('learned')}` : ''}</span>}
                          {state.error !== undefined ? <div className={css.error}>{state.error}</div> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.meta.autoBooked.length > 0 && (
            <>
              <div className={css.sectionTitle}>{t('autoSection')}</div>
              <div className={css.tableWrap}>
                <table className={css.table}>
                  <tbody>
                    {data.meta.autoBooked.map(a => (
                      <tr key={a.itemId}>
                        <td>{a.payerName}</td>
                        <td className={css.amount}>{a.amount}</td>
                        <td>{a.shopNo} {a.name}</td>
                        <td className={css.muted}>{a.booked}</td>
                        <td className={confidenceClass(a.confidence)}>{Math.round(a.confidence * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className={css.footer}>
            {unlabelledCount > 0 ? <span>{t('unlabelledPos').replace('{n}', String(unlabelledCount))}</span> : null}
            <span>{t('hint')}</span>
          </div>
        </div>
      )}
    </section>
  )
}
