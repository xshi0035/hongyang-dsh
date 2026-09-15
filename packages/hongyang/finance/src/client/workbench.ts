/**
 * State and actions behind the finance workbench panel: one day's summary
 * fetched from the Host route, the selected day, and the quick actions that
 * hand a request to the current session's agent.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { financeDay, shiftDay } from '../shared/day.ts'
import { HY_FINANCE_API, type WorkbenchWire } from '../shared/wire.ts'

/** What the panel renders. */
export interface WorkbenchState {
  reviewing: string | undefined
  reviewError: string | undefined
  reviewNotice: 'approved' | 'rejected' | undefined
  date: string
  loading: boolean
  error: string | undefined
  data: WorkbenchWire | undefined
  /** Instant of the last successful load, ISO. */
  loadedAt: string | undefined
  /** Outcome of the last quick action, cleared on the next one. */
  notice: 'sent' | 'noSession' | 'failed' | undefined
}

/** Quick actions the panel offers; each becomes one prompt to the agent. */
export type WorkbenchAction = 'runClaims' | 'buildReport' | 'buildVoucher' | 'listOverdue'

/** The registration-side face the panel entry injects. */
export interface WorkbenchFace {
  hooks: { workbench: SnapshotStore<WorkbenchState> }
  review: (id: string, decision: 'approve' | 'reject') => void
  refresh: () => void
  setDate: (date: string) => void
  shiftDate: (delta: number) => void
  ask: (action: WorkbenchAction) => void
}

/** How the controller reaches the outside world; the client entry supplies the real one. */
export interface WorkbenchHost {
  review(id: string, decision: 'approve' | 'reject'): Promise<void>
  load(date: string): Promise<WorkbenchWire>
  /** Queue a prompt into the current session; resolves false when no session is selected. */
  send(text: string): Promise<boolean>
}

/**
 * Send a workbench decision through the authenticated route.
 * @param id - Selected submission.
 * @param decision - Approve and book, or reject without booking.
 */
export async function reviewPayment(id: string, decision: 'approve' | 'reject'): Promise<void> {
  const response = await fetch(`${HY_FINANCE_API}/payment/review`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, decision }),
  })
  const body = await response.json() as { ok: boolean; message?: string }
  if (!response.ok || !body.ok) throw new Error(body.message ?? `HTTP ${String(response.status)}`)
}

/** Fetch the selected accounting day's workbench summary.
 * @param date - Accounting day.
 * @returns Current summary and all pending reviews.
 */
export async function fetchWorkbench(date: string): Promise<WorkbenchWire> {
  const response = await fetch(`${HY_FINANCE_API}/workbench?date=${encodeURIComponent(date)}`, { credentials: 'same-origin' })
  const body = await response.json() as WorkbenchWire | { ok: false; message: string }
  if (!response.ok || 'ok' in body) throw new Error('message' in body ? body.message : `HTTP ${String(response.status)}`)
  return body
}

/**
 * The prompt one quick action sends. Kept here so the text the agent sees is
 * pinned by tests and stays independent of the rendered button label.
 * @param action - Quick action.
 * @param date - Selected day.
 * @returns Prompt text.
 */
export function actionPrompt(action: WorkbenchAction, date: string): string {
  switch (action) {
    case 'runClaims': return '请运行一次收款认领，把仍需人工确认的收款列成卡片给我逐笔确认。'
    case 'buildReport': return `请生成 ${date} 的收入日报表，并与台账逐行比对，告诉我差异。`
    case 'buildVoucher': return `请列出 ${date} 的待制证收款和全日覆盖统计，等我选择收款后再生成凭证草稿。`
    case 'listOverdue': return '请列出逾期 30 天以上的商户和欠费金额，按金额从大到小。'
    default: return ''
  }
}

/** Owns the panel state; one instance per client runtime. */
export class WorkbenchController {
  /** Observable state shared by the workbench panel and its actions. */
  readonly store: SnapshotStore<WorkbenchState>
  private generation = 0

  /**
   * @param host - Route fetch and session send, supplied by the client entry.
   */
  constructor(private readonly host: WorkbenchHost) {
    this.store = createSnapshotStore<WorkbenchState>({
      reviewing: undefined, reviewError: undefined, reviewNotice: undefined,
      date: financeDay(), loading: false, error: undefined, data: undefined, loadedAt: undefined, notice: undefined,
    })
  }

  /**
   * The face the slot entry injects.
   * @returns Panel hooks and actions backed by this controller.
   */
  inject(): WorkbenchFace {
    return {
      hooks: { workbench: this.store },
      review: (id, decision) => { void this.review(id, decision) },
      refresh: () => { void this.load() },
      setDate: (date) => { this.store.update((draft) => { draft.date = date }); void this.load() },
      shiftDate: (delta) => {
        this.store.update((draft) => { draft.date = shiftDay(draft.date, delta) })
        void this.load()
      },
      ask: (action) => { void this.ask(action) },
    }
  }

  /** Load the selected day; a stale response never overwrites a newer one. */
  async load(): Promise<void> {
    const generation = ++this.generation
    const { date } = this.store.getSnapshot()
    this.store.update((draft) => { draft.loading = true; draft.error = undefined })
    try {
      const data = await this.host.load(date)
      if (generation !== this.generation) return
      this.store.update((draft) => { draft.loading = false; draft.data = data; draft.loadedAt = new Date().toISOString() })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((draft) => { draft.loading = false; draft.error = error instanceof Error ? error.message : String(error) })
    }
  }

  private async review(id: string, decision: 'approve' | 'reject'): Promise<void> {
    if (this.store.getSnapshot().reviewing !== undefined) return
    this.store.update((draft) => { draft.reviewing = id; draft.reviewError = undefined; draft.reviewNotice = undefined })
    try {
      await this.host.review(id, decision)
      ++this.generation
      this.store.update((draft) => {
        if (draft.data !== undefined) draft.data = { ...draft.data, pendingReviews: draft.data.pendingReviews.filter(row => row.id !== id) }
        draft.reviewNotice = decision === 'approve' ? 'approved' : 'rejected'
      })
      await this.load()
    } catch (error) {
      this.store.update((draft) => { draft.reviewError = error instanceof Error ? error.message : String(error) })
    } finally {
      this.store.update((draft) => { draft.reviewing = undefined })
    }
  }

  private async ask(action: WorkbenchAction): Promise<void> {
    const { date } = this.store.getSnapshot()
    this.store.update((draft) => { draft.notice = undefined })
    try {
      const sent = await this.host.send(actionPrompt(action, date))
      this.store.update((draft) => { draft.notice = sent ? 'sent' : 'noSession' })
    } catch {
      this.store.update((draft) => { draft.notice = 'failed' })
    }
  }
}
