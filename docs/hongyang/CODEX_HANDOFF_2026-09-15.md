---
description: "Hongyang AI finance assistant: local development state on 2026-09-15 and the Codex takeover steps."
kind: "reference"
---

# Hongyang AI Finance Assistant: current state handed to Codex

English | [中文](CODEX_HANDOFF_2026-09-15.zh.md)

Date: 2026-09-15. Working directory: `/Users/shixin/Desktop/广场dsh/deepseek-harness`. Branch `test`, with acceptance changes based on commit `b288833c17`. This document records the September 15 acceptance snapshot; the Git log and remote branch are authoritative for commit and push status. Read this first, then [CLAUDE_HANDOFF_2026-09-14.md](CLAUDE_HANDOFF_2026-09-14.md) (credentials, startup, finance rules, the April 3 baseline). Address every reply to **steven**; never show the Client Secret or a DSH token in chat, logs, docs, or Git.

## Current acceptance status (takes precedence over historical notes below)

Demonstration and acceptance use 3081; 3080 is for development only. The 3081 database is schema 5 with 53 transactions and 796 allocations, and DingTalk Stream is connected. Relative to the 49/788 baseline, only the explicitly marked TEST-REVIEW CNY 2.15 and CNY 2.17 synthetic bookings and full reversals were added: four transactions and eight allocations with a net amount of zero. Original business transactions, merchant masters and customer samples remain. Backups and evidence are in `交付验收-2026-09-15` one directory above the repository.

Xiaomi's CNY 2,000 was manually assigned to prepaid electricity for 1F-1011 with a confirmed exact payer mapping. AOKANG's rent/service split and period retain the human basis and before/after audit. The explicitly labelled CNY 1,000 POS receipt is parking. Jie Parking's CNY 1,502.58 belongs to April 1, retaining its April 3 arrival timestamp and review annotation. The database actually contains 28 customer ledger rows for April 1; this reference is retained for comparison.

The April 3 report matches 12 of the customer's 14 rows and totals CNY 61,383.83. Business gaps are POS ownership for parking recharge CNY 750 and UONE CNY 1,547. The historical TEST-REVIEW CNY 1.23 synthetic payment is an extra row retained as test evidence. Do not infer ownership from amounts or describe full-day reconciliation as complete.

The workbench now supports receipt selection, full-day coverage, download and reasoned draft withdrawal; the tool also requires explicit selection. AOKANG's real-database preview matches all seven lines. UONE account 2241.12 is implemented, but missing order ownership prevents complete nine-line customer acceptance. Browser checks covered TEST-REVIEW draft generation, download and withdrawal. Downloaded bytes matched the export; financial counts stayed unchanged, the draft and withdrawal audit remain, and all receipts returned to the pending queue.

All 57 finance/DingTalk tests passed. Following the final revision, the seven targeted fee/reversal and workbench tests, host and client TypeScript, finance lint, bundling and exported JSDoc checks passed. Implemented behavior covers human fee-split approval, reasoned and dated full DingTalk registration reversal, retained originals and audit, active-draft blocking and idempotent retries. Authenticated 3081 HTTP acceptance verified rent CNY 1.09 plus service CNY 1.06, full reversal, zero net amount and rejection of unequal totals. After computer control recovered, browser actions selected the fee split, approved CNY 2.17 (rent 1.09 plus service 1.08), entered a reason and confirmed full reversal. The page showed reversed status, original and negative entries, zero net amount and no pending submissions. Registration rows distinguish reversed originals from reversal entries. The final backup is `多费项与冲正浏览器验收后-3081.db`, with integrity check ok.

The user reports that the complete rehearsal and cross-channel deduplication were tested; retain that user acceptance instead of requesting repetition. This turn did not add or re-audit cross-channel merging code. Parking CNY 750 and UONE CNY 1,547 remain unclaimed. The source/build snapshot, finance and DingTalk database backups, and demonstration guide are saved. Scheduled daily reports are in the post-demonstration reminder and remain unconfigured. Partial reversal, bank/POS reversal, rebooking a reversed reference, external posting and refunds are outside this first version. Task-board versus scheduler evaluation is deferred without removal. The `test` branch log records publication status.

