/**
 * Staged form over the `hy-finance` settings namespace. Edits are staged as
 * text and written only on save, one revision-fenced write per changed field;
 * a blank draft for a text field clears the override so the field inherits
 * the composition layer again.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Namespace spelled here: a client module must not import the Host package. */
export const HY_FINANCE_NS = 'hy-finance'

/** Section fields as the Host resolves them. */
export interface FinanceSettings {
  dbPath?: string
  autoOpenCards?: boolean
  compareToleranceCents?: number
  outputTaxSubject13?: string
  outputTaxSubject3?: string
  companyName?: string
}

/** Text fields the card stages. */
export const TEXT_FIELDS = ['dbPath', 'outputTaxSubject13', 'outputTaxSubject3', 'companyName'] as const
/** Numeric fields the card stages. */
export const NUMBER_FIELDS = ['compareToleranceCents'] as const
/** Boolean fields the card stages. */
export const BOOL_FIELDS = ['autoOpenCards'] as const

type TextField = typeof TEXT_FIELDS[number]
type NumberField = typeof NUMBER_FIELDS[number]
type BoolField = typeof BOOL_FIELDS[number]
/** Every staged field. */
export type FormField = TextField | NumberField | BoolField

/** One control's render state. */
export interface FieldState {
  /** Draft text (booleans render `'true'`/`'false'`). */
  text: string
  /** Whether saving would leave a user-layer override. */
  overridden: boolean
  /** Whether the draft is not acceptable, which blocks saving. */
  invalid: boolean
}

/** What the card renders. */
export interface FinanceCardState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  fields: Record<FormField, FieldState>
}

/** The registration-side face the slot entry injects. */
export interface FinanceCardFace {
  hooks: { financeCard: SnapshotStore<FinanceCardState> }
  edit: (field: FormField, text: string) => void
  resetField: (field: FormField) => void
  save: () => void
  discard: () => void
}

const ALL_FIELDS: readonly FormField[] = [...TEXT_FIELDS, ...NUMBER_FIELDS, ...BOOL_FIELDS]

function isNumberField(field: FormField): field is NumberField {
  return (NUMBER_FIELDS as readonly string[]).includes(field)
}
function isBoolField(field: FormField): field is BoolField {
  return (BOOL_FIELDS as readonly string[]).includes(field)
}

/** Bridges the settings scope onto the card state and performs saves. */
export class FinanceCardController {
  private readonly store: SnapshotStore<FinanceCardState>
  private readonly staged = new Map<FormField, string | null>()
  private saving = false
  private failed = false

  /** @param scope - the bound `hy-finance` settings scope. */
  constructor(private readonly scope: SettingsScope<FinanceSettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.publish() })
  }

  /** The face the slot registration injects. */
  inject(): FinanceCardFace {
    return {
      hooks: { financeCard: this.store },
      edit: (field, text) => { this.staged.set(field, text); this.failed = false; this.publish() },
      resetField: (field) => { this.staged.set(field, null); this.failed = false; this.publish() },
      save: () => { void this.save() },
      discard: () => { this.staged.clear(); this.failed = false; this.publish() },
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private storedText(field: FormField): string {
    const snapshot = this.scope.getSnapshot()
    const value = (snapshot.value as Record<string, unknown> | undefined)?.[field]
    if (value === undefined || value === null) return ''
    return String(value)
  }

  private fieldState(field: FormField): FieldState {
    const snapshot = this.scope.getSnapshot()
    const user = snapshot.user as Record<string, unknown> | undefined
    const staged = this.staged.get(field)
    const text = staged === undefined ? this.storedText(field) : (staged ?? '')
    const overridden = staged === undefined
      ? user !== undefined && Object.hasOwn(user, field)
      : staged !== null
    return { text, overridden, invalid: this.parse(field, text) === undefined }
  }

  /** The value a draft writes; `undefined` when unacceptable; `null` to clear. */
  private parse(field: FormField, text: string): unknown | null | undefined {
    if (isBoolField(field)) return text === 'true'
    if (isNumberField(field)) {
      if (text.trim() === '') return null
      return /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined
    }
    return text.trim() === '' ? null : text
  }

  private projection(): FinanceCardState {
    const snapshot = this.scope.getSnapshot()
    const fields = Object.fromEntries(ALL_FIELDS.map(field => [field, this.fieldState(field)])) as Record<FormField, FieldState>
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.staged.size > 0,
      invalid: ALL_FIELDS.some(field => fields[field].invalid),
      saving: this.saving,
      failed: this.failed,
      fields,
    }
  }

  private async save(): Promise<void> {
    if (this.saving || this.staged.size === 0) return
    const plan: { field: FormField; value: unknown | null }[] = []
    for (const [field, staged] of this.staged) {
      const value = staged === null ? null : this.parse(field, staged)
      if (value === undefined) return
      plan.push({ field, value })
    }
    this.saving = true
    this.publish()
    try {
      for (const { field, value } of plan) {
        if (value === null) await this.scope.unset(field)
        else await this.scope.set(field, value)
      }
      this.staged.clear()
    } catch {
      // The scope already reloaded Host state on a failed latest write; the
      // drafts stay so the person can correct and retry.
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }
}
