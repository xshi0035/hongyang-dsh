---
description: "配置钉钉付款卡片并接入弘阳工作台审核。"
kind: "reference"
---

# 弘阳钉钉付款卡片配置

[English](DINGTALK_CARD_SETUP.md) | 中文

## 概述

本文定义 `test` 分支使用的模板变量、按钮回调和运行配置。钉钉确认只提交付款审核；审核人员必须在 DSH 财务工作台确认后才入账。这两份 Markdown 及其 `.i18n.yaml` 一致性记录是配置说明，不是可导入钉钉的模板文件或运行 profile。

## 目录

- [前置条件与启动](#startup)
- [模板变量](#variables)
- [按钮回调](#callbacks)
- [发布与配置](#configure)
- [验证与排错](#verify)

<a id="startup"></a>
## 前置条件与启动

准备已发布的钉钉企业内部应用，启用 Stream 模式机器人，并将操作人员加入可用范围。宿主必须显式加载弘阳财务和钉钉插件；仅安装钉钉 bundle 不会启动监听。参见 [profile 启用说明](../../packages/hongyang/dingtalk/README.zh.md#use-this-package)。

使用 `git clone --branch test https://github.com/xshi0035/hongyang-dsh.git` 克隆当前分支。按照[交付启动步骤](DEMO_DELIVERY.zh.md#startup)安装依赖并配置单独提供的运行 profile；其中离线 bundle 克隆可由上述在线克隆替代。交付页的能力表是 9 月 13 日历史快照，不代表当前验收结果。

Git 不提供可直接使用的密钥、你发布的模板或私有运行目录。要复现已准备好的演示，请单独取得对应的私有 profile 和数据库备份，并调整为本机路径。仅克隆仓库并填写下方变量，不会自动创建 profile、财务数据或模型提供方。同事电脑上的完整冷启动仍需验证。

并行开发使用各自的测试机器人；共享一个机器人时，协调由哪台宿主持有 Stream 连接。本机展示使用 `3081`，`3080` 用于开发。端口本身不决定财务数据库，宿主 profile 和财务配置才决定；交接时应一起移交对应的展示 profile 和数据。

<a id="variables"></a>
## 模板变量

创建支持 AI 流式文本的消息模板。组件绑定以下精确变量名，应用通过 `cardData.cardParamMap` 以字符串形式传值。

| 变量 | 应用提供的值 | 组件绑定 |
|---|---|---|
| `content` | 付款摘要或操作结果 | 流式富文本正文；流式 key 使用 `content` |
| `summary` | 空字符串 | 兼容字段；不要再添加一份重复正文 |
| `merchantList` | 商户候选 JSON 数组 | 解析／绑定为候选集合，展示每项的 `displayName`，提交其 `shopNo` |
| `flowStatus` | 处理中为 `1`，流式结束为 `3` | 流式组件的状态变量 |

每个候选包含 `shopNo`、`name`、`brand` 和 `displayName`。服务从财务数据库查询候选；发布模板中不要写死商户名称、编号、金额或固定候选列表。把 `merchantList` 绑定为基础文本只会显示 JSON，不能提供可操作的商户选择。

如果组件提供 `summaryContent` 和 `flowStatusVar`，分别绑定 `content` 和 `flowStatus`。编辑器标签与集合控件随模板不同，应核对最终绑定，不要照抄其他编辑器版本的表达式。提交或取消后，应用将 `merchantList` 设为 `[]`；候选控件必须随集合更新，才能移除失效选项。

<a id="callbacks"></a>
## 按钮回调

宿主创建实例时使用 `callbackType: STREAM`。确认必须在 `content.cardPrivateData.params` 中回传 `action: confirm` 和所选商户的真实 `shopNo`；取消必须在同一位置回传 `action: cancel`。只有按钮文字或 `actionIds` 不满足处理器要求。

以下是回调片段示例；其中铺位号必须通过所选候选绑定替换，不要作为固定文字写入模板：

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

回调外层的 `outTrackId` 标识应用创建的卡片实例，不要复用固定实例 ID。确认只创建待审核单，不能宣称付款已入账。提交后在工作台批准或驳回；旧卡片的取消按钮不会撤回已提交审核。

<a id="configure"></a>
## 发布与配置

保存模板并发布到目标机器人应用。将完整模板 ID 填入 `DINGTALK_CARD_TEMPLATE_ID`；只有已发布模板提供回调路由键时，才设置 `DINGTALK_CARD_ROUTE_KEY`。仅保存草稿不等于发布。同事必须有权使用配置的应用和模板，或发布自己的模板。

在宿主本地环境文件中准备以下配置。下方空值是占位，不是可用凭据：

```dotenv
DINGTALK_CLIENT_ID=
DINGTALK_CLIENT_SECRET=
DINGTALK_CARD_TEMPLATE_ID=
DINGTALK_CARD_ROUTE_KEY=
DINGTALK_VISION_PROVIDER=
DINGTALK_VISION_MODEL=
DINGTALK_DEBUG=0
```

连接 Stream 必须同时提供两项客户端凭据；不设置模板 ID 时，桥接使用文字确认。截图还需要附件 provider，以及宿主已注册且支持图片的模型路由。两项视觉配置必须一起设置；插件配置的非空值优先于对应环境变量。这些变量只选择路由，不会创建模型提供方或提供模型 API key。

修改环境后，重启目标宿主以读取新值，使用交付说明中的正式 CLI／profile 启动入口。密钥保存在本地环境或单独交付的私有配置中，不随本文提交仓库。处理凭据时保持 SDK 调试日志关闭。

<a id="verify"></a>
## 验证与排错

1. 在隔离测试 profile 中提交一笔明确标记为测试的付款，补全商户和费项。核对卡片正文只显示一份，商户候选可以选择。
2. 确认所选商户。核对钉钉提示已提交工作台审核，工作台出现一条待审核单，此时已入账合计不能增加。
3. 在工作台批准或驳回。批准只入账一次；驳回保留审核记录但不入账。驳回后可以重新提交，前提是同一精确交易单号不存在已入账付款或待审核单。
4. 重复确认，并重发包含相同非空交易单号的图片。核对服务返回已有结果，不重复入账；仅金额相同或商户名称相似不能作为重复依据。
5. 用测试数据验证取消、草稿过期和宿主重启。重启后使用新的启动链接，核对已保存的审核记录仍可访问。

| 现象 | 检查项 |
|---|---|
| 正文空白或重复 | 正文绑定 `content`；`summary` 保持为空，移除重复正文组件 |
| 候选显示为 JSON 文本 | 将 `merchantList` 绑定到候选控件，而非基础文本组件 |
| 确认提示没有回传铺位号 | 检查 `params.action` 和所选候选的 `params.shopNo` 绑定 |
| 提交后旧卡片仍有取消按钮 | 模板含静态控件；处理器返回已保存的提交结果，不会取消审核 |
| 没有卡片或机器人不回复 | 核对插件启用、两项客户端凭据、已发布模板 ID 及应用可用范围；查看错误时不要暴露令牌 |
| 截图识别不可用 | 检查成对的视觉配置、已注册模型路由及附件 provider |
| 工作台没有待审核单 | 核对宿主／profile 和提交结果；精确重复交易可能指向已有审核或入账记录 |

运行行为见[钉钉包说明](../../packages/hongyang/dingtalk/README.zh.md)，变量及回调约定见[桥接实现](../../packages/hongyang/dingtalk/src/bridge.ts)。本文验证步骤是交接检查清单，不代表一台新电脑已经通过验证。