## Done today and verified on a real DingTalk client

1. **DingTalk submission → workbench approval**. Merchant confirmation in DingTalk persists a review submission without financial rows. The workbench lists all pending submissions across dates; approval atomically books the transaction/allocation and audit, while rejection does not book. The isolated 3081 profile runs this build with Stream connected. Provider and Loader tests pass; browser acceptance verifies approval and rejection with synthetic payments. Next: Steven sends a new test payment through DingTalk and verifies the final phone → pending workbench → approval flow. Changes remain uncommitted and unpushed.
2. **Card template**: code leaves `summary` empty so body text appears once. A settled template may retain its cancel control; clicking it only returns the stored outcome and does not reverse a workbench decision. Template-level button hiding remains optional display cleanup.
3. **Durable state and idempotency.** New `src/store.ts` keeps drafts, inbound `msgId` deduplication, and card instances in `$DSH_HOME/hongyang/dingtalk.db` (WAL, busy_timeout); restarts and two Stream workers cannot double-book.
4. **Finance workbench** (`packages/hongyang/finance`). Host: `activity_log` table (`provider/activity/log.ts`, local day in Asia/Shanghai); `registerPayment`/`confirmPayment`/`confirmClaim`/`runClaims`/`learnPayer`/`buildDailyReport`/`buildVoucher`/`importFile` take a trailing optional `actor` and each records one audit row; `workbench(date)` summary (`provider/query/workbench.ts`); route `GET /api/hy-finance/workbench?date=`; `registerTodoProvider` lets the DingTalk plugin contribute "drafts awaiting confirmation". Client: `client/WorkbenchPanel.tsx` registers the "财务工作台" entry through the official `main` + `sidebar.panellist` slots with tiles, to-dos (buttons send a prompt to the current session and return to the conversation), today's registrations, receipts by source, the audit trail, and a date switch. Verified in the local browser against real data.
5. **Test rows removed.** The 10 DingTalk test payments of 200 yuan (Sep 13–15) and their allocations were deleted; the pre-deletion CSV backup lived in Claude's scratchpad (temporary, may be gone). `transaction` now has 47 rows, `allocation` 785.

## Verification (run on 2026-09-15)

- `node --import tsx/esm --test packages/hongyang/finance/tests/*.test.ts packages/hongyang/dingtalk/tests/*.test.ts`: 31/31 pass (new `finance/tests/workbench.test.ts`, `dingtalk/tests/store.test.ts`, `dingtalk/tests/card.test.ts`).
- `tsc -b` for finance host/client and dingtalk passes; `tsx scripts/run-oxlint.ts packages/hongyang/finance packages/hongyang/dingtalk` reports nothing.
- `pnpm run test:docs` 15/16 and `pnpm run doc-sync` 33/34: the only failure is the bilingual pairing of the three untracked `docs/hongyang/DINGTALK_CARD_SETUP*` drafts, expected (Steven keeps them uncommitted).
- `scripts/verify-client-ui-i18n.ts` lists 31 hard-coded strings, all in the pre-existing `FinanceToolViews.tsx`/`PendingClaimsCard.tsx`/`VoucherCard.tsx`/`settings-card.ts`; none in today's files.

## Local startup and builds

- The original 3080 host has no DingTalk credentials. The connected acceptance host runs on 3081 under `/Users/shixin/.dsh-hongyang-acceptance/image-nv7prc8f`; use that workbench and its existing Stream owner. The local launcher uses hidden credential entry when credentials are unavailable. Do not enable another Stream instance on 3080.
- After changing finance: `node node_modules/typescript/bin/tsc -b packages/hongyang/finance/tsconfig.host.json packages/hongyang/finance/tsconfig.client.json` → `pnpm --filter @deepseek-ai/dsh-hy-finance run bundle` (emits both `lib/index.js` and `lib/client.js`) → restart web. The web shell was rebuilt once today with `pnpm run build:web`.
- After changing dingtalk: `tsc -b packages/hongyang/dingtalk/tsconfig.json` → `pnpm --filter @deepseek-ai/dsh-hy-dingtalk run bundle` → **must** sync `rsync -a --delete packages/hongyang/dingtalk/lib/ /Users/shixin/.dsh-hongyang-acceptance/image-nv7prc8f/profiles/web/node_modules/@deepseek-ai/dsh-hy-dingtalk/lib/` (the profile holds a stale `file:` copy). `cordis.patch.yml` was added to that package's `files` today.
- macOS has no `timeout`; use `perl -e 'alarm N; exec @ARGV'`.

