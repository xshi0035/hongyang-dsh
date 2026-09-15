/** Durable DingTalk submissions. Financial rows are created only by a workbench decision. */
import type { DatabaseSync } from 'node:sqlite'
import { newId, type PaymentSubmissionId, type TransactionId } from '../../service/identifiers.ts'
import { assertPaymentNotDuplicate, paymentDuplicateMessage, submissionReference } from './duplicate.ts'
import { transaction } from '../db/repo.ts'
import { recordActivity } from '../activity/log.ts'
import { preparePayment, previewPayment } from './conversation.ts'
import { parsePaymentImageExtraction, preparePaymentImage, previewPaymentImage, type ImageRegistrationOptions, type PaymentImageExtraction } from './image.ts'
import { registerParsedPayment, registrationSummary } from './payment.ts'
import { parsePaymentReview, type PaymentReview } from './review.ts'
import { FEE_RULES } from '../../rules/fee-types.ts'

/** A confirmed DingTalk draft; its stable draft id makes delivery retries idempotent. */
export interface PaymentSubmissionInput {
  draftId: string
  text: string
  shopNo: string
  submitter: string
  image?: PaymentImageExtraction | undefined
}

/** Persisted review evidence. Pending submissions do not contribute to financial totals. */
export interface PaymentSubmission {
  id: PaymentSubmissionId
  submittedAt: string
  shopNo: string
  merchantName: string
  summary: string
  text: string
  image: PaymentImageExtraction | undefined
  paymentDate: string
  status: 'pending' | 'approved' | 'rejected'
  transactionId: TransactionId | undefined
  /** Live duplicate warning on workbench reads; historical rows remain unchanged. */
  duplicateMessage: string | undefined
}

interface SubmissionRow {
  id: string
  draft_id: string
  submitted_at: string
  submitter: string
  shop_no: string
  merchant_name: string
  summary: string
  text: string
  image: string | null
  payment_date: string
  status: PaymentSubmission['status']
  transaction_id: string | null
}

function project(row: SubmissionRow): PaymentSubmission {
  return {
    id: row.id as PaymentSubmissionId, submittedAt: row.submitted_at, shopNo: row.shop_no, merchantName: row.merchant_name,
    summary: row.summary, text: row.text, image: row.image === null ? undefined : parsePaymentImageExtraction(row.image),
    duplicateMessage: undefined,
    paymentDate: row.payment_date, status: row.status, transactionId: (row.transaction_id ?? undefined) as TransactionId | undefined,
  }
}

/** Submit a validated draft, without creating a transaction or allocation.
 * @param db - Finance database owning the queue.
 * @param input - Selected merchant and original evidence.
 * @param options - Legal payee configuration.
 * @returns Existing or newly stored submission.
 */
