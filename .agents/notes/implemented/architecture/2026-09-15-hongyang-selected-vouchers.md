# Agent Note: Selected voucher drafts and audited allocation corrections

Status: implemented

English | [中文](2026-09-15-hongyang-selected-vouchers.zh.md)

## Problem

The customer voucher sample covers selected receipts, while the daily report covers the entire reporting day. Treating these scopes as identical hides unselected money or creates false differences.

## Decision

The workbench selects stable receipt keys and shows allocated, drafted, pending and unclaimed totals together. The model-facing tool lists keys and requires an explicit selection. Schema 4 stores receipt reservations, withdrawal evidence and allocation revisions. Selection and audit are atomic; identical retries return one draft. Withdrawal retains the original voucher and releases its receipts. Corrections compare reviewed allocation ids, require positive splits summing to the receipt and retain before/after evidence. Active draft reservations prevent corrections from silently invalidating a document.

UONE collections use liability account 2241.12 without revenue or output VAT. Missing POS ownership remains unclaimed regardless of similar amounts. A valid single parking business-date remark determines the reporting day, retaining arrival time and the review annotation; multi-day ranges require a separate decision.

## Consequences

These operations change local accounting records, not bank balances or posted vouchers. Provider tests cover selection coverage, synthetic nine-line vouchers, unclaimed exclusions, correction rollback, stale selections, duplicate requests, withdrawal, exact payer learning and parking dates. The tool fixture pins the selection prompt and rejects implicit whole-day generation. Customer acceptance still requires actual POS ownership.

## Alternatives considered

Generating the entire day's voucher cannot represent the customer's selected-receipt workflow. Filtering away unmatched receipts hides incomplete coverage. Matching unlabelled POS records by total amount cannot establish ownership. The selected draft keeps all remaining receipts visible and preserves the original reference for comparison.
