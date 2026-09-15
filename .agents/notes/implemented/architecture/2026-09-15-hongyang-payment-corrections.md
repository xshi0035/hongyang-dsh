# Agent Note: Human fee review and local payment reversal

Status: implemented

English | [中文](2026-09-15-hongyang-payment-corrections.zh.md)

## Problem

A payment may cover multiple fees. One-step approval cannot express the reviewed split, and rejecting a later application cannot undo an earlier registration.

## Decision

Workbench approval accepts positive fee splits, paired valid billing dates and a reason. Their sum must equal the original receipt. The original evidence, reviewed allocation and approval audit commit together. A conflicting retry cannot replace an approved split.

Full reversal is available for booked DingTalk registrations. The reviewer selects the original, date and reason. The provider checks the reviewed allocation ids and active draft reservations, then atomically adds a linked negative transaction, exact negative allocation amounts and taxes, and audit. The original stays unchanged. Receivable links are copied so balances reopen. Reversal retries are idempotent; tax rounding mirrors positive amounts.

## Consequences

Reversal affects the specified day; an earlier report keeps its original receipts. Active drafts must be withdrawn first. The original reference stays reserved and reports its reversed state instead of pretending it remains effective. Partial reversals, external ledger posting, refunds, bank/POS reversal and rebooking a reversed reference remain outside this workbench operation. Tests cover fee totals, periods, evidence retention, duplicate requests, active drafts, stale allocation ids, restored balances, mirrored voucher lines and audit rollback.

## Alternatives considered

Deleting the original would discard evidence. Reusing rejection would confuse a review decision with a financial correction. Silently changing approved splits would invalidate existing reports and drafts. Linked negative entries preserve the original and make the correction explicit.
