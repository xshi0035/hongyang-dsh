# Agent Note: Workbench approval for DingTalk payments

Status: implemented

English | [中文](2026-09-15-hongyang-workbench-approval.zh.md)

## Problem

DingTalk merchant confirmation also booked the payment, while finance staff need a separate workbench decision. A payment timestamp from an older screenshot can also hide a pending item when the workbench filters by day.

## Decision

DingTalk confirmation submits original evidence and the selected merchant to a durable queue. Its stable draft id makes retries idempotent across the bridge and finance databases. Only the authenticated workbench review route calls the approval provider. Pending items appear across dates and contribute no financial totals. Approval revalidates evidence and saves the transaction, allocation, terminal review state and web audit in one SQLite transaction. Rejection saves the terminal decision and audit without booking. Repeating a decision returns its stored result; an opposite decision fails.

The finance database migrates known version 2 to version 3 transactionally. Existing financial rows are preserved. Nested provider writes use savepoints inside the approval transaction. A single Stream owner reopens interrupted card claims on startup, and submitted cards return their settled result for further clicks. The panel refreshes on mount and focus.

A nonempty exact transaction reference detects an already recorded DingTalk payment or the first pending submission with that reference. Preview reports it early; submit and approve recheck under the write transaction. Older duplicate queue rows remain visible with a warning and a disabled approval button, and the server rejects approval with `DUPLICATE_PAYMENT`. The first pending occurrence can still be approved. Rejected submissions permit corrected resubmission, and missing references do not imply duplication. Identical amounts and merchants are insufficient evidence to reject a payment.

A rejection applies to one submission and does not reverse another registration with the same reference. Duplicate wording names a rejected latest application separately from the effective original registration. It displays the original registration audit time in the finance timezone, with allocation creation time as a fallback, and never substitutes the receipt timestamp. An unavailable registration time is omitted.

## Alternatives considered

A provisional financial transaction mixes unapproved money with accounting totals. An in-memory inbox loses submissions on restart. The separate durable queue preserves evidence while making the workbench the approval boundary.

## Consequences

Provider tests verify zero financial writes on submission or rejection, persistence, cross-date visibility, same-decision replay, conflicting decisions, revalidation, migration and rollback after audit failure. The Loader image-card composition pins user-visible submission wording and delays booking until approval. Browser acceptance exercises the authenticated route and rendered list using clearly labeled synthetic payments in the isolated database. The bridge produces no Session transcript; its owner-local card expectation records its product output. Approval does not reconcile the receipt against imported bank records or prove end-to-end phone acceptance of the final flow.
