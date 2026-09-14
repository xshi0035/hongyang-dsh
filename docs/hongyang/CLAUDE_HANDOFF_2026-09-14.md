---
description: "Local development state and Claude takeover steps for the Hongyang AI finance assistant."
kind: "reference"
---

# Hongyang AI finance assistant: development handoff to Claude

English | [中文](CLAUDE_HANDOFF_2026-09-14.zh.md)

Date: 2026-09-14. Working directory: `/Users/shixin/Desktop/广场dsh/deepseek-harness`. Branch: `test`. This is a snapshot of the machine and working tree; [HANDOFF.md](HANDOFF.md) contains earlier background and plans, some of which are stale. Read this document, [spec.md](spec.md), [design.md](design.md), [DEMO_DELIVERY.md](DEMO_DELIVERY.md), and both package READMEs. Root, `packages/`, and `docs/` instructions in `AGENTS.md` also apply.

## First task for Claude

Connect to Steven's machine and open this repository. Check `git status`, the `test` branch, `packages/hongyang/dingtalk/src/`, and the finance registration provider. Take over and restart **DSH Web and its DingTalk Stream plugin**. Do not start Electron or treat `pnpm dev:web` as the backend. Stop only a verified repository process on port 3080, so two Stream clients do not serve the same robot. Obtain credentials from secure local configuration or Steven's terminal input; never display a Secret in chat, logs, documents, or Git. Confirm the token URL after `dsh web:` and `hy-dingtalk: Stream connected`. Then diagnose card delivery, connect confirm/cancel callbacks and persistent deduplication, and verify the September 14 CNY 200 test registration. Run relevant tests for each change and import smoke for finance provider changes. Do not automatically push Git or commit the local card setup drafts.

## Implemented capabilities and verification evidence

- The independent Hongyang DSH profile and Web UI, sample imports, merchant and receivable queries, bank/WeChat/POS settlement allocation, claims, daily reports, voucher drafts, and spreadsheet exports exist. Web starts locally; see [DEMO_DELIVERY.md](DEMO_DELIVERY.md). Deterministic code in `packages/hongyang/finance/src/provider/` owns amounts, taxes, allocations, and voucher rows; models must not calculate or post money directly.
- The April 3, 2026 daily-report smoke generates 12 rows totaling CNY 60,885.18, against 14 customer rows totaling CNY 63,679.60. Comparison finds 10 matches, 3 missing rows, 1 extra row, and 1 amount discrepancy. The 11 matches and zero amount discrepancies in [HANDOFF.md](HANDOFF.md) section 7 do not describe current output. Do not rewrite customer baselines to make tests pass.
- The DingTalk internal application and robot are published, and Stream connectivity has worked locally. The published merchant-confirmation template ID is `43d96452-6c82-4384-850f-f33219110556.schema`. Variables are rich text `content`, text `summary`, and object-array `merchantList`, whose fields are `shopNo`, `name`, `brand`, and `displayName`. Each candidate button returns `action=confirm` and `shopNo`; the independent cancel button returns `action=cancel`. Card delivery to an actual DingTalk client remains unsuccessful.
- Text messages “电费 200”, followed by “作业帮”, share a draft and resolve merchant candidates for text confirmation. The database brand is “作业帮/小天才/优学派”; splitting its aliases matches shop `3F-3032`. Drafts live only in the `bridge.ts` Map, expire after 30 minutes, and disappear on restart. This is not general persistent agent memory.
- A September 14 “确认 3F-3032” **actually wrote** to `$DSH_HOME/hongyang/finance.db`. Transaction `txn_mu0xvt00m16yx2gm` has `source=dingtalk`, `amount=20000` cents, `status=manual`, and `merchant_id=mch_mtwx8ofj4w8wo9qn`. Allocation `alc_mu0xvt05vl4pq0bp` has `fee_type=elec_post`, inclusive amount 20000 cents, tax rate 0.13, tax amount 2301 cents, and no `receivable_id`. No formal voucher or merger with an original bank/POS transaction has been verified. Four earlier DingTalk test transactions remain pending; inspect their origin and effects before cleaning them.
- For April 3, the persistent database has 9 customer reference rows in `voucher_row` and zero rows in `voucher`. An earlier draft produced 35 balanced lines, but scope alignment and row comparison against the 9 customer rows remain unaccepted. See [DEMO_DELIVERY.md](DEMO_DELIVERY.md) for the earlier report and voucher status.

