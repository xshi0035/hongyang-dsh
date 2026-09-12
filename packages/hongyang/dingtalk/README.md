# @deepseek-ai/dsh-hy-dingtalk

弘阳财务助手的钉钉 Stream 输入适配器。消息处理和财务登记由 dsh-hy-finance 负责；本包只负责接收钉钉消息、调用登记服务和回复结果。

文字消息已支持本地桥接测试，并提供 `createDingtalkStreamClient` 对接官方 Stream SDK。凭证从宿主配置传入，不写入仓库。图片消息在图片输入字段与模型视觉能力配置确认前只回执并请求文字补充，不会猜金额或商户。

Stream 图片事件会先提取 `downloadCode` 并以 `downloadCode:<value>` 形式交给上层；下载和视觉识别仍由宿主能力负责，未下载成功前不会进入财务登记。

部署时可设置 `DINGTALK_CLIENT_ID` 和 `DINGTALK_CLIENT_SECRET`；未设置时 `dingtalkConfigFromEnv()` 返回 `undefined`，宿主可以保持插件停用而不影响财务助手启动。可选的 `DINGTALK_DEBUG=1` 只开启 SDK 调试日志。