export function submitPayment(db: DatabaseSync, input: PaymentSubmissionInput, options: ImageRegistrationOptions): PaymentSubmission {
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM payment_submission WHERE draft_id = ?').get(input.draftId) as unknown as SubmissionRow | undefined
    if (existing !== undefined) {
      if (existing.text !== input.text || existing.shop_no !== input.shopNo || existing.submitter !== input.submitter
        || existing.image !== (input.image === undefined ? null : JSON.stringify(input.image))) throw new Error('该草稿已提交，不能更改提交内容')
      return project(existing)
    }
    const parsed = input.image === undefined ? preparePayment(db, input.text, input.shopNo)
      : preparePaymentImage(db, input.image, input.text, input.shopNo, options)
    assertPaymentNotDuplicate(db, parsed.txnNo)
    const preview = input.image === undefined ? previewPayment(db, input.text) : previewPaymentImage(db, input.image, input.text, options)
    const merchant = preview.candidates.find(item => item.shopNo === input.shopNo)
    if (merchant === undefined) throw new Error('商户已变化，请重新提交')
    const id = newId('sub')
    const submittedAt = new Date().toISOString()
    db.prepare(`INSERT INTO payment_submission
      (id, draft_id, submitted_at, submitter, shop_no, merchant_name, summary, text, image, payment_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(
      id, input.draftId, submittedAt, input.submitter, input.shopNo, merchant.name, preview.summary, input.text,
      input.image === undefined ? null : JSON.stringify(input.image), parsed.date,
    )
    recordActivity(db, { actor: { kind: 'dingtalk', id: input.submitter }, action: 'submit_payment', target: id,
      detail: `${input.shopNo} ${merchant.name}；${preview.summary}；待工作台审核，尚未入账` })
    return { id, submittedAt, shopNo: input.shopNo, merchantName: merchant.name, summary: preview.summary,
      text: input.text, image: input.image, paymentDate: parsed.date, status: 'pending', transactionId: undefined, duplicateMessage: undefined }
  })
}

/** Read every pending submission, independent of the workbench's selected accounting day.
 * @param db - Open finance database.
 * @returns Pending submissions, oldest first.
 */
export function pendingPayments(db: DatabaseSync): PaymentSubmission[] {
  return (db.prepare("SELECT * FROM payment_submission WHERE status = 'pending' ORDER BY submitted_at, id").all() as unknown as SubmissionRow[]).map(row => ({
    ...project(row), duplicateMessage: paymentDuplicateMessage(db, submissionReference(row.image, row.text), row.id as PaymentSubmissionId),
  }))
}

/** Apply an authenticated workbench decision atomically with its financial rows and audit.
 * This provider operation is not exposed as an agent tool or DingTalk callback.
 * @param db - Open finance database.
 * @param id - Submission selected in the workbench.
 * @param decision - Approve or reject.
 * @param options - Current legal payee configuration, revalidated at approval.
 * @param review - Optional human fee split JSON and audit reason.
 * @returns The durable outcome; repeating the same decision creates no extra rows.
 */
export function decidePayment(
  db: DatabaseSync, id: PaymentSubmissionId, decision: 'approve' | 'reject', options: ImageRegistrationOptions,
  review?: unknown,
): PaymentSubmission {
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM payment_submission WHERE id = ?').get(id) as unknown as SubmissionRow | undefined
    if (row === undefined) throw new Error('待审核单不存在，请刷新工作台')
    const submission = project(row)
    const status = decision === 'approve' ? 'approved' : 'rejected'
    if (submission.status === status) {
      if (review !== undefined) {
        const saved = db.prepare('SELECT review_json FROM payment_review_allocation WHERE submission_id=?').get(id)
        if (saved?.review_json !== JSON.stringify(review)) throw new Error('该单已按另一份分配处理，请刷新核对')
      }
      return submission
    }
    if (submission.status !== 'pending') throw new Error('该单已处理，请刷新工作台查看结果')
    let transactionId: TransactionId | undefined
    let detail = `${submission.shopNo} ${submission.merchantName}；已驳回，未入账`
    let amount: number | undefined
    if (decision === 'approve') {
      const parsed = submission.image === undefined ? preparePayment(db, submission.text, submission.shopNo)
        : preparePaymentImage(db, submission.image, submission.text, submission.shopNo, options)
      assertPaymentNotDuplicate(db, parsed.txnNo, id)
      const allocation = review === undefined ? undefined : parsePaymentReview(review, parsed.amount)
      const evidence = JSON.stringify({ submissionId: id, text: submission.text, extraction: submission.image })
      const result = registerParsedPayment(db, { ...parsed, date: submission.paymentDate }, evidence, allocation?.splits)
      if (!result.booked) throw new Error('商户或费项已变化，请核对后重新提交')
      transactionId = result.transactionId
      amount = result.parsed.amount
      detail = registrationSummary(result)
      if (allocation !== undefined) {
        db.prepare('INSERT INTO payment_review_allocation(submission_id,review_json) VALUES(?,?)').run(id, JSON.stringify(review))
        detail = `${submission.shopNo} ${submission.merchantName}；工作台分配：${allocation.splits.map(s => `${FEE_RULES[s.feeType].label} ${(s.amount / 100).toFixed(2)}`).join(' + ')}；依据：${allocation.reason}`
      }
    }
    db.prepare('UPDATE payment_submission SET status = ?, decided_at = ?, transaction_id = ? WHERE id = ?')
      .run(status, new Date().toISOString(), transactionId ?? null, id)
    recordActivity(db, { actor: { kind: 'web', id: 'workbench' }, action: decision === 'approve' ? 'approve_payment' : 'reject_payment',
      target: id, ...(amount === undefined ? {} : { amount }), detail })
    return { ...submission, status, transactionId }
  })
}

/** Read original evidence as editable fee defaults without changing the submission.
 * @param db - Finance database.
 * @param id - Pending submission id.
 * @param options - Legal payee configuration.
 * @returns Original total and the initial fee allocation.
 */
export function paymentReviewDetails(db: DatabaseSync, id: PaymentSubmissionId, options: ImageRegistrationOptions): Pick<PaymentReview, 'splits'> & { amount: number } {
  const row = db.prepare('SELECT * FROM payment_submission WHERE id=?').get(id) as unknown as SubmissionRow | undefined
  if (row === undefined || row.status !== 'pending') throw new Error('该单不在待审核状态')
  const submission = project(row)
  const parsed = submission.image === undefined ? preparePayment(db, submission.text, submission.shopNo)
    : preparePaymentImage(db, submission.image, submission.text, submission.shopNo, options)
  if (parsed.feeType === undefined) throw new Error('原付款缺少费项，请先补充后重新提交')
  return { amount: parsed.amount, splits: [{ feeType: parsed.feeType, amount: parsed.amount }] }
}