## Code and Git state

The handoff commit is based on `f33242ffd7 feat(hongyang): add interactive card sender` and contains this document and changes to the following files. Check current Git state before taking over and preserve later local edits rather than resetting them:

- `packages/hongyang/dingtalk/src/types.ts`: `DingtalkReply.card`, optional `sendCard`, and optional `callbackRouteKey`.
- `packages/hongyang/dingtalk/src/stream-client.ts`: requests use `card/instances/createAndDeliver` instead of `im/interactiveCards/send`; non-2xx responses are logged and failures fall back to text.
- `packages/hongyang/dingtalk/src/bridge.ts`: candidates, a configured `DINGTALK_CARD_TEMPLATE_ID`, and a capable Stream client produce card data; `merchantList` is JSON-encoded and `displayName` uses `brand || name`.
- `packages/hongyang/finance/src/provider/register/conversation.ts`: composite brand aliases let “作业帮” match “作业帮/小天才/优学派”.

The three untracked files `docs/hongyang/DINGTALK_CARD_SETUP.md`, `.zh.md`, and `.i18n.yaml` are local instructions for the card editor. Steven explicitly requires keeping them out of Git. He authorized this handoff push to his `origin/test` (`xshi0035/hongyang-dsh`); ask before later commits or pushes. Do not switch to the older `hongyang-demo` branch.

## Unresolved work in priority order

1. **Interactive card delivery.** Actual clients receive candidate text fallback. The sender calls `POST https://api.dingtalk.com/v1.0/card/instances/createAndDeliver` with a flat `robotCode`, while the supplied platform SDK example uses `imRobotOpenSpaceModel`, `imRobotOpenDeliverModel`, `openSpaceId=dtv1.card//im_robot.${userId}`, `userIdType=1`, and `callbackType=STREAM`. Verify the request against that example or use the SDK. Only non-2xx delivery responses currently produce `card send failed`; token and network failures may be swallowed, so absent logs do not prove no attempt occurred. Text fallback is not card acceptance.
2. **Card callbacks do not register payments.** `stream-client.ts` registers `TOPIC_CARD` and exposes `onCard`, but `createFinanceDingtalkBridge` does not subscribe with `stream.onCard(...)`. Parse actual callback data, validate `action/shopNo` and the sender against a live draft, submit only once, and return a visible result. Test real callbacks and replays.
3. **Memory and idempotency after restart.** Drafts and inbound message-ID deduplication are in memory. Restart loses them, and repeated confirmation may duplicate transactions and allocations. Persist associations and idempotency keys, prevent concurrent Stream instances for the robot, and never infer the original bank/POS transaction from amount alone.
4. **Payment images do not join confirmation.** Without Vision or a downloaded image, `bridge.ts` returns an image-configuration prompt. Even a Vision result does not merge into the draft. Provider image validation exists, but host startup does not connect a verified end-to-end image path.
5. **Text parsing and merchant display.** `displayName=brand || name` displays the complete composite brand; the legal merchant name here is “周军伟”. Confirmation needs a name, shop, and fee sufficient to distinguish the payer. A literal “确认 编号” must prompt for the actual shop code. Multiple amounts, fees, matching brands, or legal entities require human confirmation.
6. **Financial acceptance.** April 3 vouchers still differ from the customer `voucher_row` baseline. Parking top-ups, UONE, the 发发桌球 entity, date semantics, and unclaimed POS amounts need evidence-based reconciliation. The customer confirmed 13% electricity and 3% water output-tax rules and some advance-receipt accounts; consult finance rules and [DEMO_DELIVERY.md](DEMO_DELIVERY.md). Models must not invent unresolved accounts. The agent should open Univer when spreadsheet review is needed.

