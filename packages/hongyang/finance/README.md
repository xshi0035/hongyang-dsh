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

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [finance service](src/service/finance-service.ts) owns the SQLite connection and delegates operations to provider modules. [Tools](src/tools/plugin.ts) expose these operations to the agent; [skills](src/skills/plugin.ts) supply business rules on demand. [Client views](src/client/index.ts) display structured results and review actions. The database is authoritative: incompatible schema versions refuse startup rather than silently converting records.

Daily-report comparison checks fee columns after pairing rows; matching subtotals do not establish matching allocations. Voucher exports use yuan for original-currency, debit, and credit amounts. Allocations with an explicit billing period only link receivables from that period.

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

- The image provider requires a verifiable payee, positive amount, and valid payment time before writing and retains the transaction number. Incomplete evidence does not write; unresolved merchants or fees need confirmation. Web image registration and live DingTalk image wiring remain incomplete.
- Some fee types have no confirmed advance-payment account. Vouchers with unresolved mappings remain drafts even when electricity and water output-VAT accounts are configured.
- Ledger comparison depends on customer date and shop-number conventions; rows without a date cannot be matched.
- Automatic fee allocation infers intent from short payment notes. Manual correction with evidence does not establish automatic-claim acceptance.
- Full customer-sample reconciliation and live card confirmation remain acceptance work; local tests do not prove production integration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

No invariant companion is published: finance operations use one SQLite authority, and provider tests cover calculations and writes. Composition acceptance and durable DingTalk idempotency remain separate work in the current handoff.

</details>
