# @deepseek-ai/dsh-hy-dingtalk

弘阳财务助手的钉钉 Stream 输入适配器。消息处理和财务登记由 dsh-hy-finance 负责；本包只负责接收钉钉消息、调用登记服务和回复结果。

文字消息已支持本地桥接测试，并提供 `createDingtalkStreamClient` 对接官方 Stream SDK。凭证从宿主配置传入，不写入仓库。图片消息在图片输入字段与模型视觉能力配置确认前只回执并请求文字补充，不会猜金额或商户。
