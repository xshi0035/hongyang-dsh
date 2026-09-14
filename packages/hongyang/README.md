---
description: "Hongyang finance and DingTalk package map for local receipt registration, review, and reporting."
kind: "package-group"
---

# hongyang/ — finance assistant

English | [中文](README.zh.md)

## Summary

The Hongyang packages let operators report receipts through DingTalk and let finance users import, review, and report payment data in the browser. The finance package owns deterministic accounting operations and SQLite records. The DingTalk package adds the message adapter. Live card confirmation and complete customer reconciliation remain unfinished.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the package for the user entry point or financial operation being changed.

| Package | Role |
|---|---|
| [finance](finance/README.md) | Imports, claims, reports, voucher drafts, queries, and browser review |
| [dingtalk](dingtalk/README.md) | DingTalk Stream messages and payment-draft conversations |

<a id="related-documentation"></a>
## Related documentation

- [Hongyang subsystem](../../docs/subsystems/hongyang.md) — finance service ownership and integration.
- [Current handoff](../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.md) — verified development state and startup.

<a id="dev-note"></a>
## Dev Note

None.
