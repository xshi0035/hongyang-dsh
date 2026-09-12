---
description: "DingTalk text and payment-image adapters for the Hongyang finance provider."
kind: "package-library"
---

# @deepseek-ai/dsh-hy-dingtalk

English | [中文](README.zh.md)

## Summary

This library connects normalized DingTalk messages to Hongyang payment registration. Downloaded images can pass through the host attachment store and a configured vision route before the finance provider validates and records them. It exposes functions; installing it or setting environment variables does not start a robot listener.

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

Call `createFinanceDingtalkBridge(service, stream, vision)` with the shared finance service, transport, and optional vision client. A downloaded image requires both vision and `service.registerPaymentFromImage`; otherwise the reply requests text and no image registration occurs. Successful replies include the merchant, fee name, and provider-formatted amount. Invalid evidence produces a failure reply.

### Prepare the robot in DingTalk

1. Sign in to the DingTalk developer console and select the test organization. Create an enterprise internal application.
2. Under application capabilities, add and enable a robot. Select **Stream** as the message receiving mode, then publish the robot configuration.
3. Create and publish an application version. Include the testing operator in its available range.
4. Keep the Client ID (AppKey) and Client Secret (AppSecret) from the credentials page locally. Do not commit them or paste the Secret into chat.
5. Prepare the deployment environment values `DINGTALK_CLIENT_ID` and `DINGTALK_CLIENT_SECRET`. The helper reads them only from the host process; setting them does not activate the listener. Leave SDK debug logging disabled during credential handling.
6. After host integration, test text, picture, invalid payee, and missing merchant cases with the operator's phone. Capture error codes without tokens if an API permission is missing.

The official [robot creation guide](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/java/create-bot/) describes application creation and publication. No live DingTalk connection is implied by local tests.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [bridge](src/bridge.ts) invokes the shared finance service. The [LLM adapter](src/llm-vision.ts) retains the image as an attachment and accepts output only after an explicit successful terminal event. The [finance provider](../finance/src/provider/register/image.ts) validates the payee, positive amount, and payment time before writing; transaction numbers remain separate fields. Unrecognized merchants or fees remain pending. Text and image registration share the same database write path.

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

- The package has no loadable Cordis plugin entry. Host mounting, agent sessions keyed by DingTalk user, durable message deduplication, and live robot acceptance remain integration work.
- The web `finance_register` tool still supports text only; its image parameter is not connected to this bridge.
- Screenshot registration does not merge platform transactions or split multiple fee amounts. These remain required before full HANDOFF step 6/7 acceptance.
- Transport callback routing, download authorization, token refresh, and retry behavior require a separate protocol-level audit; downloader mock success is not proof of a real API connection.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

No invariant companion is published: this library owns no independently observable registry. Provider/database tests verify writes; host composition and live DingTalk tests are still required.

</details>