## Local startup: DSH Web and DingTalk together

At inspection, the repository command `node --import tsx/esm apps/cli/src/bin.ts web --no-open` listened on `127.0.0.1:3080`; its PID is transient. Run `lsof -nP -iTCP:3080 -sTCP:LISTEN`, then verify the process with `ps -p <PID> -o pid=,ppid=,command=` and `lsof -a -p <PID> -d cwd -Fn`. Send `SIGTERM` only to the confirmed repository process and wait for the port to become free. Do not kill other projects' Node processes. Existing shell credentials do not automatically transfer into Claude's new shell.

```bash
cd "/Users/shixin/Desktop/广场dsh/deepseek-harness"
export PATH="/opt/homebrew/bin:$PATH"
export DSH_HOME="/Users/shixin/.dsh-hongyang"
export DINGTALK_CARD_TEMPLATE_ID="43d96452-6c82-4384-850f-f33219110556.schema"
# Load DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET securely in this shell.
# If unavailable, ask Steven to enter them in the terminal; never print or commit them.
pnpm dsh web --no-open
```

`dingtalkConfigFromEnv()` reads the current process's `DINGTALK_CLIENT_ID` and `DINGTALK_CLIENT_SECRET`. Startup must show `hy-dingtalk: finance service ready; starting Stream`, `dsh web: http://127.0.0.1:3080/?token=...`, and `hy-dingtalk: Stream connected`. Open **the complete token URL from this startup** rather than an old token. `pnpm dev:web` builds the frontend and `pnpm start:desktop` starts Electron; neither is this DSH Web host. The card template and robot application are already published, so no further developer-console publish action is required.

## Validation and delivery requirements

- The pre-push repairs cover explicit service return types, exported JSDoc, package aliases and classification, generated catalogs, bilingual documentation, and compilable documentation examples. `pnpm run test:docs` passed 16/16 checks and `pnpm run doc-sync` passed 34/34 checks on the staged delivery contents. The three untracked card-setup drafts were temporarily isolated and restored byte-for-byte; they are not part of the push. These results do not establish successful DingTalk card delivery or financial acceptance.
- Verified on September 14 after the repairs: `pnpm run lint` passed; `node --import tsx/esm --test packages/hongyang/dingtalk/tests/*.test.ts packages/hongyang/finance/tests/*.test.ts` passed 16/16; `node node_modules/typescript/bin/tsc -b packages/hongyang/finance/tsconfig.client.json` passed; `node --import tsx/esm packages/hongyang/finance/tests/import.smoke.ts` passed. Smoke uses an isolated database whose random IDs must not be compared with persistent IDs. The April 3 financial discrepancies above remain unchanged.
- Integration testing follows “电费 200” → “作业帮” → receive a card → confirm actual shop `3F-3032`. Also test cancellation, repeated clicks, and restart/replay. Compare persistent row counts before and after confirmation and inspect `transaction` and `allocation`; robot text alone does not prove registration. Tests may write monetary records into the demo database, so prefer an isolated copy or clearly marked records.
- These read-only queries inspect the registered CNY 200 payment. SQLite amounts use cents: `20000` means CNY 200.00.

```bash
sqlite3 "$DSH_HOME/hongyang/finance.db" \
  "select id,txn_time,amount,merchant_id,status,raw from \"transaction\" where id='txn_mu0xvt00m16yx2gm';"
sqlite3 "$DSH_HOME/hongyang/finance.db" \
  "select id,transaction_id,fee_type,amount_incl_tax,tax_rate,tax_amount,receivable_id from allocation where transaction_id='txn_mu0xvt00m16yx2gm';"
```

- Fix card delivery and callbacks before asking Steven for more real-device tests. Report what changed, the next step, and remaining problems, addressing him as **steven**. Never commit or push Client Secrets, DSH tokens, raw customer data, or private local bundles.
