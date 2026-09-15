/** Exact transaction-reference checks shared by draft preview, submission and review. */
import type { DatabaseSync } from 'node:sqlite'
import { HY_TIME_ZONE } from '../activity/log.ts'
import { FinanceError } from '../../service/errors.ts'
import type { PaymentSubmissionId } from '../../service/identifiers.ts'
import { parsePaymentImageExtraction } from './image.ts'
import { parsePaymentText } from './payment.ts'

const registrationTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: HY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** Read the reference from persisted, validated submission evidence.
 * @param image - Stored screenshot extraction JSON, or null for text.
 * @param text - Stored draft text.
 * @returns Trimmed reference; empty means no exact duplicate claim is possible.
 */
export function submissionReference(image: string | null, text: string): string {
  return (image === null ? parsePaymentText(text).txnNo : parsePaymentImageExtraction(image).transactionNo ?? '').trim()
}

/** Describe a previously recorded payment or an earlier pending submission with the same reference.
 * @param db - Open finance database.
 * @param reference - Provider-validated transaction reference.
 * @param reviewing - Current submission, excluded when it is the first pending occurrence.
 * @returns User-facing reason, or undefined when no duplicate is established.
 */
export function paymentDuplicateMessage(db: DatabaseSync, reference: string, reviewing?: PaymentSubmissionId): string | undefined {
  const txnNo = reference.trim()
  if (txnNo === '') return undefined
  const registered = db.prepare(`SELECT COALESCE(
    (SELECT MIN(at) FROM activity_log WHERE action IN ('register_payment', 'confirm_payment', 'approve_payment')
      AND (target = t.id OR target IN (SELECT id FROM payment_submission WHERE transaction_id = t.id))),
    (SELECT MIN(created_at) FROM allocation WHERE transaction_id = t.id)
  ) AS registered_at FROM "transaction" t WHERE source = ? AND txn_no = ?`).get('dingtalk', txnNo) as
    { registered_at: string | null } | undefined
  if (registered !== undefined) {
    const reversal = db.prepare(`SELECT r.effective_date FROM payment_reversal r JOIN "transaction" t ON t.id=r.original_id
      WHERE t.source='dingtalk' AND t.txn_no=?`).get(txnNo)
    if (reversal !== undefined) return `该付款登记已冲正（${String(reversal.effective_date)}），原单和冲正记录均保留。交易单号 ${txnNo}。重新登记需财务复核，本次没有重复入账。`
    const history = db.prepare('SELECT status,image,text FROM payment_submission ORDER BY rowid DESC').all() as unknown as {
      status: string
      image: string | null
      text: string
    }[]
    const latest = history.find(row => submissionReference(row.image, row.text) === txnNo)
    const rejected = reviewing === undefined && latest?.status === 'rejected'
      ? '上次提交的审核申请已驳回；但这不撤销此前的登记。' : ''
    const at = registered.registered_at === null ? undefined : new Date(registered.registered_at)
    const time = at === undefined || Number.isNaN(at.getTime()) ? '' : `，原登记时间 ${registrationTime.format(at)}（北京时间）`
    const action = reviewing === undefined ? '本次没有重复提交或入账。' : '请驳回当前重复申请，本次没有重复入账。'
    return `${rejected}该付款已登记${time}，原登记仍有效。交易单号 ${txnNo}。${action}`
  }
  const pending = db.prepare("SELECT id,image,text FROM payment_submission WHERE status = 'pending' ORDER BY rowid").all() as unknown as {
    id: string
    image: string | null
    text: string
  }[]
  const first = pending.find(row => submissionReference(row.image, row.text) === txnNo)
  if (first === undefined || first.id === reviewing) return undefined
  return `该付款已在工作台待审核（交易单号 ${txnNo}），请处理已有待审核单；本次没有重复提交或入账。`
}

/** Reject a proven duplicate before any financial or submission write.
 * @param db - Open finance database.
 * @param reference - Validated transaction reference.
 * @param reviewing - Current pending submission, if approving.
 */
export function assertPaymentNotDuplicate(db: DatabaseSync, reference: string, reviewing?: PaymentSubmissionId): void {
  const message = paymentDuplicateMessage(db, reference, reviewing)
  if (message !== undefined) throw new FinanceError('DUPLICATE_PAYMENT', message)
}
