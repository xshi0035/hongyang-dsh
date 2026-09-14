---
description: "弘阳 AI 财务助手本机开发状态与 Claude 接管步骤。"
kind: "reference"
---

# 弘阳 AI 财务助手：交给 Claude 的当前开发状态

日期：2026-09-14。工作目录：`/Users/shixin/Desktop/广场dsh/deepseek-harness`。当前分支：`test`。本文是当前机器与当前工作树的交接快照；较早的 [HANDOFF.md](HANDOFF.md) 是项目背景和原始计划，部分状态已过时。先读本文，再读 [spec.md](spec.md)、[design.md](design.md)、[DEMO_DELIVERY.zh.md](DEMO_DELIVERY.zh.md) 和两个包的 README。仓库根目录及 `packages/`、`docs/` 的 `AGENTS.md` 同样适用。

## 给 Claude 的第一条任务

请连接 Steven 的本机，打开上述仓库，先核对 `git status`、当前 `test` 分支、`packages/hongyang/dingtalk/src/` 和财务登记 provider。接管并重启 **DSH Web 服务及其 DingTalk Stream 插件**，不要启动 Electron，也不要把 `pnpm dev:web` 当作后端。启动前只停止已核实属于此仓库的旧 3080 进程，避免同一机器人同时连两个 Stream 客户端。凭证仅从本机安全配置或 Steven 在终端输入取得；不要在对话、日志、文档或 Git 中显示 Secret。启动后确认 `dsh web:` 带 token URL 和 `hy-dingtalk: Stream connected`。然后定位互动卡片未投递的实际错误、修复卡片确认/取消回调与持久去重，并核对 2026-09-14 的 200 元测试登记去向。每改动一处运行对应测试；财务 provider 变更还要运行 import smoke。不要自动推送 Git，也不要把本地卡片设置文档提交。

## 已实现并验收的部分

- 弘阳独立 DSH profile 与 Web 界面、客户样本导入、商户和应收查询、银行/微信/POS 日结拆分、认领、日报、凭证草稿与表格导出已实现。本机 Web 可以启动；演示与项目结构见 [DEMO_DELIVERY.zh.md](DEMO_DELIVERY.zh.md)。金额、税额、拆分和凭证行由 `packages/hongyang/finance/src/provider/` 的确定性代码处理，模型不得直接计算或入账。
- 2026-04-03 日报 smoke 结果：生成 12 行、60,885.18 元；客户台账 14 行、63,679.60 元；逐行匹配 10 行，缺 3 行、多 1 行、金额差异 1 行。旧 [HANDOFF.md](HANDOFF.md) §7 的“匹配 11、金额差异 0”已经不等于当前输出。不要为了通过测试改写客户基准。
- 钉钉企业内部应用和机器人已发布，Stream 连接在本机实测成功。卡片模板“弘阳付款商户确认”已发布，模板 ID 为 `43d96452-6c82-4384-850f-f33219110556.schema`。模板变量：`content` 富文本、`summary` 文本、`merchantList` 对象数组；候选字段是 `shopNo`、`name`、`brand`、`displayName`。每候选确认按钮回传 `action=confirm` 和 `shopNo`；独立取消按钮回传 `action=cancel`。卡片仍未在钉钉真机成功投递。
- 钉钉文本路径支持“电费 200”后再回复“作业帮”的同一会话草稿、商户候选和文字确认。数据库品牌值实际为“作业帮/小天才/优学派”，本次交接代码将品牌按分隔符拆分匹配，找到铺位 `3F-3032`。草稿仅保存在 `bridge.ts` 的内存 Map，30 分钟过期，服务重启后丢失；这还不是通用 agent 长期会话记忆。
- 2026-09-14 的一次“确认 3F-3032”已**真实写入** `$DSH_HOME/hongyang/finance.db`，不是聊天模拟。`transaction.id=txn_mu0xvt00m16yx2gm`，`source=dingtalk`，`amount=20000` 分，`status=manual`，`merchant_id=mch_mtwx8ofj4w8wo9qn`。对应 `allocation.id=alc_mu0xvt05vl4pq0bp`，`fee_type=elec_post`，含税 20000 分，税率 0.13，税额 2301 分，`receivable_id` 为空。该记录尚未生成正式凭证，也没有证据表明已与银行/POS 原流水合并。当前持久库另有 4 条 `source=dingtalk`、`status=pending` 的早期测试记录；清理前先逐条核对来源和影响。
- 2026-04-03 持久库里客户基准 `voucher_row` 有 9 行；当前 `voucher` 表对该日期为 0 行。之前某次凭证草稿生成过 35 行、借贷平衡，但与客户 9 行基准未完成业务范围对齐和最终逐行验收。旧日报和凭证的状态说明见 [DEMO_DELIVERY.zh.md](DEMO_DELIVERY.zh.md)。

