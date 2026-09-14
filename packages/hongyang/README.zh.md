---
description: "弘阳财务与钉钉包导航：本机收款登记、审阅与报表。"
kind: "package-group"
---

# hongyang/ — 财务助手

[English](README.md) | 中文

## 概述

弘阳包让运营人员通过钉钉上报收款，让财务用户在浏览器导入、审阅并汇总付款数据。财务包负责确定性会计操作和 SQLite 记录。钉钉包提供消息适配器。真实卡片确认与完整客户对账仍未完成。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

根据要修改的用户入口或财务操作选择包。

| 包 | 职责 |
|---|---|
| [finance](finance/README.zh.md) | 导入、认领、报表、凭证草稿、查询与浏览器审阅 |
| [dingtalk](dingtalk/README.zh.md) | 钉钉 Stream 消息与付款草稿对话 |

<a id="related-documentation"></a>
## 相关文档

- [弘阳子系统](../../docs/subsystems/hongyang.zh.md) — 财务服务职责与集成。
- [当前交接文档](../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.zh.md) — 已验证的开发状态与启动。

<a id="dev-note"></a>
## 开发备注

无。