## Open items and next steps, by priority

1. **DingTalk submission → workbench approval**. Merchant confirmation in DingTalk persists a review submission without financial rows. The workbench lists all pending submissions across dates; approval atomically books the transaction/allocation and audit, while rejection does not book. The isolated 3081 profile runs this build with Stream connected. Provider and Loader tests pass; browser acceptance verifies approval and rejection with synthetic payments. Next: Steven sends a new test payment through DingTalk and verifies the final phone → pending workbench → approval flow. Changes remain uncommitted and unpushed.
2. **Card template**: code leaves `summary` empty so body text appears once. A settled template may retain its cancel control; clicking it only returns the stored outcome and does not reverse a workbench decision. Template-level button hiding remains optional display cleanup.
3. **Workbench**: the audit table is new, so history is empty; `todayReceipts` source labels are mapped; candidates for later are click-through from today's registrations and an audit xlsx export. Tool calls currently record actor `tool`; pass the session id from `tools/definitions` if per-session attribution is wanted.
4. **Marketplace plugin** `@linxin666/dsh-client-ui-task-board` is installed in the web profile (sidebar "任务看板"); evaluated as a generic agent board, not a finance fit; remove it before delivery with `dsh plugin --profile web remove` (it sends a daily heartbeat to dsh-market.com).
5. **Finance acceptance** untouched: the April 3 report matches 10/14 (3 missing, 1 extra, 1 amount), the voucher is not aligned line by line with the client's 9 reference rows; never edit the client baseline to pass tests.
6. `pnpm-lock.yaml` carries an incidental `@testing-library/dom` 10.4.1→10.4.2 bump from pnpm; keep only the finance workspace link changes when committing.

## Codex image acceptance environment

The isolated directory is `/Users/shixin/.dsh-hongyang-acceptance/image-nv7prc8f`, with Web on port 3081; the original 3080 service remains running without DingTalk credentials. The acceptance profile loads only base, web-app and DingTalk, with the current DingTalk build synchronized. SQLite online backup supplies the finance copy; both original and copy contain 47 transactions and 785 allocations. `openai / gpt-6-astra` passes a real API synthetic-image test: 200.00 yuan, the configured payee, full payment timestamp and transaction reference are extracted correctly, and finance read-only preview passes without payment writes. `启动图片验收.command` in that directory reads DingTalk Client ID/Secret through hidden Terminal input without saving them; at 16:33 on 2026-09-15, Steven completes Stream → real phone payment-photo recognition → merchant/fee supplementation → card confirmation. The acceptance database adds exactly one 200-yuan transaction and one allocation, reaching 48/786; the original stays at 47/785. The card is confirmed and no draft remains. Phone replay, cancellation and confirmation after restart still need verification. Duplicate card text and the remaining cancel button after registration are presentation issues; this run contains no duplicate registration. `synthetic-receipt.png` is explicitly marked as a simulated screenshot; send it and then “作业帮 电费”. DingTalk confirmation must leave financial counts unchanged; only subsequent workbench approval increases transactions and allocations by one. Probe results are in `vision-result.json`; redacted logs are in `server.log`.

### Workbench approval acceptance

On 2026-09-15 the isolated host restarts on schema version 3 after an online backup at `hongyang/before-workbench-review.db`. Two synthetic submissions (1.23 and 4.56 yuan, clearly labeled TEST-REVIEW) appear under pending reviews while counts remain 48 transactions / 786 allocations. Browser approval of 1.23 yuan creates exactly one transaction/allocation; rejection of 4.56 yuan creates neither. Pending reviews end at zero, with web audit entries for both decisions. Acceptance counts are 49/787; the original database remains 47/785. The earlier 200-yuan phone record remains unchanged. Do not run a second Stream owner or reset the database to remove this history. The 3080 original page has not received this runtime update; use 3081 for acceptance.

