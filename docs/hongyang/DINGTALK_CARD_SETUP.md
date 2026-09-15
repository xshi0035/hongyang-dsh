---
description: "Configure the DingTalk payment card and connect it to Hongyang workbench review."
kind: "reference"
---

# Hongyang DingTalk Payment Card Setup

English | [中文](DINGTALK_CARD_SETUP.zh.md)

## Summary

This guide defines the template variables, button callbacks, and runtime settings used by the `test` branch. A DingTalk confirmation submits a payment for review; a reviewer must confirm it in the DSH finance workbench before it is booked. These Markdown files and their `.i18n.yaml` consistency record are documentation, not an importable DingTalk template or a runtime profile.

## Contents

- [Prerequisites and startup](#startup)
- [Template variables](#variables)
- [Button callbacks](#callbacks)
- [Publish and configure](#configure)
- [Verify and troubleshoot](#verify)

<a id="startup"></a>
## Prerequisites and startup

Use a published internal DingTalk application with its robot enabled in Stream mode and the operators included in its availability scope. The host must explicitly load the Hongyang finance and DingTalk plugins; installing the DingTalk bundle alone does not start its listener. See [profile activation](../../packages/hongyang/dingtalk/README.md#use-this-package).

Clone the current branch with `git clone --branch test https://github.com/xshi0035/hongyang-dsh.git`. Follow the [delivery startup instructions](DEMO_DELIVERY.md#startup) for dependency installation and the separately supplied runtime profile. Its offline bundle is an alternative to the online clone. The delivery page's capability table is a dated September 13 snapshot, not current acceptance evidence.

Git does not supply working credentials, your published template, or the private runtime directory. To reproduce the prepared demonstration, obtain its private profile and database backup separately and adapt paths to your computer. Merely cloning the repository and setting the variables below does not provision the profile, finance data, or model provider. A complete cold start on a colleague's machine still requires verification.

Use your own test robot for parallel development. When sharing one robot, coordinate which host owns its Stream connection. The local demonstration uses port `3081`; port `3080` is for development. Port selection does not select the finance database: the host's profile and finance configuration do. Keep the demonstration profile and data together when handing them over.

<a id="variables"></a>
## Template variables

Create a message template supporting AI streaming text. Bind its components to these exact variable names; the application supplies their values as strings in `cardData.cardParamMap`.

| Variable | Value supplied by the application | Component binding |
|---|---|---|
| `content` | Payment summary or action result | Streaming rich text body; use `content` as the streaming key |
| `summary` | Empty string | Compatibility field; do not add a second copy of the body |
| `merchantList` | JSON array of merchant candidates | Parse/bind as a candidate collection, displaying each item's `displayName` and submitting its `shopNo` |
| `flowStatus` | `1` while processing, `3` when streaming finishes | Streaming component's flow status variable |

Each candidate has `shopNo`, `name`, `brand`, and `displayName`. The service queries candidates from the finance database. Do not hardcode merchant names, numbers, amounts, or a fixed candidate list into the published template. A plain text component bound to `merchantList` displays JSON rather than working merchant choices.

For a component exposing `summaryContent` and `flowStatusVar`, bind them to `content` and `flowStatus` respectively. Editor labels and collection controls vary by template; verify the resulting bindings rather than copying an expression from a different editor version. On submission or cancellation, the application sets `merchantList` to `[]`; candidate controls must follow that collection so stale choices disappear.

<a id="callbacks"></a>
## Button callbacks

The host creates instances with `callbackType: STREAM`. A confirmation must put both `action: confirm` and the selected merchant's actual `shopNo` in `content.cardPrivateData.params`. A cancellation must put `action: cancel` there. A button label or `actionIds` alone does not satisfy the handler.

The following callback fragment is an example; replace its sample shop number through the selected candidate binding, not fixed template text:

```json
{
  "cardPrivateData": {
    "params": {
      "action": "confirm",
      "shopNo": "3F-3032"
    }
  }
}
```

The callback's outer `outTrackId` identifies the card instance created by the application. Do not reuse a fixed instance ID. Confirmation creates a pending review; it must not claim that the payment has already been booked. After submission, use the workbench to approve or reject the payment; the old card's cancel button does not withdraw a submitted review.

<a id="configure"></a>
## Publish and configure

Save and publish the template for the intended robot application. Copy its complete template ID into `DINGTALK_CARD_TEMPLATE_ID`; set `DINGTALK_CARD_ROUTE_KEY` only when that published template provides a callback route key. A saved draft is not a published template. Each colleague must have access to the configured application and template, or publish their own.

Prepare the following values in the host's local environment file. Empty entries below are placeholders, not working credentials:

```dotenv
DINGTALK_CLIENT_ID=
DINGTALK_CLIENT_SECRET=
DINGTALK_CARD_TEMPLATE_ID=
DINGTALK_CARD_ROUTE_KEY=
DINGTALK_VISION_PROVIDER=
DINGTALK_VISION_MODEL=
DINGTALK_DEBUG=0
```

Both client credentials are required to connect Stream. Without a template ID, the bridge uses text confirmation. Screenshots additionally require an attachment provider and an image-capable model route already registered in the host. Set both vision values together; nonempty plugin configuration takes precedence over the corresponding environment values. These variables select a route; they do not create a model provider or supply its API key.

After editing the environment, restart the intended host so it reads the new values. Use the supported CLI/profile startup described in the delivery guide. Keep secrets in the local environment or the separately delivered private configuration; do not commit them with these setup documents. Leave SDK debug logging disabled during credential handling.

<a id="verify"></a>
## Verify and troubleshoot

1. In an isolated test profile, submit a clearly marked test payment with a merchant and fee. Verify that the card shows one readable summary and selectable merchant candidates.
2. Confirm the selected merchant. Verify that DingTalk reports submission for workbench review and that the workbench shows one pending item. It must not increase booked payment totals yet.
3. Approve or reject from the workbench. Approval books the payment once; rejection retains its review record without booking it. A rejected submission may be submitted again if there is no existing booked payment or pending review with the same exact transaction number.
4. Repeat a confirmation and resend an image with the same nonempty transaction number. Verify that the service returns the existing result instead of booking again. Equal amounts or similar merchant names alone are not evidence of a duplicate.
5. Test cancellation, an expired draft, and a host restart using test data. Reopen the new startup link after restart and verify that saved review records remain available.

| Symptom | Check |
|---|---|
| Body is blank or duplicated | Bind the body to `content`; keep `summary` empty and remove duplicate body components |
| Candidate JSON appears as text | Bind `merchantList` to candidate controls rather than a plain text component |
| Confirmation says no shop number was returned | Inspect `params.action` and the selected candidate's `params.shopNo` binding |
| The old card still shows Cancel after submission | The template has a static control; the handler returns the saved submission result and does not cancel the review |
| No card or no robot reply | Check plugin activation, both client credentials, the published template ID, and application availability; inspect errors without exposing tokens |
| Screenshot recognition is unavailable | Check the paired vision settings, registered model route, and attachment provider |
| Workbench has no pending item | Check the host/profile and submission result; an exact duplicate may refer to an existing review or booked payment |

See the [DingTalk package](../../packages/hongyang/dingtalk/README.md) for runtime behavior and the [bridge implementation](../../packages/hongyang/dingtalk/src/bridge.ts) for the variable and callback contract. This guide's verification steps are the handoff checklist, not a claim that a fresh machine has already passed them.