## 当前代码与 Git 状态

本次交接提交基于 `f33242ffd7 feat(hongyang): add interactive card sender`，包含以下四个文件的修改和本文。Claude 接管时先检查最新 Git 状态，保留本机后续改动，不要直接 reset：

- `packages/hongyang/dingtalk/src/types.ts`：`DingtalkReply.card`、可选 `sendCard`、可选 `callbackRouteKey`。
- `packages/hongyang/dingtalk/src/stream-client.ts`：卡片请求已从旧 `im/interactiveCards/send` 改为 `card/instances/createAndDeliver`；非 2xx 响应记录正文，失败回退纯文本。
- `packages/hongyang/dingtalk/src/bridge.ts`：有候选、配置了 `DINGTALK_CARD_TEMPLATE_ID` 且 Stream 有发送能力时，返回卡片数据；`merchantList` 被 JSON 字符串化；`displayName` 暂用 `brand || name`。
- `packages/hongyang/finance/src/provider/register/conversation.ts`：拆分复合品牌，以“作业帮”匹配“作业帮/小天才/优学派”。

三个未跟踪文件 `docs/hongyang/DINGTALK_CARD_SETUP.md`、`.zh.md`、`.i18n.yaml` 是给 Claude 操作钉钉卡片编辑器的草稿。Steven 明确说过这些文档不要提交 Git，继续保留在本机。本次 Steven 已授权将代码修改和本文推送到自己的 `origin/test`（`xshi0035/hongyang-dsh`）；后续提交和推送需先询问。不要擅自切到旧 `hongyang-demo` 分支。

## 尚未解决：按优先级处理

1. **互动卡片未投递。** 真机收到的是候选纯文本兜底。当前发送器调用 `POST https://api.dingtalk.com/v1.0/card/instances/createAndDeliver`，但请求体只包含平铺的 `robotCode` 等字段；钉钉官方模板接入示例使用 `imRobotOpenSpaceModel`、`imRobotOpenDeliverModel`、`openSpaceId=dtv1.card//im_robot.${userId}`、`userIdType=1`、`callbackType=STREAM`。应对照官方示例核实完整请求结构或直接采用 SDK。当前只对发送端非 2xx 记录 `card send failed`；取 token 失败、网络异常等仍可能被分发器静默吞掉，因此终端没有该日志不代表没有尝试发送。修复前不要把文本兜底误判为卡片验收通过。
2. **卡片按钮回调未接入登记。** `stream-client.ts` 已注册 `TOPIC_CARD` 并提供 `onCard`，但 `createFinanceDingtalkBridge` 没有注册 `stream.onCard(...)`。当前按钮点击即使能回调，也不会确认或取消草稿。应解析实际回调 payload、校验 `action/shopNo` 和发起用户、验证候选仍在草稿中、只提交一次，并返回可见结果。测试真实回调与重放。
3. **重启后的记忆与幂等。** 草稿和入站 messageId 去重都在内存中；重启会丢失，重复确认可能重复插入 `transaction`/`allocation`。应持久化关联关系和幂等键，并防止两个 Stream 实例同时处理同一机器人消息。不能仅按金额猜测原银行/POS 流水归属。
4. **付款图片未进入确认流程。** `bridge.ts` 收到图片时，如果没有 Vision 或图片还只是 downloadCode，就返回“图片识别尚未配置”；即使 Vision 有结果也没有并入同一确认草稿。财务 provider 的图片校验能力存在，但宿主启动流程尚未把它接成真实端到端路径。
5. **文字解析与商户展示细节。** 卡片 `displayName=brand || name` 会把复合品牌“作业帮/小天才/优学派”整串显示；商户签约人是“周军伟”，确认时应展示足以区分主体的名称、铺位和费项。对“确认 编号”这样的字面文字必须提示回复具体铺位。多金额、多费项、同名品牌、多主体都要维持人工确认。
6. **财务终验。** 2026-04-03 系统凭证与客户 `voucher_row` 尚未逐行一致；停车充值、UONE、发发桌球主体、日期口径及未认领 POS 仍需按证据核对。客户已确认 13% 电费、3% 水费的销项税规则及部分预收科目，现有映射见财务规则和 [DEMO_DELIVERY.zh.md](DEMO_DELIVERY.zh.md)，不得由模型推测未确认科目。Univer 应由 agent 在需要用户审阅表格时自动调用。