## Commit suggestion

Two commits: `feat(hongyang): deliver dingtalk cards with durable drafts and callbacks` (dingtalk package + README + DEMO_DELIVERY) and `feat(hongyang): add finance workbench with activity log` (finance package). Run the tests, lint, and `pnpm run test:docs` first; leave the three `DINGTALK_CARD_SETUP*` drafts out; ask Steven before pushing.

### Verification of workbench approval

42 focused tests pass (41 finance/DingTalk tests plus the added interrupted-card recovery test). Host TypeScript, finance client TypeScript, scoped lint, bundles and the existing isolated import smoke pass. Browser approval/rejection and unauthenticated HTTP rejection (401) pass. Documentation checks pass 33/34; the only failure is the pre-existing translation pairing mismatch in the untouched `DINGTALK_CARD_SETUP` drafts.

### Exact-reference duplicate prevention

The connected 3081 acceptance host checks exact nonempty transaction references during preview, submission and approval. Existing registrations and earlier pending submissions produce an explicit duplicate message without another queue row. The workbench exposes a duplicate warning and disables approval for legacy duplicate queue rows; rejection remains available. Rejected references may be submitted again when no financial transaction exists. Equal amounts or merchants without a reference are not treated as duplicates. Same-draft retries preserve the terminal workbench outcome.

All 46 focused tests pass, including the Loader repeated-image reply expectation; scoped lint, host/client TypeScript and bundles pass. The isolated host restarted after backing up to `hongyang/before-duplicate-check.db`. Browser verification shows the earlier repeated 200-yuan submission was rejected at 17:06:49, leaving zero pending submissions and today's total at 201.23 yuan. Acceptance counts stay 49/787; original counts stay 47/785. No financial rows were created or removed by this change. Next phone check: resend that screenshot and expect the already-recorded message when its transaction reference is recognized, then use a different test payment to verify approval.

### Rejection and prior-registration wording

Duplicate replies distinguish the latest rejected application from the original effective registration. For the real 200-yuan acceptance reference, the reply names the rejected application and the original registration at 2026-09-15 16:33:55 (Beijing time), explaining that rejection did not reverse that registration. Time comes from registration audit records or allocation creation, never the screenshot payment timestamp; unknown time is omitted. Twenty focused submission, bridge and Loader tests pass, with the timed reply pinned in the package expectation. The updated finance bundle runs in the connected 3081 host. Financial counts remain 49/787 in acceptance and 47/785 in the original database.

## Settled business decisions (2026-09-15, confirmed by Steven)

- The 2,000 yuan from "衡阳欣飞" belongs to shop 1011 (小米) as prepaid electricity; the bank account name differs from the contracting party, so after one human confirmation it is written to `payer_mapping` (confirmed=1) while merchant master data keeps "衡阳讯飞"; no fuzzy-name auto-learning.
- The 1,502.58 yuan parking settlement is reported on the business day 2026-04-01 taken from the bank remark; the April 3 report excludes it, the arrival date stays as the transaction time, and the comparison marks it "pending finance review" instead of deleting it.
- The 750 yuan parking top-up and the 1,547 yuan UONE amount have no POS order attribution, so they stay pending and are never matched by amount; the 1,000 yuan "发发桌球停车（预存）" POS order is attributed to parking top-up by its remark.
- Vouchers are built per selected receipts: this round selects 奥康 + UONE to accept the client's 9 rows; 奥康 rent 21,918.60 / service 33,825.00 for 2026-03-01 to 2026-05-31 is a documented manual allocation with an audit row; UONE is booked to other payables 2241.12, not income; other receipts go to a "to be vouchered" list while whole-day coverage statistics are kept.
- Demo and acceptance run on 3081 (`/Users/shixin/.dsh-hongyang-acceptance/image-nv7prc8f`); 3080 is development only.
