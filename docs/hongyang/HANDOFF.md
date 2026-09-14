# 弘阳广场 AI 财务助手 · 交接文档

写给接手开发的人（或 Codex）。日期 2026-09-11 晚。演示日期 **2026-09-13**。

先按顺序读：本文 → [spec.md](spec.md)（需求）→ [design.md](design.md)（设计）→ `packages/hongyang/finance/README.md` → 跑一遍验收脚本（§7）。**先跑通、看懂，再改代码。**

---

## 1. 我们在解决什么

客户：衡阳弘阳广场，法人主体"衡阳诚远商业管理有限公司"，一个商业综合体，300 多家商户。财务系统是金蝶云星空。三个人：周晓（对接）、贺部长（登记收款）、华新玉（做账）。

**现状的痛点**：钱从五个口子进来（建行两个账户、平安银行、银联 POS、两个微信商户号），贺部长每天手工把每一笔钱对到"哪个商户、什么费项、哪个账期"，登记进一张 34 列的 Excel（收入日报表）；华新玉再照着日报表手工录金蝶凭证。POS 刷卡大多没写附言，钱是谁的只有运营部现场的人知道。

**我们要演示的**（8 步演示脚本在 spec §4）：

1. 运营部在钉钉拍付款截图加一句话 → 机器人回"已登记"。
2. 财务拖入银行流水 → 系统自动认领大部分，剩下的在卡片里点一下确认，并记住付款人。
3. "出 4 月 3 日的收入日报表" → 34 列 xlsx，在会话里用 Univer 预览，和贺部长台账逐行比对。
4. "出 4 月 3 日凭证" → 21 列星空凭证，税率校验，和客户凭证比对。
5. "愤怒弹珠还欠多少" → 直接回答。

**铁律**：模型只理解意图、选工具、解释结果。金额、税额、拆分、凭证行全部由确定性代码算（`packages/hongyang/finance/src/provider/`）。模型不碰钱。

---

## 2. 客户提供的材料及用途

全部在 `docs/hongyang/samples/`（git 忽略，含客户真实数据，**不要提交、不要外传**）。演示工作区 `/Users/shixin/Desktop/sampel/` 里有一份副本。

| 文件 | 内容 | 在系统里的角色 | 导入器 |
|---|---|---|---|
| `建行流水_2026-04-01_08.xls` | 建行 2038 户 46 笔收入、2035 户 1 笔，4/1–4/8 | **主流水**。对方户名决定渠道：财付通=微信日结、银联商务=POS 日结、捷停车=停车费、抖音=忽略、衡阳诚远=内部划转忽略、其余=对公/个人转账 | `import/bank-ccb.ts` |
| `微信小程序1693395706_*.csv` | 706 商户号 402 单，电费充值小程序，GBK 编码 | 拆财付通日结到商户。商品名 `商户:趣捞鱼-3033 电表:1` 直接给出商户与铺位 | `import/platform.ts` importWechat |
| `微信小程序1723333380_*.csv` | 380 商户号 2157 单，全是停车费 | 拆财付通日结；不落商户，记停车费 | 同上 |
| `pos扫码 2026.4.1-2026.4.30.xlsx` | 银联商务 814 笔，第 1 行是汇总，第 2 行表头 | 拆银联日结。814 笔里 699 笔付款附言为空，只能靠运营上报或人工认领 | `import/platform.ts` importUnionPayPos |
| `充值记录(2026.4.1-30).xls` | 449 条电表充值，"商户-铺位"、电表号、充值方式 | 电费订单到商户的交叉参考；目前只入库不参与计算 | `import/platform.ts` importRecharge |
| `4月结算账单列表-平安银行.xlsx` | 停车系统日结 21 条 | 暂不导入（停车费按建行里的捷停车到账记） | 无 |
| `租费应收明细表.xlsx` | 2025.7–2026.4，租费 sheet 2111 行 + 水电 sheet 1138 行 | **商户主数据**（铺位、签约人、品牌、楼层）+ 每期应收/已收/未收。认领引擎的匹配依据 | `import/receivable.ts` |
| `2026.4.1-4.30收入日报表.xlsx` | 贺部长手工台账 792 行，35 列（比格式多一列"代收款"） | **标准答案**：日报表比对基准 | `import/reference.ts` importLedger |
| `凭证_2026-04-01_08.xlsx` | 星空凭证 134 行，4/1–4/8 | **标准答案**：凭证比对基准 | `import/reference.ts` importVoucherXlsx |
| `收入日报表格式.xlsx` | 客户指定的输出格式，34 列 | 日报表导出的模板依据（列序在 `rules/fee-types.ts`） | 无 |
| `应收表_截图.png`、`付款截图_银联商务.jpg` | 截图 | 付款截图是钉钉上报识别的输入样例 | 无 |

