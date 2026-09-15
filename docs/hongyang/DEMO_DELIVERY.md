---
description: "Hongyang finance demo delivery: setup, capabilities, checklist, and structure."
kind: "reference"
---

# Hongyang Demo Delivery

English | [中文](DEMO_DELIVERY.zh.md)

## Summary

This delivery supports colleague demonstrations and development on branch `test`. Status is recorded as of 2026-09-13; it does not certify production posting or final voucher acceptance. Git contains code and customer samples; actual credentials and runtime data are supplied in a separate private archive.

## Table of Contents

- [Delivery contents](#delivery)
- [Startup](#startup)
- [Capabilities and checklist](#capabilities)
- [Project structure](#structure)
- [Demo sequence](#demo)
- [Dev Note](#dev-note)

<a id="delivery"></a>
## Delivery contents

- `hongyang-test.bundle`: an offline-clonable Git repository containing branch `test`.
- Repository `demo/sample.tar.gz`: the complete sample directory, including source statements, generated workbooks, and a historical database backup; extract before opening it as a workspace. A SHA-256 checksum accompanies the archive.
- Repository `docs/hongyang/samples/`: source samples required by smoke.
- `hongyang-test-private.tar.gz`: local `.env.local` and Hongyang runtime directory `home/`, containing credentials, model settings, plugin manifests, sessions, attachments, and a consistent finance database backup. Share only with colleagues authorized to receive these materials, never in public repositories.
- The private archive excludes `node_modules` and machine-local dependency symlinks; colleagues must install dependencies for their operating system.

<a id="startup"></a>
## Startup

The following procedure targets macOS/Linux and requires Node.js 22.19+ (or 24+), pnpm 11.7.0, and the project's native build prerequisites. A complete cold start on another machine has not been accepted; dependency installation is necessary.

```bash
git clone -b test hongyang-test.bundle hongyang-demo
cd hongyang-demo
tar -xzf demo/sample.tar.gz
mkdir .demo-home
tar -xzf ../hongyang-test-private.tar.gz -C .demo-home
cp .demo-home/.env.local .env.local
export DSH_HOME="$PWD/.demo-home/home"
pnpm install --frozen-lockfile
pnpm run build
```

Install the profile dependencies under `DSH_HOME/profiles/web`, then return to the repository to start. If the recipient does not use a proxy on port 7897, adjust `DSH_HOME/.env` for their network instead of copying the original machine's proxy address unchanged. Keep DingTalk API domains in `NO_PROXY`.

```bash
(cd "$DSH_HOME/profiles/web" && pnpm install --frozen-lockfile)
DINGTALK_CLIENT_ID='' DINGTALK_CLIENT_SECRET='' node --env-file=.env.local --import tsx/esm apps/cli/src/bin.ts web --no-open
```

This command runs the Web demo without connecting the shared DingTalk robot. Coordinate stopping the original robot service before removing the two empty environment variables for integration testing. Open the token URL printed by the terminal; use the new URL after a restart. `pnpm dev:web` only watches frontend builds and does not replace the Web server.

Add the extracted `sample` as a workspace in the browser. Old sessions retain original absolute paths; create a new demo session with the recipient's local sample directory rather than using historical cards as portable file links. When tables need review, the agent should invoke Univer to open the existing file.

<a id="capabilities"></a>
## Capabilities and checklist

| Module | Delivery status | Capabilities and limitations |
|---|---|---|
| Hongyang UI and isolation | Local startup verified | Hongyang branding, sample workspace, separate DSH_HOME; avoid the default directory |
| Import and settlement splitting | Smoke passed | Merchants, receivables, bank, WeChat, POS, recharge, ledger, and voucher reference import; 19 settlements matched, 3 unmatched |
| Queries and claims | Implemented | Receivables, merchant balance, overdue, and daily receipts; pending claims and fee allocation; do not infer POS ownership from amount alone |
| Daily reports and sheets | Implemented and shown locally | April 3 report: 12 rows, 60,885.18 yuan; ledger differences remain; Univer installed, automatic opening and cross-machine paths need rehearsal |
| Vouchers | Generation available, final acceptance pending | Persistent reference has 9 rows; latest generated voucher has 35 balanced rows, 6 matches, 32 differences, and 3 unresolved subject rows; difference causes are not fully classified |
| Account rules | Some client confirmations recorded | Rent 2203.01.01, service 2203.01.02, electricity advances 2203.30, water advances 2203.31; 13%/3% output VAT 2221.01.02.13 / 2221.01.02.03; parking and other subaccounts still need verification |
| Payment registration | Text implemented | Image provider validates payee, amount, and date; Web image parameters and robot vision client are not wired into the actual startup entry |
| DingTalk | Stream connection verified | Drafts, delivery deduplication, and card instances persist in dingtalk.db, so restarts do not post twice; interactive card delivery and button callbacks are wired but phone acceptance is pending; platform transaction merging and multiple-fee splitting remain |

Financial providers must perform all monetary calculations; the model selects tools and explains results. Passing tests does not establish customer voucher acceptance; do not edit the source reference to eliminate differences.

<a id="structure"></a>
## Project structure

```text
apps/cli/                         dsh launcher
apps/web/                         Web frontend
packages/bundle/web-app/           Web plugin composition
packages/hongyang/finance/src/
  service/                        Finance service and database lifecycle
  provider/                       Import, split, claim, query, register, report, voucher
  rules/                          Fee, account, tax, and money rules
  tools/                          finance_* tools
  client/                         Settings and finance cards
packages/hongyang/dingtalk/src/    Stream, reply bridge, image adapters
docs/hongyang/                    Requirements, design, handoff, samples
demo/                            Sample archive and configuration template
```

The call path is “Web/DingTalk → tools or bridge → HyFinanceService → provider → SQLite/Excel”; Univer handles visual review. The private profile contains installation manifests for the marketplace, Univer, and ChatVoice.

<a id="demo"></a>
## Demo sequence

1. In a new session, ask: “Show the current finance database status and unresolved items.”
2. Ask: “Query receivables and registered payments for 围辣转转火锅, using tool results.”
3. Ask: “Generate the 2026-04-03 daily income report and automatically open it in Univer.”
4. Ask: “Generate the 2026-04-03 voucher, compare customer voucher_row, show detailed differences, and open the sheet in Univer.”
5. Explain that unclassified differences remain; test text registration only in a demo copy, preserving the source database. Do not present image registration or robot replies as accepted features.

Regression command: `node --import tsx/esm packages/hongyang/finance/tests/import.smoke.ts`. Fixed-sample baseline: 318 merchants, 3203 receivables, 19 matched and 3 unmatched settlements; smoke uses an isolated database.

<a id="dev-note"></a>
## Dev Note

Development priority: trace voucher differences and unresolved accounts → rehearse cross-machine Univer review → wire image registration end to end → implement durable DingTalk deduplication and sessions → phone acceptance. Deployment configuration takes precedence over demo prompts; never ask the model to invent account codes or calculate money.

Delivery checks: all 20 sample content files passed byte-for-byte comparison, the database snapshot passed integrity_check, import smoke passed, and the new bilingual document pair passed validation. Full `pnpm lint` failed on 10 existing finance type-lint findings in settings-card, identifiers, config, read-sheet, status, claim, and webServer/plugin; this handoff preparation did not modify those source files.
