import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { formatPaisa, paisaToFixed, toPaisa, type Amount } from '@/lib/money'

const abs = (p: bigint) => (p < 0n ? -p : p)

/*
 * SumBar: the summary strip at the top of a Money view (money-07, money-10):
 * a row of key figures, each a small label, a big mono figure and one line of
 * context. Hairlines between cells; two columns on a phone or tablet.
 */
export interface SumBarItem {
  label: string
  /** An amount, shown as PKR in mono. Use `count` for a figure that is not money. */
  amount?: Amount | null
  /** The figure is a count, not money. */
  count?: number
  /** One line of context: "6 payments received". */
  sub?: ReactNode
  provisional?: boolean
}

export function SumBar({ items, label, className }: { items: SumBarItem[]; label: string; className?: string }) {
  return (
    <section
      aria-label={label}
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded border bg-line md:grid-flow-col md:auto-cols-fr md:grid-cols-none',
        className,
      )}
    >
      {items.map(item => (
        <div key={item.label} className="grid min-w-0 content-start gap-[2px] bg-surface px-5 py-4">
          <span className="text-xs font-medium text-fg-muted">{item.label}</span>
          {item.count !== undefined ? (
            <span className="num text-xl font-medium tracking-snug">{item.count}</span>
          ) : (
            <Money value={item.amount} size="xl" provisional={item.provisional} />
          )}
          {item.sub ? <span className="text-xs text-fg-muted">{item.sub}</span> : null}
        </div>
      ))}
    </section>
  )
}

/*
 * AfterDrawings (Amendment A6): the lines below a month's result. "Not in P&L"
 * (owner drawings, loan repayments) is set apart by a dashed rule and a quieter
 * surface, never mixed into the result, and "After drawings" follows. After
 * drawings is result minus not-in-P&L, computed in paisa; if the source also
 * supplies it and it disagrees, the supplied figure is shown with a flag.
 */
export interface AfterDrawingsProps {
  result: Amount
  /** Total of the Not in P&L group, as a positive amount. */
  notInPnl: Amount
  /** `after_drawings` from v_month_pnl, checked against result - notInPnl. */
  afterDrawings?: Amount | null
  className?: string
}

export function AfterDrawings({ result, notInPnl, afterDrawings, className }: AfterDrawingsProps) {
  const computed = toPaisa(result) - toPaisa(notInPnl)
  const mismatch = afterDrawings !== null && afterDrawings !== undefined && toPaisa(afterDrawings) !== computed
  const shown = mismatch ? toPaisa(afterDrawings) : computed
  return (
    <dl
      data-mismatch={mismatch ? '' : undefined}
      className={cn('grid gap-2 rounded border border-dashed border-line-strong bg-sunken px-5 py-3 text-sm', className)}
    >
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-fg-muted">Not in P&amp;L: drawings and loan repayments</dt>
        <dd>
          <Money value={paisaToFixed(-abs(toPaisa(notInPnl)))} className="text-fg-2" />
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-4 border-t border-dashed border-line-strong pt-2">
        <dt className="font-medium">After drawings</dt>
        <dd className="flex flex-wrap items-baseline justify-end gap-x-2">
          {mismatch ? (
            <span className="flex items-center gap-1 text-xs text-tone-warning-fg">
              <Icon icon={CircleAlert} size="chip" />
              {`Result less drawings is PKR ${formatPaisa(computed)}`}
            </span>
          ) : null}
          <Money value={paisaToFixed(shown)} size="lg" strong />
        </dd>
      </div>
    </dl>
  )
}