### 三条已经核实的资金规律（代码就是按这个写的）

1. **财付通日结 = 前一日微信对账单"应结订单金额 − 手续费"之和**，16 笔全部分毫相等。备注 `MMDD_商户号` 指明是哪个商户号。
2. **银联日结 = 备注日期段内 POS"清算金额"之和**（备注 `0403-0406费50.98元`），同一天可能拆两笔到账（按手续费档），按日期段合并对账。
3. **贺部长台账粒度是"一商户一笔收款一行"**，费项拆列，可有负数（暂收款冲抵）。同一笔款有时按账期拆成两行。

4/1 到账的 3 笔日结对应 3/31 的明细，客户没给 3 月 31 日对账单，所以对不平，属数据缺口。

---

## 3. 代码在哪、怎么跑

### 仓库与环境

- 仓库：`/Users/shixin/Desktop/广场dsh/deepseek-harness`，是 DeepSeek Harness（dsh）的 fork。远端 `origin` = `github.com/xshi0035/hongyang-dsh`（私有），分支 `hongyang-demo`；`upstream` = DeepSeek 官方，`master` 未动。
- 上游工程规范在 [AGENTS.md](../../AGENTS.md)，改底座代码必须遵守；项目规范在 [CLAUDE.md](../../CLAUDE.md)。
- pnpm 必须用 corepack 的 11.7.0：`/opt/homebrew/bin/pnpm`（PATH 里的 `~/.npm-global/bin/pnpm` 是 9.x，会出错）。
- 数据目录独立：`DSH_HOME=~/.dsh-hongyang`（`~/.dsh` 被另一个项目占用，别碰）。代理写在 `~/.dsh-hongyang/.env`（`HTTPS_PROXY=http://127.0.0.1:7897`），不然 OpenAI 超时。
- 模型：设置页已配 OpenAI 提供方（pi-ai），演示用 GPT-6 Astra。

### 启动

```bash
cd /Users/shixin/Desktop/广场dsh/deepseek-harness
export PATH=/opt/homebrew/bin:$PATH DSH_HOME=$HOME/.dsh-hongyang
pnpm dsh web --no-open        # 打印带 token 的 URL，必须用它打开；根路径 401 是正常的
```

桌面 Claude 应用里 `广场dsh/.claude/launch.json` 的 `dsh-web` 配置就是这条命令。

### 改代码后怎么生效

- **Host 侧**（`src/` 下除 `client/` 外的一切）：源码启动模式直接从 `src/` 加载（tsx），**重启服务即可**，不用构建。
- **Client 侧**（`src/client/`）：必须 `pnpm run build`（约 90 秒，含整个仓库），再重启。
- 类型检查单独跑：`node ./node_modules/typescript/bin/tsc -b packages/hongyang/finance/tsconfig.host.json`（或 `tsconfig.client.json`）。
- 提交前 lefthook 会跑 oxlint（max-len 140 等）和 third-party notices；lint 不过提交失败。

### 包结构（`packages/hongyang/finance`，名 `@deepseek-ai/dsh-hy-finance`）

按 Univer 插件的标准：一个 npm 包，内部按 Cordis 角色分层。挂载点：`packages/bundle/web-app/cordis.patch.yml` 末尾的 `hy-finance` 行；路径别名在根 `tsconfig.base.json`；两个 tsconfig 聚合 `tsconfig.host.json` / `tsconfig.client.json` 各引用一面。

