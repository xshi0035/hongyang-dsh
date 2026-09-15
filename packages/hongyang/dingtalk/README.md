---
description: "DingTalk text and payment-image adapters for the Hongyang finance provider."
kind: "package-bundle"
---

# @deepseek-ai/dsh-hy-dingtalk

English | [中文](README.zh.md)

## Summary

Users can report payments by text or screenshot through DingTalk, supply a merchant and fee in later messages, and submit them for workbench review by text or interactive card. Screenshot amounts remain candidates until confirmation. The host needs robot credentials and a configured vision route for screenshots; phone acceptance of the final workbench approval flow remains outstanding. The empty bundle patch alone activates no listener.

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

Text collection uses read-only provider preview: send “电费200”, then a merchant name, then “确认 ” followed by the actual shop number shown in the candidates. The bridge keeps one draft per conversation/user for 30 minutes, shows database candidates, and submits to the workbench only on an exact valid confirmation. Cancellation and expiry discard the draft without writing; failed confirmation keeps it for retry. Repeating confirmation after success does not write again. This is bounded text matching, not general LLM language understanding. Drafts, inbound delivery ids, and card instances persist in `dingtalk.db` next to the finance database, with one Stream owner per store and an idempotent finance submission keyed by draft id. When `DINGTALK_CARD_TEMPLATE_ID` names the published template, a ready draft with candidates is delivered as an interactive card whose confirm and cancel buttons resolve that draft exactly once; a stale card, another user's click, or a failed delivery falls back to the text path. Screenshot extraction enters the same durable draft without creating a transaction. The finance provider validates the configured payee, positive amount and payment time, retains the transaction number, and labels the amount as a candidate for human review. Text can supply the merchant and fee before or after the screenshot; conflicting amounts reject without replacing the draft. Cancel before replacing a screenshot or correcting its amount. A message received during extraction invalidates that extraction result; resend the screenshot against the current draft.

DingTalk confirmation stores a `payment_submission` in the finance database without creating a financial transaction or allocation. The DSH workbench lists pending submissions across all dates and offers “确认入账” and “驳回”. Only workbench approval books money; rejection retains the audit record without booking. Submitted cards direct the user to the workbench and leave `summary` empty to avoid duplicated text. The template can still display its cancel control after submission; replaying that control returns the settled submission outcome. See the [approval decision](../../../.agents/notes/implemented/architecture/2026-09-15-hongyang-workbench-approval.md).

Duplicate transaction references are checked during preview and again when submitting. A registered payment or an existing pending review produces an explicit message without adding another submission. Duplicate drafts settle and clear; same-draft retries return the stored workbench outcome. Matching uses a nonempty exact transaction reference, never amount or merchant alone.

### Profile activation

The manifest declares a bundle, but [cordis.patch.yml](cordis.patch.yml) contains an empty patch list. Installing that layer alone does not mount the exported bridge plugin. The Hongyang host composition must explicitly load the package; the [current handoff](../../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.md) owns the verified local startup. The [entry point](src/index.ts) waits for the finance service and reads credentials from the host process.

Set both `visionProvider` and `visionModel` in the plugin configuration, or supply `DINGTALK_VISION_PROVIDER` and `DINGTALK_VISION_MODEL` to an image-capable route already registered with the host LLM service. The host must also load an attachment provider. Setting only one route value fails activation; leaving both unset keeps text confirmation available and reports that screenshot recognition is not configured. The entry connects the authenticated robot image downloader and the host vision adapter. Nonempty plugin configuration fields take precedence over environment values. No provider or model is guessed.

### Prepare the robot in DingTalk

1. Sign in to the DingTalk developer console and select the test organization. Create an enterprise internal application.
2. Under application capabilities, add and enable a robot. Select **Stream** as the message receiving mode, then publish the robot configuration.
3. Create and publish an application version. Include the testing operator in its available range.
4. Keep the Client ID (AppKey) and Client Secret (AppSecret) from the credentials page locally. Do not commit them or paste the Secret into chat.
5. Prepare the deployment environment values `DINGTALK_CLIENT_ID` and `DINGTALK_CLIENT_SECRET`, plus `DINGTALK_CARD_TEMPLATE_ID` (and `DINGTALK_CARD_ROUTE_KEY` when the template publishes one) for interactive cards. The helper reads them only from the host process; setting them does not activate the listener. Leave SDK debug logging disabled during credential handling.
6. After host integration, test text, picture, invalid payee, and missing merchant cases with the operator's phone. Capture error codes without tokens if an API permission is missing.

The official [robot creation guide](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/java/create-bot/) describes application creation and publication. No live DingTalk connection is implied by local tests.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [bridge](src/bridge.ts) keeps bounded conversation drafts and calls read-only preview and validated submission on the finance service. Provider code owns amounts, fee labels, merchant lookup, and writes. Images do not bypass confirmation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

See the [finance service](../finance/src/service/finance-service.ts) and the [image registration decision](../../../.agents/notes/implemented/architecture/2026-09-12-hongyang-image-registration.md).

<a id="model-experience"></a>
## Model Experience

### Payment image extraction

#### What the model sees

The vision adapter sends an image and a text hint through an explicitly supplied provider/model route. It requests JSON fields including `amountText` and `payee`, without calculating amounts. Registration replies are formatted by the finance provider.

#### Token effect

Each image invokes one auxiliary LLM request with a 512-token output cap. Local mock tests do not establish model availability, actual token use, cost, or latency.

#### KV Cache effect

Image attachments and hints vary with the receipt. No cache reuse is guaranteed or measured by the local tests.

## Known Limitations and Deferred Work

- The Cordis entry connects image download and extraction when configured. Loader composition tests cover the entry with real finance, attachment and LLM services, substituting only network endpoints and model output. Phone acceptance of screenshot extraction remains required.
- The web `finance_register` tool still supports text only; its image parameter is not connected to this bridge.
- Screenshot registration does not merge platform transactions or split multiple fee amounts. These remain required before full HANDOFF step 6/7 acceptance.
- Transport callback routing, download authorization, and retry behavior require a separate protocol-level audit; downloader mock success is not proof of a real API connection.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

No invariant companion is published: the bridge owns no independently observable registry. Provider/database tests verify writes and Loader composition pins the user-visible image card under `tests/expected/`; this flow does not create a harness Session. Real API and phone tests are still required.

</details>
