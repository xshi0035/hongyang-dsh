/**
 * Stable domain error codes. Tools surface the code in their result so the
 * model and the client can react without parsing prose.
 * @module @deepseek-ai/dsh-hy-finance/service/errors
 */

/** Codes a caller may branch on. */
export type FinanceErrorCode =
  | 'DB_VERSION_MISMATCH'
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_FILE'
  | 'SHEET_NOT_FOUND'
  | 'MERCHANT_NOT_FOUND'
  | 'TRANSACTION_NOT_FOUND'
  | 'ALREADY_ALLOCATED'
  | 'AMOUNT_MISMATCH'
  | 'SUBJECT_UNCONFIRMED'
  | 'INVALID_INPUT'

/** Error carrying a stable code and a human message. */
export class FinanceError extends Error {
  override readonly name = 'FinanceError'

  /**
   * @param code - stable machine code.
   * @param message - human-readable explanation for the model and logs.
   */
  constructor(readonly code: FinanceErrorCode, message: string) {
    super(message)
  }
}
