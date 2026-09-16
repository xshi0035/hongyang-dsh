---
description: "Import and match Hongyang receipts, review daily income reports, and prepare Kingdee voucher drafts."
kind: "package-reference"
---

# @deepseek-ai/dsh-hy-finance

English | [中文](README.zh.md)

## Summary

Finance users can import merchant receivables, bank transactions, and payment-platform statements, then review receipt allocations and daily income reports. The package exports reports and Kingdee voucher drafts and answers receivable queries. Deterministic provider code calculates every amount, tax, and split. Customer reconciliation and DingTalk card acceptance remain incomplete; a successful registration does not prove that a bank transaction has been reconciled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Hongyang Web profile mounts this finance plugin. Use its settings and conversation tools to import files, review pending claims, generate reports, and export voucher drafts. The [current handoff](../../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.md) records verified startup and acceptance state.

### Configuration

The [configuration schema](src/config.ts) owns accepted settings. An empty database path resolves below `DSH_HOME`; changing the database path requires a host restart.

| Field | Default | Meaning |
|---|---|---|
| `dbPath` | `$DSH_HOME/hongyang/finance.db` | SQLite database when the configured field is empty |
| `autoOpenCards` | `true` | Expand review cards by default |
| `compareToleranceCents` | `1` | Amount tolerance for comparisons, in cents |
| `outputTaxSubject13` / `outputTaxSubject3` | Empty | Optional overrides for confirmed electricity/water output-VAT accounts |
| `companyName` | 衡阳诚远商业管理有限公司 | Expected payee for receipt-image validation |

Empty output-VAT overrides use the confirmed accounts in [fee rules](src/rules/fee-types.ts): `2221.01.02.13` for 13% electricity and `2221.01.02.03` for 3% water. Missing accounts for other fee types still prevent a complete voucher.

### Fee review and payment reversal

Approve a pending payment directly when its original merchant, fee and amount are correct; this requires no allocation reason or billing period. To change the allocation, open Adjust allocation, add fee amounts and optional complete billing periods, and give the allocation reason. Direct approval is hidden while editing; discarding adjustments restores it without booking. The server requires positive integer-cent amounts summing to the original total before approval. Approval retains the original evidence and reviewed split; conflicting retries fail. Booked DingTalk registrations can be fully reversed from the payment-day list using an explicit reversal date and reason. The original remains, and linked negative allocations restore receivable balances on the reversal record. An active voucher draft blocks reversal until withdrawn. This operation changes local registration only; it does not refund money or reverse an externally posted voucher. The same transaction reference remains reserved for human review before rebooking.

### Selected voucher drafts

Select allocated receipts in the workbench, then generate a draft. The queue retains full-day allocated, drafted, pending and unclaimed totals. Unclaimed POS amounts cannot be selected by matching a total. UONE collections use `uone_collection` and the confirmed liability account `2241.12`, without revenue or output VAT. The `finance_voucher` tool lists receipt keys before accepting an explicit selection; it does not choose a full day implicitly. A draft reserves its receipts; identical retries return the same draft. Withdraw a draft with a reason to release its receipts, while retaining its original evidence. Draft generation does not post money.

Parking remarks with a valid single business date (`@YYYYMMDD#停车费`) determine report and voucher dates; original arrival timestamps remain unchanged. Rows carry a business-date review note. Ranges and invalid dates retain the arrival date pending a separate allocation rule. Explicit POS parking remarks book as parking without choosing a contracting merchant. Human allocation corrections retain before/after records and a reason, reject stale allocations, and cannot change receipts assigned to active drafts. See the [selection and correction decision](../../../.agents/notes/implemented/architecture/2026-09-15-hongyang-selected-vouchers.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [finance service](src/service/finance-service.ts) owns the SQLite connection and delegates operations to provider modules. [Tools](src/tools/plugin.ts) expose these operations to the agent; [skills](src/skills/plugin.ts) supply business rules on demand. [Client views](src/client/index.ts) display structured results and review actions. The database is authoritative: schema versions 2–4 upgrade transactionally to version 5 with review, allocation-revision, voucher-selection and payment-reversal records; unknown versions refuse startup.

Daily-report comparison checks fee columns after pairing rows; matching subtotals do not establish matching allocations. Voucher exports use yuan for original-currency, debit, and credit amounts. Allocations with an explicit billing period only link receivables from that period.

The workbench displays DingTalk submissions across all accounting dates. Submission persists evidence and an audit row without a transaction or allocation; authenticated `POST /api/hy-finance/payment/review` approves or rejects a selected submission. Approval revalidates the draft and atomically saves financial rows, the decision and its audit entry. Same-decision retries return the existing outcome; a conflicting decision fails. Payment dates are fixed at submission. The approval provider is not exposed as an agent tool. The panel refreshes on mount and browser focus. See the [approval decision](../../../.agents/notes/implemented/architecture/2026-09-15-hongyang-workbench-approval.md).

Exact nonempty DingTalk transaction references are checked against recorded transactions and pending submissions. The submit and approve checks run inside the SQLite write transaction. The workbench reads a live duplicate warning for older queue rows, disables their approve button and leaves rejection available; approval also enforces this on the server. Rejected submissions do not reserve a reference. Missing references are not guessed from equal amounts, merchants or dates. Duplicate replies distinguish a rejected latest application from an earlier registration that remains effective. Registration time comes from the registration audit, falling back to allocation creation time; unknown times are omitted rather than inferred from the receipt date.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Hongyang subsystem](../../../docs/subsystems/hongyang.md) — finance service and integration ownership.
- [DingTalk integration](../dingtalk/README.md) — conversation drafts and transport limits.
- [Current handoff](../../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.md) — verified state and open work.
- [Requirements](../../../docs/hongyang/spec.md) — demo goals and historical plan.

<a id="model-experience"></a>
## Model Experience

### Finance identity and skills

#### What the model sees

The root plugin contributes the Hongyang identity and instructs the model to use finance tools for arithmetic. The skill catalog exposes `hy-finance`, `hy-daily-report`, and `hy-voucher`; their bodies load only when requested. These texts describe company identity, receipt channels, fees, tax rules, reports, and vouchers.

#### Token effect

Identity and skill descriptions add prompt tokens; requested skill bodies add task-specific context. Tool results add structured financial records with formatted yuan amounts. Exact token usage depends on the task and imported rows and has not been measured for this revision.

#### KV Cache effect

Stable identity and skill text can remain unchanged between requests. Imported records, query results, and tool history vary by task; this package neither controls nor guarantees provider cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The image provider requires a verifiable payee, positive amount, and valid payment time before writing and retains the transaction number. Incomplete evidence does not write; unresolved merchants or fees need confirmation. DingTalk image drafts use read-only preview and revalidate evidence and the selected merchant at confirmation; conflicting text amounts reject without writing. Web image registration and live screenshot acceptance remain incomplete.
- Some fee types have no confirmed advance-payment account. Vouchers with unresolved mappings remain drafts even when electricity and water output-VAT accounts are configured.
- Partial reversals, bank/POS registration reversal and rebooking an already reversed transaction reference are not exposed in the workbench.
- Ledger comparison depends on customer date and shop-number conventions; rows without a date cannot be matched.
- Automatic fee allocation infers intent from short payment notes. Manual correction with evidence does not establish automatic-claim acceptance.
- Full customer-sample reconciliation and live card confirmation remain acceptance work; local tests do not prove production integration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

No invariant companion is published: finance operations use one SQLite authority, and provider tests cover calculations and writes. Composition acceptance and durable DingTalk idempotency remain separate work in the current handoff.

</details>