```text
src/
  index.ts                  根插件：挂 service、tools、skills、settings、webServer；常驻 system prompt 身份段
  config.ts                 Config（dbPath、autoOpenCards、compareToleranceCents、outputTaxSubject13/3、companyName）
  rules/fee-types.ts        22 个费项（列序=日报表）、税率、预收科目、中文别名解析、冲抵优先级
  rules/tax.ts              整数分运算，tax = round(incl/(1+r)*r, 2)
  rules/summary.ts          凭证摘要模板
  service/finance-service.ts  ctx.hyFinance：持 SQLite 句柄，所有操作的门面
  service/types.ts, identifiers.ts, errors.ts
  provider/db/schema.ts     11 张表，PRAGMA user_version = 2，版本不符拒绝启动
  provider/db/repo.ts       行访问
  provider/import/*         七个导入器 + kind 自动识别（index.ts）
  provider/split/settlement.ts  T+1 日结拆分
  provider/claim/match.ts   三层匹配 → Suggestion[]
  provider/claim/allocate.ts    拆分登记 + 税额
  provider/claim/engine.ts  runClaims / listPending / confirmClaim / learnPayer
  provider/report/daily-report.ts  日报表构建、exceljs 导出、四轮比对
  tools/definitions/*       finance_status / finance_import / finance_claim / finance_daily_report
  webServer/plugin.ts       GET /api/hy-finance/merchants, POST /api/hy-finance/claim/confirm（卡片用）
  skills/plugin.ts          三份 SKILL.md 的按需加载
  settings/plugin.ts        设置命名空间 hy-finance
  shared/wire.ts            Host/Client 共享 JSON 类型（卡片元数据）
  client/                   设置卡、待认领卡片、日报表卡片（tool.call.toolview 键 finance_claim / finance_daily_report）
skills/hy-finance, hy-daily-report, hy-voucher   业务口径技能
tests/rules.spec.ts         纯函数单测（税额/费项别名/摘要模板），不需要样本数据，随时能跑
tests/import.smoke.spec.ts  真实数据验收（vitest 断言，见 §7），samples 目录不存在时整体 skip
```

数据库：`~/.dsh-hongyang/hongyang/finance.db`。改了 schema 就把 `HY_FINANCE_SCHEMA_VERSION` 加一并删掉这个文件重导（没有迁移）。

---

## 4. 已完成（4 个提交，`hongyang-demo` 分支）

| 步 | 提交 | 验收结果（真实数据） |
|---|---|---|
| 1 骨架 | `53ee9229ab` | 设置页出现"弘阳财务"卡，库自动建 |
| 2 导入+拆分 | `ed3af15a13` | 47 笔入库，342→318 商户（铺位号规范化后），3203 应收；22 笔日结 19 笔分毫对平，3 笔缺 3/31 明细 |
| 3 认领+卡片 | `d4fe8e9cfc` | 18 笔转账自动登记 12（2 笔无法识别，其余内部划转忽略），停车 4，微信电费 87，POS 附言 6；卡片确认 → Host 落库 → 模型收到上下文 |
| 4 日报表+比对+卡片 | `9d8f0d09fb` | 4/3：生成 12 行，台账 14 行，逐行一致 11；差异 3 行原因明确；xlsx 由 Univer 在会话里打开 |

另外换壳（品牌、配色、中文、深色）已完成并推送。

---

## 5. 未完成（按演示优先级）

### 第 5 步 凭证（P0，验收对象 4/3 凭证）

- `provider/voucher/build.ts`：输入 = 当日日报表行。行序照样本：借 1002.02 银行收款合计 / 借 1012.08 POS 收款合计；每商户×每费项：贷 预收科目（含税全额）→ 借 预收科目（税额）→ 贷 销项税科目（税额）；无税费项只一行贷；暂收款贷 2203.01.05。摘要用 `rules/summary.ts`。
- 校验：借贷平衡；费项税率 ↔ 销项税科目一致（9% 只能 2221.01.02.09），不一致标红；样本"依沐裳"就是一处 9% 挂 6% 科目的错。
- 13% 与 3% 销项税科目未确认（`config.outputTaxSubject13/3` 留空），含电费水费的凭证只出草稿并列出待确认项。12 个费项的预收科目也未确认（`FEE_RULES` 里 `subject: null`），同样处理。
- `provider/voucher/export.ts`：21 列 xlsx，列名见 spec §3；`compare.ts`：与 `voucher_row` 按 日期+科目+借贷方向+金额 比对。
- 工具 `finance_voucher { action: build|export|compare, date }`，元数据 `card: 'hy-finance/voucher'`，客户端加 `VoucherToolView`（照 `FinanceToolViews.tsx` 的两个现成例子）。
- 先看样本凭证怎么写的：`sqlite3 ~/.dsh-hongyang/hongyang/finance.db "select date,voucher_no,line_no,summary,subject,debit,credit from voucher_row where date='2026-04-03' order by voucher_no,line_no"`。

