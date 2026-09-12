# Agent Note: Finance voucher audit boundaries

Status: implemented

English | [中文](2026-09-12-finance-voucher-audit.zh.md)

## Problem

Receipt subtotals can agree while fee allocations differ. Treating these pairs as fully matched hides incorrect voucher subjects and taxes. Explicit period overrides can also attach to older receivables, and export units must agree across monetary columns.

## Decision

The finance provider checks each fee amount after pairing ledger rows, including pairs formed by aggregating ledger rows. Fee differences use the existing amount-difference result with a fee-specific explanation. Explicit split dates constrain receivable attachment. Voucher generation uses the confirmed VAT subject table, and all workbook monetary columns use yuan. Synthetic provider tests cover the combined receipt-to-voucher path, fee differences, period attachment, and workbook values.

## Alternatives considered

- Subtotal-only acceptance misses incorrect fee allocations and is insufficient for voucher validation.
- Feeding reference vouchers into generation would hide upstream claim failures. Reference data stays outside automatic generation; documented manual corrections are distinct from automatic-claim acceptance.
- Matching POS orders by amount alone does not establish merchant ownership, so unidentified orders remain unresolved.

## Consequences

Fresh-sample matched counts can decrease when fee errors become visible. Correcting verified local registrations requires a database backup and a local evidence record; customer data is excluded from Git. Passing a scoped voucher conversion after such correction does not certify the full day's accounting scope or automatic recognition. Ambiguous payer identity, abbreviated fee remarks, unknown subjects, and gross-versus-net settlement policy still need business review.