## 本机启动：DSH Web 与钉钉一起启动

当前检查时 `127.0.0.1:3080` 由本仓库 `node --import tsx/esm apps/cli/src/bin.ts web --no-open` 监听；实际 PID 会变。Claude 接管时先运行 `lsof -nP -iTCP:3080 -sTCP:LISTEN`，再用 `ps -p <PID> -o pid=,ppid=,command=` 和 `lsof -a -p <PID> -d cwd -Fn` 验证属于这个仓库。确认后给旧进程发 `SIGTERM`，等待 3080 释放。不要杀其他项目的 Node 进程。现有运行进程的 shell 凭证不会自动传给 Claude 新启动的 shell。

```bash
cd "/Users/shixin/Desktop/广场dsh/deepseek-harness"
export PATH="/opt/homebrew/bin:$PATH"
export DSH_HOME="/Users/shixin/.dsh-hongyang"
export DINGTALK_CARD_TEMPLATE_ID="43d96452-6c82-4384-850f-f33219110556.schema"
# 在同一个终端加载本机安全保存的 DINGTALK_CLIENT_ID 与 DINGTALK_CLIENT_SECRET；
# 若没有安全配置，让 Steven 在终端输入，绝不打印或写入 Git。
pnpm dsh web --no-open
```

`dingtalkConfigFromEnv()` 只读取当前进程的 `DINGTALK_CLIENT_ID` 和 `DINGTALK_CLIENT_SECRET`。启动日志必须出现 `hy-dingtalk: finance service ready; starting Stream`、`dsh web: http://127.0.0.1:3080/?token=...` 和 `hy-dingtalk: Stream connected`。浏览器打开**当前这次启动打印的完整带 token 地址**，不要复用旧 token。`pnpm dev:web` 只构建前端；`pnpm start:desktop` 会启动 Electron，均不是这次所需的 DSH Web 服务。卡片模板发布与机器人应用发布已经完成，无需再操作开发者后台发布按钮。

## 验证与交付要求

- 本次交接提交前运行 `pnpm run doc-sync`：21 项通过、13 项失败。失败包括财务服务返回类型缺显式标注、旧 spec/design 文档代码块类型错误、翻译配对、JSDoc、生成目录过期及 README 规范等；不能声称全仓文档检查通过。提交检查另发现发送器一行超出 140 字符，已仅作换行修正。交接版本仍是开发中快照。
- 本次 2026-09-14 实跑：`node --import tsx/esm --test packages/hongyang/dingtalk/tests/*.test.ts`，7/7 通过；`node node_modules/typescript/bin/tsc -b packages/hongyang/dingtalk/tsconfig.json` 通过；`node --import tsx/esm packages/hongyang/finance/tests/import.smoke.ts` 通过。smoke 使用隔离库，不应拿其随机 ID 对比持久库。全仓 `pnpm lint` 以前因 10 处财务模块既有类型 lint 问题失败；这次没有重新跑全仓 lint，不得写成“全仓 lint 已通过”。
- 联调依次检验“电费 200”→“作业帮”→收到卡片→点击真实 `3F-3032` 确认；另测取消、重复点击、服务重启后重放。确认前查询持久库行数，确认后查看 `transaction`、`allocation`，不得只凭机器人文字判断是否入账。测试可能真实写钱到演示数据库，优先使用隔离副本或明确标记测试记录。
- 核对已登记的 200 元时可执行以下只读查询；SQLite 金额单位为分，`20000` 即 200.00 元：

```bash
sqlite3 "$DSH_HOME/hongyang/finance.db" \
  "select id,txn_time,amount,merchant_id,status,raw from \"transaction\" where id='txn_mu0xvt00m16yx2gm';"
sqlite3 "$DSH_HOME/hongyang/finance.db" \
  "select id,transaction_id,fee_type,amount_incl_tax,tax_rate,tax_amount,receivable_id from allocation where transaction_id='txn_mu0xvt00m16yx2gm';"
```

- 若需继续开发，先修卡片发送失败与回调再请 Steven 真机测试；测试后报告“开发了什么、下一步是什么、还有什么问题”。所有答复先称呼 **steven**。不要把 Client Secret、DSH token、客户原始数据或本机私密包提交或推送。
