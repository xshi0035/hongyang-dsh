# 弘阳财务测试反馈 · 第二轮

> 代码走读发现,未做实际重复导入验证(不想污染测试库)。

## 案例04 · 重新导入应收表会产生重复行,不会替换旧数据

### 现象

`importReceivable`(`packages/hongyang/finance/src/provider/import/receivable.ts`)的文档注释写的是:

```
Import both sheets: upsert merchants, replace this file's receivable rows.
```

但实际实现:

```ts
const insert = db.prepare(`INSERT INTO receivable
  (id, merchant_id, fee_type, period, period_start, period_end, due_date, amount_due, amount_relief, amount_received, amount_unpaid, source_row)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
for (const r of parsed) {
  insert.run(newId<ReceivableId>('rcv'), ...)
}
```

全程只有 `INSERT`,**没有任何 `DELETE`**。`receivable` 表 schema 里也没有唯一约束能拦重复:

```sql
CREATE TABLE IF NOT EXISTS receivable (
  id TEXT PRIMARY KEY,   -- 每次都是新 UUID，永远不冲突
  merchant_id TEXT NOT NULL REFERENCES merchant(id),
  ...
) STRICT;
CREATE INDEX IF NOT EXISTS receivable_merchant ON receivable(merchant_id, fee_type);  -- 只是索引，不是唯一约束
```

### 对照:商户表(merchant)是安全的

`upsertMerchant`(同文件调用,定义在 `provider/db/repo.ts`)按 `shop_no`(唯一约束)查询,存在则 `UPDATE`,不存在才 `INSERT`,不会重复。

### 影响

同一份文件重新导入,或客户送来更新过的《租费应收明细表.xlsx》,再导入一次:

- 商户信息(名称/品牌/楼层)正确更新
- **应收记录(receivable)会在原有基础上再插一份全新的**,变成两倍、三倍叠加,不会替换旧数据
- 后续认领、日报表比对、"某商户还欠多少"类查询都会被重复数据污染,且不易第一时间察觉(行数变多容易被误认为"新增商户/新增账期")

### 建议

`importReceivable` 导入前应先按来源(比如同一 `merchant_id` 范围,或直接整表)删除旧的应收记录,再插入本次解析结果,行为对齐文档注释里写的"replace"。
