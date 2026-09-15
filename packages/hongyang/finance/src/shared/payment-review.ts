/** JSON responses used by the workbench's human review controls. */
export interface ReviewDetailsWire {
  amount: number
  splits: { feeType: string; amount: number }[]
  fees: { value: string; label: string }[]
}

/** Original payment eligible for full local-registration reversal. */
export interface ReversiblePaymentWire {
  transactionId: string
  date: string
  shopNo: string
  merchantName: string
  amount: number
  allocationIds: string[]
  reversed: boolean
  reversalDate?: string | undefined
  blocked: boolean
}