### 第 6 步 查询与登记（P1）

- `finance_query { kind: receivable_summary|merchant_balance|overdue|today, ... }`：几行 SQL；"愤怒弹珠还欠多少"要按品牌模糊找商户（用 `MerchantIndex.mentionedIn`）。
- `finance_register { text, image? }`：钉钉和网页共用。截图走 `ctx.llm.stream()`（有图片输入能力，无 JSON mode，让模型输出 JSON 再用 zod 校验），抽 金额/时间/单号/收款方；校验收款方 = `config.companyName`；文字抽 商户 + [{费项, 金额}]；写 `transaction(source='dingtalk')`，尝试按交易单号或金额+时间窗 ±2 分钟与 `platform_txn` 合并；商户命中则 `confirmClaim`，否则回"请回复商户名"。参考 `packages/session/session-title-llm/src/index.ts:254` 的一次性调用写法。

### 第 7 步 钉钉（P1，用户坚持要）

- 新包 `packages/hongyang/dingtalk`（`@deepseek-ai/dsh-hy-dingtalk`），依赖 `dingtalk-stream`（npm 有，2.1.6），Stream 模式无需公网。
- 收文字 / 图片（图片走 downloadCode 取图）→ 按钉钉 userId 建/续 agent 会话 → 调 `finance_register` → 回复"已登记：商户 费项 金额"或追问。
- 需要用户提供机器人 AppKey/AppSecret 和一部当运营的手机。凭据走 `ctx.credentials` 或设置卡的 secret 字段，不进 git。

### 第 8 步 演示彩排

- 用 `docs/hongyang/spec.md` §4 的 8 步走 3 遍；每步记录 token 用量（目前一次导入约 240K、一次日报表约 390K，缓存命中 90%+，可接受但别再加无关工具调用）。
- 交付前清理：卸掉 `dshmarket`、`dsh-find-plugin`；Univer 设置里关遥测；清掉 `~/.dsh-hongyang` 里的测试会话。

### 未做的小项

- `ui-chat` 里 "深度求索中..." 这条思考提示还是 DeepSeek 文案（`packages/client/ui-chat/src/client/locale.ts:25`），改成"思考中..."。
- 气泡里的模型名（GPT-6 Astra）要不要显示成"财务助手"，用户没定。
- `finance_status` 报告的待确认科目只读 `FEE_RULES`，还没把设置里填的 `outputTaxSubject13/3` 用起来（凭证那步要用）。

---

## 6. 已知隐患（改之前先知道）

**逻辑上的**

1. **"未收"的口径**。客户的应收表是事后快照，4 月的款已标"已收"，所以 `allocate.ts` 不用表里的 已收/未收，而是按本系统自己的登记记录算 open（`allocation.receivable_id`）。拆分默认"最新账期优先，逐期往前"。后果：一笔付多个月的款会被拆成多个月租金（奥龙鞋业 55743.60 拆成 3 个月），台账未必这么记。备注写了月份（"5-6月租金"）时按月份拆，更准。
2. **同品牌多主体**。"发发桌球"在应收表里挂了两个签约主体（湖南发发竞技、湖南亮点），备注只提品牌时自动认领可能选错主体。备注命中品牌给 0.88 置信直接自动登记，阈值 0.85 偏激进；可考虑同名多主体时降到 0.7 进队列。
3. **微信电费全部记"预付电费"**（`engine.ts` 里 `elec_pre`），台账里有些可能是"后付电费"，没核对。
4. **微信停车 654 单逐单登记**，日报表按天合并成一行；凭证也要合并，别一单一行。
5. **手动确认的费项拆分**：卡片只传铺位号，费项由代码推导；工具 `finance_claim confirm` 支持显式 `splits`，卡片没做这个输入。
6. **无附言 POS 157 笔**没有出路，只能等钉钉上报（第 7 步）或人工在对话里逐笔确认。
7. **比对键宽松**：四轮匹配的第三轮只看"同来源同金额"，理论上会把两笔金额相同的不同商户配错；4/1、4/3 数据上没出现。
8. **捷停车到账**我们记在到账日，台账按业务日或另一渠道记，比对会出"生成有台账无"。

**代码上的**

