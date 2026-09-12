import { useState } from 'react'
import { IconChevronDownOutline14, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VoucherMetaWire } from '../shared/wire.ts'
import css from './PendingClaimsCard.module.css'

const CUSTOMER_CONFIRMATION_ITEMS = [
  'UONE 代收款与普通停车充值对应的 POS 订单',
  '发发桌球停车充值的签约主体',
  '13% 和 3% 销项税科目编码及名称',
  '预付/后付水电费、停车费的预收科目',
  '业务日还是到账日作为制证日期，以及手续费处理方式',
] as const

export function VoucherCard(props: { meta: VoucherMetaWire; autoOpen: () => boolean }) {
  const { meta } = props
  const [open, setOpen] = useState(() => props.autoOpen())
  return <section className={css.card}>
    <button type="button" className={css.header} aria-expanded={open} onClick={() => { setOpen(!open) }}>
      <span className={css.title}>金蝶凭证 {meta.date}</span><Tag tone={meta.balanced ? 'neutral' : 'outline'}>{meta.balanced ? '借贷平衡' : '借贷不平'}</Tag>
      <span className={css.subtitle}>{meta.lines} 行</span>
      <span className={css.spacer} />
      <IconChevronDownOutline14 className={open ? css.chevronOpen : css.chevron} />
    </button>
    {open && <div className={css.body}>
      {(meta.warnings.length > 0 || (meta.compare?.diffs.length ?? 0) > 0) && <div className={css.error}>
        <strong>待客户确认</strong>
        <div>以下事项不会进入正式凭证，确认后再重新生成：</div>
        <ul>{CUSTOMER_CONFIRMATION_ITEMS.map(item => <li key={item}>{item}</li>)}</ul>
        {meta.warnings.length > 0 && <div>当前规则提示：{meta.warnings.join('、')}</div>}
      </div>}
      {meta.compare !== undefined && <div className={css.sectionTitle}>
        逐行比对：一致 {meta.compare.matched} 行，差异 {meta.compare.diffs.length} 行
      </div>}
      {meta.compare !== undefined && meta.compare.diffs.length > 0 && <div className={css.tableWrap}><table className={css.table}>
        <thead><tr><th>行</th><th>客户科目</th><th className={css.amount}>客户金额</th><th>系统科目</th><th className={css.amount}>系统金额</th></tr></thead>
        <tbody>{meta.compare.diffs.slice(0, 40).map((diff) => {
          const expected = diff.expected as { subject?: string; debit?: number; credit?: number } | null
          const actual = diff.actual as { subject?: string; debit?: number; credit?: number } | null
          return <tr key={diff.line}><td>{diff.line}</td><td>{expected?.subject ?? '—'}</td><td className={css.amount}>{expected === null ? '—' : ((expected.debit ?? expected.credit ?? 0) / 100).toFixed(2)}</td><td>{actual?.subject ?? '—'}</td><td className={css.amount}>{actual === null ? '—' : ((actual.debit ?? actual.credit ?? 0) / 100).toFixed(2)}</td></tr>
        })}</tbody>
      </table></div>}
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead><tr><th>行</th><th>摘要</th><th>科目</th><th>科目全名</th>
            <th className={css.amount}>借方</th><th className={css.amount}>贷方</th></tr></thead>
          <tbody>{meta.voucherLines.map(line => (
            <tr key={line.lineNo}><td>{line.lineNo}</td><td>{line.summary}</td><td>{line.subject || '待确认'}</td>
              <td className={css.muted}>{line.subjectName || '—'}</td><td className={css.amount}>{line.debit}</td>
              <td className={css.amount}>{line.credit}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {meta.xlsxPath !== undefined && <div className={css.footer}>已导出：{meta.xlsxPath}</div>}
    </div>}
  </section>
}
