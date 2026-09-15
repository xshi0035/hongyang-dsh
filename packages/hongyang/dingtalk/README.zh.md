---
description: "面向弘阳财务 provider 的钉钉文字与付款图片适配器。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-hy-dingtalk

[English](README.md) | 中文

## 概述

用户可以通过钉钉上报文字或截图付款，在后续消息中补充商户和费项，并通过文字或互动卡片提交工作台审核。截图金额在确认前始终是候选。宿主需要机器人凭据，截图还需要配置视觉路由；最终工作台审批流程仍待真机验收。空 bundle patch 本身不会启用监听。

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

文字补全使用只读 provider 预览：先发“电费200”，再补商户名称，最后回复“确认 ”加上候选中展示的实际铺位号。桥接层按会话和用户保留30分钟草稿，展示数据库候选，只在有效编号确认后提交工作台。取消和过期均不写入，确认失败保留草稿供重试，成功后重复确认不会再次写入。这是有限的文字匹配，尚非通用模型语义理解。草稿、入站消息去重和卡片实例持久化在财务库旁边的 `dingtalk.db`，每份存储由一个 Stream 实例持有，财务提交以草稿 id 保证幂等。设置 `DINGTALK_CARD_TEMPLATE_ID` 为已发布模板后，信息齐全且有候选的草稿以互动卡片投递，确认和取消按钮只会处理该草稿一次；过期卡片、他人点击或投递失败都回退到文字路径。截图提取进入同一份持久草稿，不创建流水。财务 provider 校验配置的收款方、正数金额和支付时间，保留交易单号，并把金额标为待人工核对的候选。截图前后的文字都可补充商户和费项；金额冲突会被拒绝，原草稿保持不变。更换截图或更正金额前先取消。识别期间收到新消息会使本次识别结果失效，应针对当前草稿重新发送截图。

钉钉确认将 `payment_submission` 保存到财务数据库，不创建财务流水或分摊。DSH 工作台跨日期展示待审核单，提供“确认入账”和“驳回”。只有工作台批准才入账；驳回保留审核记录但不入账。已提交卡片引导用户去工作台，`summary` 留空以避免正文重复。模板仍可能展示取消控件；提交后重放该操作只返回已提交结果。参见[审批决策](../../../.agents/notes/implemented/architecture/2026-09-15-hongyang-workbench-approval.zh.md)。

预览和提交时都会检查重复交易单号。付款已经登记或已有待审核单时，直接提示已有记录，不再新增提交。重复草稿结束并清除；同一草稿的重试返回已有工作台结果。判断仅使用非空的精确交易单号，不凭金额或商户相同就认定重复。

### Profile 启用

清单声明了 bundle，但 [cordis.patch.yml](cordis.patch.yml) 的补丁列表为空。仅安装该层不会挂载导出的桥接插件。弘阳宿主组合必须显式加载本包；[当前交接文档](../../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.zh.md) 记录已验证的本机启动方式。[入口](src/index.ts) 等待财务服务，并从宿主进程读取凭据。

在插件配置中同时设置 `visionProvider` 和 `visionModel`，或提供 `DINGTALK_VISION_PROVIDER` 和 `DINGTALK_VISION_MODEL`，指向宿主 LLM 服务已注册且支持图片的路由。宿主还须加载附件 provider。仅设置一个路由值会导致启用失败；两者均不设置时，文字确认仍可使用，截图会提示尚未配置识别。入口连接认证图片下载器与宿主视觉适配器，插件配置的非空字段优先于环境变量，不猜测 provider 或模型。

### 在钉钉准备机器人

1. 登录钉钉开发者后台，选择测试组织，创建企业内部应用。
2. 在应用能力中添加并启用机器人，将消息接收模式设为 **Stream**，发布机器人配置。
3. 创建并发布应用版本，将测试操作人员加入可用范围。
4. 将凭证页面的 Client ID（AppKey）和 Client Secret（AppSecret）保存在本地。不要提交到仓库，也不要在聊天中粘贴 Secret。
5. 准备部署环境值 `DINGTALK_CLIENT_ID` 和 `DINGTALK_CLIENT_SECRET`，互动卡片还需要 `DINGTALK_CARD_TEMPLATE_ID`（模板发布了路由键时再加 `DINGTALK_CARD_ROUTE_KEY`）。读取函数仅从宿主进程读取它们；设置后不会自动启用监听。处理凭证时保持 SDK 调试日志关闭。
6. 宿主接入后，用操作人员的手机测试文字、图片、收款方错误和商户缺失场景。若接口缺权限，记录不含令牌的错误码。

官方[机器人创建指南](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/java/create-bot/)说明应用创建与发布流程。本地测试不代表已连接真实钉钉。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节</summary>

[桥接层](src/bridge.ts) 保存有界会话草稿，调用财务服务的只读预览和经校验的提交入口。provider 负责金额、费项名称、商户查询及写入。图片不能绕过确认。

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

- Cordis 入口在完成配置后连接图片下载与提取。Loader 组合测试使用真实财务、附件和 LLM 服务，只替换网络端点与模型输出。截图提取仍需真机验收。
- 网页 `finance_register` 工具仍仅支持文字，其图片参数尚未接入本桥接层。
- 截图登记尚不合并平台交易，也不拆分多个费项金额。这些仍是完整通过 HANDOFF 第 6、7 步验收的必要工作。
- 传输回调路由、下载授权和重试行为需要单独做协议核查；下载器 mock 成功不能证明真实 API 已连通。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

桥接层不持有可独立观测的注册表，因此不发布 invariant companion。Provider/数据库测试验证写入，Loader 组合测试在 `tests/expected/` 固定用户可见的图片卡片；该流程不创建 harness Session。仍需真实 API 和手机测试。

</details>