9. `webServer/plugin.ts` 的 confirm 路由只靠登录 cookie，`sessionId` 由前端给，没校验该会话属于当前用户（单机演示无所谓，交付要补）。
10. `daily_report` 表每 build 一次插一行，没清理；`rows_json` 会膨胀。
11. `importRecharge` 把充值记录塞进 `platform_txn`，`platform='wechat'`、`merchant_account='recharge'`，各处靠 `<> 'recharge'` 过滤，是个临时做法；充值记录目前没参与任何计算。
12. ~~没有 vitest 用例~~ 2026-09-13 已转成 `tests/rules.spec.ts`（纯函数）+ `tests/import.smoke.spec.ts`（真实组合，断言化了原来靠人眼看的 §7 基线数字）。没做的：认领/日报表以外的模块（凭证、查询、登记）还没有测试；4/1 那天的日报表比对没有客户确认过的基线数字，测试里只断言"不报错"，不是真的验证正确性。
17. **`rules/fee-types.ts` 的 `FEE_TYPES` 是 21 个费项，spec.md §3 的原话是"收入日报表格式.xlsx 第 3 行 22 个金额列"**——但交叉验证下来这大概率是 spec.md 那一句手滑数错，不是代码漏列：spec.md 紧接着那句话自己列出的费项名单也只有 21 个；`REPORT_HEADERS`（9 个固定列 + 21 个费项列 + 4 个尾部列）算出来正好是 34，和 CLAUDE.md、HANDOFF 反复讲的"日报表 34 列"对得上——如果真少了一个费项列，总数应该是 33 或者需要从别处再减一列才凑得出 34，但没有这种迹象。**即便如此，没人拿真实 `收入日报表格式.xlsx` 表头逐列核对过**（这台机器上没有样本文件核对不了），"大概率是文档笔误"不等于"已确认"——建议演示前顺手拿真实表头数一遍第 3 行，几分钟的事，比在凭证/日报表列错位之后再排查划算。见 `tests/rules.spec.ts` 里固定当前 21 这个数的那条测试。
13. `tools/definitions/*.ts` 里各自定义了一个 `JsonValue` 结构类型来绕 `type: 'json'` 的输出校验，应改成从 `@deepseek-ai/dsh-util-values` 引入并加 tsconfig 引用。
14. 客户端两张卡共用 `PendingClaimsCard.module.css`，样式 token 只用了 `--dsw-alias-*`，没问题，但文件名会误导。
15. `settings/plugin.ts` 的 `installSection` 改配置会 `reconfigure`，但 `dbPath` 改了要重启才生效，卡片提示里写了。
16. 换壳时改了 `apps/web/tests/pwa-manifest.e2e.ts` 的断言以适配新 favicon；上游其它 e2e 没跑过。

---

## 7. 验收脚本（改完任何后端逻辑都跑一遍）

```bash
cd /Users/shixin/Desktop/广场dsh/deepseek-harness
pnpm vitest run packages/hongyang/finance/tests
```

**2026-09-13 起，分支基线换成了 `dev`**（从 `弘阳Demo交付-2026-09-13/hongyang-test.bundle` 的 `test` 分支拉出来的，往前的开发继续在这条线上，见下方"分支基线"一条）。`tests/import.smoke.ts` 那个打印数字靠人眼比对的脚本已经删掉，改成两个 vitest 文件，**已经在 `dev` 分支上用真实样本数据跑通并逐条核对过**：

