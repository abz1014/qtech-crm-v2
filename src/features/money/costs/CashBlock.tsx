import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'
import type { OrderCash } from '@/features/money/costs/api'

/*
 * "Cash so far" on the Margin panel (0137): what was received for the order, what was paid out, and what is left. The margin above
 * it leaves GST out on both sides; this block does not, and says so. Admin only (the panel is). Plain figures, no rating.
 */
const LINE = 'flex items-baseline justify-between gap-4 text-sm'

export function CashBlock({ cash, loading, error }: { cash: OrderCash | null | undefined; loading: boolean; error: boolean }) {
  return (
    <section aria-label="Cash so far" data-testid="margin-cash" className="grid gap-1 border-t pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold">Cash so far</h3>
        <span className="text-sm text-fg-muted">includes GST</span>
      </div>
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading cash so far" className="grid gap-2">
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error || !cash ? (
        <p className="text-sm text-fg-muted">The cash figures could not be read. Reload the page to try again.</p>
      ) : (
        <>
          <div className={LINE}>
            <span className="text-fg-2">Received</span>
            <span className="num text-right">{formatAmount(cash.received)}</span>
          </div>
          <div className={LINE}>
            <span className="text-fg-2">Paid out</span>
            <span className="num text-right">{formatAmount(cash.paidOut)}</span>
          </div>
          <div className={cn(LINE, 'font-medium', cash.left < 0 ? 'text-tone-danger-fg' : 'text-fg')}>
            <span>Left</span>
            <span className="num text-right" data-testid="margin-cash-left">
              {formatAmount(cash.left)}
            </span>
          </div>
        </>
      )}
    </section>
  )
}
