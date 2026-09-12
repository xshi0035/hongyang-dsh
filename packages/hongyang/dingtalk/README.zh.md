---
description: "面向弘阳财务 provider 的钉钉文字与付款图片适配器。"
kind: "package-library"
---

# @deepseek-ai/dsh-hy-dingtalk

[English](README.md) | 中文

## 概述

本库将标准化的钉钉消息接入弘阳付款登记。下载后的图片可以经宿主附件存储和已配置的视觉路由抽取字段，再由财务 provider 校验并登记。本包导出函数；安装包或设置环境变量均不会启动机器人监听。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

调用 `createFinanceDingtalkBridge(service, stream, vision)`，传入共用财务服务、传输适配器及可选视觉客户端。下载后的图片需要同时具备视觉客户端和 `service.registerPaymentFromImage`；否则回复要求补充文字，不执行图片登记。成功回复包含商户、费项名称及 provider 格式化后的金额。无效证据返回失败说明。

### 在钉钉准备机器人

1. 登录钉钉开发者后台，选择测试组织，创建企业内部应用。
2. 在应用能力中添加并启用机器人，将消息接收模式设为 **Stream**，发布机器人配置。
3. 创建并发布应用版本，将测试操作人员加入可用范围。
4. 将凭证页面的 Client ID（AppKey）和 Client Secret（AppSecret）保存在本地。不要提交到仓库，也不要在聊天中粘贴 Secret。
5. 准备部署环境值 `DINGTALK_CLIENT_ID` 和 `DINGTALK_CLIENT_SECRET`。读取函数仅从宿主进程读取它们；设置后不会自动启用监听。处理凭证时保持 SDK 调试日志关闭。
6. 宿主接入后，用操作人员的手机测试文字、图片、收款方错误和商户缺失场景。若接口缺权限，记录不含令牌的错误码。

官方[机器人创建指南](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/java/create-bot/)说明应用创建与发布流程。本地测试不代表已连接真实钉钉。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节</summary>

[桥接层](src/bridge.ts)调用共用财务服务。[LLM 适配器](src/llm-vision.ts)将图片保存为附件，仅在收到明确的成功终止事件后接受输出。[财务 provider](../finance/src/provider/register/image.ts)在写入前校验收款方、正数金额和支付时间；交易单号保留为独立字段。未识别的商户或费项保持待确认。文字和图片登记共用数据库写入路径。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

参见[财务服务](../finance/src/service/finance-service.ts)及[图片登记决策](../../../.agents/notes/implemented/architecture/2026-09-12-hongyang-image-registration.zh.md)。

<a id="model-experience"></a>
## Model Experience

### 付款图片抽取

#### 模型看到的内容

视觉适配器通过显式传入的提供方／模型路由发送图片和文字提示，要求返回包含 `amountText`、`payee` 等字段的 JSON，不计算金额。登记回复由财务 provider 格式化。

#### Token 影响

每张图片发起一次辅助 LLM 请求，输出上限为 512 token。本地 mock 测试不能证明模型可用性、实际 token 用量、费用或延迟。

#### KV Cache 影响

图片附件和提示随收款变化。本地测试不保证也不测量缓存复用。

## Known Limitations and Deferred Work

- 本包没有可加载的 Cordis 插件入口。宿主挂载、按钉钉用户维持 agent 会话、持久化消息去重和真实机器人验收仍需接入。
- 网页 `finance_register` 工具仍仅支持文字，其图片参数尚未接入本桥接层。
- 截图登记尚不合并平台交易，也不拆分多个费项金额。这些仍是完整通过 HANDOFF 第 6、7 步验收的必要工作。
- 传输回调路由、下载授权、令牌刷新和重试行为需要单独做协议核查；下载器 mock 成功不能证明真实 API 已连通。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

本库不持有可独立观测的注册表，因此不发布 invariant companion。provider／数据库测试验证写入；宿主组合测试和真实钉钉测试仍然必要。

</details>
