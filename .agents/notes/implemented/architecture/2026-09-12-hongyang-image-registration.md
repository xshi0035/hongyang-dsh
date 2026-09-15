# Agent Note: Provider-owned screenshot registration

Status: implemented

English | [中文](2026-09-12-hongyang-image-registration.zh.md)

## Problem

Converting screenshot fields back into a sentence can discard transaction identity and time. Accepting absent payees or partial model output can turn incomplete evidence into a financial registration.

## Decision

The finance provider validates screenshot fields before the shared transaction/allocation write path. Amounts are converted and formatted in the provider, dates retain their supplied time, and transaction numbers are stored independently. Missing payees, invalid amounts, and invalid dates reject without database writes. Unrecognized merchants and fee names produce pending receipts.

The DingTalk bridge consumes the finance service's typed methods and optional vision client. The LLM adapter requires an explicit successful terminal event before releasing JSON to validation. The bridge reports failures without claiming registration success. The host entry connects the authenticated image downloader and an explicitly configured provider/model route. Image drafts preserve extracted fields alongside user text in SQLite version 2; version 1 text drafts and cards are preserved during upgrade. The provider previews without writing, rejects conflicting text amounts, and revalidates the screenshot and exact candidate on confirmation. A persisted conversation revision prevents in-flight extraction from overwriting a later message or cancellation.

DingTalk confirmation uses the [workbench approval queue](2026-09-15-hongyang-workbench-approval.md); only a workbench decision commits financial rows.

## Alternatives considered

Reconstructing free text from screenshot fields reuses the text parser but loses field separation. A shared structured provider write path preserves evidence without duplicating allocation logic. Accepting missing payees improves apparent recognition rates but cannot establish the configured recipient.

## Consequences

Database-backed bridge tests pin stored amounts, timestamps, transaction numbers, allocations, and reply text. Invalid-evidence tests pin zero writes; LLM tests reject failure, cancellation, truncation, and missing terminal events. These tests do not prove live DingTalk connectivity or full step 6/7 acceptance. A Loader composition uses real host services with external network/model fixtures and pins the image card under the package’s `tests/expected/`; this bridge does not produce a harness Session transcript. Reopen and cancellation tests cover durable image drafts and late extraction. Live model and phone acceptance, platform merging, and the web image tool remain integration work.
