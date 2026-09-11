/**
 * The "弘阳财务" card on the plugin configuration tab: database file, review
 * card behaviour, comparison tolerance, the two unconfirmed VAT accounts, and
 * the receiving entity. Disclosure is card-local; staged edits survive
 * collapsing and the header marks unsaved edits.
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChevronDownOutline14, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { FinanceCardFace, FieldState, FormField } from './settings-card.ts'
import type { FinanceSettingsKey } from './locales.ts'
import css from './FinanceSettingsCard.module.css'

/** Join the truthy class names. */
function clsx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

/** Props the renderer binds for the card. */
export type FinanceSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.hyFinance'>
  & InjectFace<FinanceCardFace>

interface TextRowProps {
  id: string
  field: FormField
  labelKey: FinanceSettingsKey
  hintKey: FinanceSettingsKey
  state: FieldState
  numeric?: boolean
  unconfirmedWhenBlank?: boolean
  disabled: boolean
  t: (key: FinanceSettingsKey) => string
  onEdit: (field: FormField, text: string) => void
  onReset: (field: FormField) => void
}

function TextRow(props: TextRowProps) {
  const { t, state } = props
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={props.id}>
        {t(props.labelKey)}
        {props.unconfirmedWhenBlank && state.text.trim() === '' ? <Tag tone="outline">{t('unconfirmed')}</Tag> : null}
        {state.overridden ? <Tag tone="neutral">{t('overridden')}</Tag> : null}
      </label>
      <span className={css.control}>
        <Input
          id={props.id}
          value={state.text}
          inputMode={props.numeric ? 'numeric' : undefined}
          disabled={props.disabled}
          aria-invalid={state.invalid}
          onChange={(event) => { props.onEdit(props.field, event.currentTarget.value) }}
        />
      </span>
      <Button size="sm" disabled={props.disabled || !state.overridden} onClick={() => { props.onReset(props.field) }}>
        {t('reset')}
      </Button>
      <span className={css.hint}>{state.invalid ? <span className={css.invalidText}>{t('invalidNumber')}</span> : t(props.hintKey)}</span>
    </div>
  )
}

/**
 * Render the finance settings card.
 * @param props - locale copy, the card snapshot, and its actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function FinanceSettingsCard(props: FinanceSettingsCardProps) {
  const { t } = props
  const state = props.useFinanceCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  const f = state.fields
  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('title')}</span>
          <span className={css.description}>{t('description')}</span>
        </span>
        {state.dirty ? <Tag tone="neutral">{t('unsaved')}</Tag> : null}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open && (
        <div className={css.body}>
          <div className={css.field}>
            <span className={css.label}>
              {t('autoOpenCards')}
              {f.autoOpenCards.overridden ? <Tag tone="neutral">{t('overridden')}</Tag> : null}
            </span>
            <span className={css.control}>
              <Switch
                label={t('autoOpenCards')}
                checked={f.autoOpenCards.text !== 'false'}
                disabled={disabled}
                onChange={(next) => { props.edit('autoOpenCards', String(next)) }}
              />
            </span>
            <Button size="sm" disabled={disabled || !f.autoOpenCards.overridden} onClick={() => { props.resetField('autoOpenCards') }}>
              {t('reset')}
            </Button>
            <span className={css.hint}>{t('autoOpenCardsHint')}</span>
          </div>
          <TextRow id="hy-finance-compare-tolerance" field="compareToleranceCents" labelKey="compareTolerance" hintKey="compareToleranceHint" numeric state={f.compareToleranceCents} disabled={disabled} t={t} onEdit={props.edit} onReset={props.resetField} />
          <TextRow id="hy-finance-output-tax-13" field="outputTaxSubject13" labelKey="outputTax13" hintKey="outputTax13Hint" unconfirmedWhenBlank state={f.outputTaxSubject13} disabled={disabled} t={t} onEdit={props.edit} onReset={props.resetField} />
          <TextRow id="hy-finance-output-tax-3" field="outputTaxSubject3" labelKey="outputTax3" hintKey="outputTax3Hint" unconfirmedWhenBlank state={f.outputTaxSubject3} disabled={disabled} t={t} onEdit={props.edit} onReset={props.resetField} />
          <TextRow id="hy-finance-company" field="companyName" labelKey="companyName" hintKey="companyNameHint" state={f.companyName} disabled={disabled} t={t} onEdit={props.edit} onReset={props.resetField} />
          <TextRow id="hy-finance-db-path" field="dbPath" labelKey="dbPath" hintKey="dbPathHint" state={f.dbPath} disabled={disabled} t={t} onEdit={props.edit} onReset={props.resetField} />
          <div className={css.footer}>
            <span className={clsx(css.status, state.failed && css.statusError)}>
              {state.failed ? t('saveFailed') : disabled ? t('readOnly') : ''}
            </span>
            <Button size="sm" disabled={!state.dirty || state.saving} onClick={props.discard}>{t('discard')}</Button>
            <Button size="sm" variant="primary" disabled={blocked} onClick={props.save}>
              {state.saving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