- `tests/rules.spec.ts`：纯函数（税额、费项别名、摘要模板），不需要样本数据，任何机器上都能跑，也进 CI。72 条里的 64 条在这。
- `tests/import.smoke.spec.ts`：内存库跑完整链路（导 8 份样本 → 拆分 → 认领 → 日报表构建/导出/比对）。以下是在 `dev` 分支实测确认的数字：
  - `split matched 19 unmatched 3`。
  - `claims run: bankAuto 12, parkingAuto 4, wechatElectricity 87, posAuto 7, pending 18`——posAuto 是 7，其中一笔是**"发发桌球停车（预存）"以 0.88 置信度自动认领给"湖南发发竞技"**——正好是已知隐患 #2 说的"品牌挂两个签约主体，自动认领可能选错主体"那个场景，不是假设，是真实数据里正在发生的自动入账，建议演示前人工确认这笔选对了没有。
  - **涂小兰那笔**：spec.md §3 写的是"人工认领后记住→炊牛大烩"，实测她的收款被 L1 精确户名匹配**自动**认领（置信度 0.95），对应商户的 `brand` 字段是**柴煲煲**，不是炊牛大烩——同一笔交易（金额 20062.56 分毫不差），判断是 spec.md 那句例子里品牌名写错了，不是真的存在两个"涂小兰"。建议顺手把 spec.md §3 那处改成"柴煲煲"。
  - `report 2026-04-03: matched 10 missing 3 extra 1 amount 1`——**`dev` 上的 `compareDailyReport` 比 `hongyang-demo` 严格**：不再只比对行小计，还按费项逐项比对，因此抓出了一个之前被算作"匹配"、实际是错的案例：长沙奥龙鞋业（2F-2029）生成的日报表把 55743.60 全记成租金，台账实际拆成租金 21918.60 + 经营服务费 33825.00——正是已知隐患 #1 说的多月/多费项拆分顺序问题，现在被测试真实抓出来了，不是比对逻辑退步。
  - `2026-04-01`：没有客户确认过的基线，测试只断言"能生成、不报错"，不是验证正确性。
  - 费项科目：`dev` 上电费/水费预收科目已确认（2203.30 / 2203.31），`rules.spec.ts` 里"未确认科目清单"从 12 项收窄到 9 项（`multi_warehouse / multi_ad / fixed_spot / temp_spot / parking / decor_deposit / fire_water / other / coupon`）。

**分支基线**：`dev` 分支（合并基点是本仓库 `968167372a`，即本文件最初写完时的 `hongyang-demo` HEAD）比 `hongyang-demo` 多 30 个提交，已经做完 HANDOFF §5 原来列的第 5/6/7 步（凭证生成/比对、`hy-query`、`hy-register` 文字+图片登记、完整 `hy-dingtalk` Stream 接入）。**本文件第 4、5 节描述的"已完成/未完成"状态是 `hongyang-demo` 当时的快照，在 `dev` 上已经过时**——`dev` 分支的能力状态和已知问题以交付包里的 `交付说明.md`（英文版 `DEMO_DELIVERY.md`）为准，尤其是"能力与开发清单"那张表；这两份文档还没合并，谁接手 `dev` 上的开发建议先读 `交付说明.md` 再回来对照本文件 §6 的隐患清单，两边有重叠但侧重点不同。

**一个需要留意的测试约定问题**：`dev` 分支自己新增的 `tests/query.test.ts`、`tests/register.test.ts`、`tests/register-image.test.ts`、`tests/voucher-audit.test.ts` 用的是 Node 内建 `node:test`（`import { test } from 'node:test'`），不是仓库标准的 vitest。`vitest.config.ts` 的扫描规则是 `packages/*/*/tests/**/*.spec.{ts,tsx}`，只认 `.spec.ts`——也就是说 `pnpm vitest run` / `pnpm run test` **不会跑到这四个文件**，它们目前处于"写了但不在常规测试流程里"的状态。要不要把它们改名成 `.spec.ts` 并迁到 vitest（这样才会被 CI/`pnpm test` 真正执行），是下一步该决定的事，这次 PR 没有动它们。

  **`import.smoke.spec.ts` 依赖 `docs/hongyang/samples/`（git 忽略，含客户真实数据），没有这份数据的机器上整个 suite 会自动 skip，不会报错也不会假装通过——运行结果里如果看到这些用例是 skip 而不是 pass，说明没跑到真实数据，不代表校验通过了。**

界面验收走 `docs/hongyang/spec.md` §4，用 `/Users/shixin/Desktop/sampel` 工作区。

---

## 8. 给 Codex 的第一条指令

> 先读 `docs/hongyang/HANDOFF.md`，再读 `docs/hongyang/spec.md`、`docs/hongyang/design.md`、`交付说明.md`（`dev` 分支当前能力状态以这份为准）和 `packages/hongyang/finance/README.md`。然后在 `dev` 分支上跑 `pnpm vitest run packages/hongyang/finance/tests`，确认 §7 列的断言全部通过（不是 skip——skip 说明样本数据没就位）。接着通读 `packages/hongyang/finance/src/`，对照 HANDOFF §6 的 16 条隐患和交付说明的能力清单，逐条说明你是否认同、是否有遗漏，但**先不要改任何代码**。所有金额计算放在 `provider/` 里，模型不碰钱。每完成一步跑一次测试，lint 通过后提交到 `dev` 分支（走 PR，不要直接 commit）。
