import { Banknote, Lock } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Margin } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import type { OrderHeader, OrderMoney } from '@/features/orders/api'

/*
 * The two money panels of the order page (g2-order-detail.html): "Margin" (admin only) and "Invoices and payments" (admin and sales).
 *
 * Built here with the real layout and the figures the database already gives (v_order_money for admin, order_receivables() for sales:
 * a balance, never a payment row, never a cost or a margin for sales). What each panel still waits for is shown as a real empty state
 * and as a disabled control that names its task. TRACKED GAPS: expense rows, "Expected cost: Edit", "Mark costs complete", "Add expense"
 * (M03, M04); invoice rows, "Create invoice" (M01); payment rows and "Record payment" (M02).
 */
const ROW = 'flex items-baseline justify-between gap-4 text-sm'
const LABEL = 'min-w-0 text-fg-2'

function Row({ label, sub, children, strong }: { label: string; sub?: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={ROW}>
      <span className={cn(LABEL, strong && 'font-medium text-fg')}>
        {label}
        {sub ? <span className="ml-2 text-xs text-fg-muted">{sub}</span> : null}
      </span>
      <span className="num shrink-0 text-right">{children}</span>
    </div>
  )
}

export function MarginPanel({ order, money, loading, error }: { order: OrderHeader; money: OrderMoney | null | undefined; loading: boolean; error: boolean }) {
  const m = money
  const unknown = m?.marginState === 'basis_unknown'
  const costsComplete = m?.costsState === 'complete'
  const actual = m?.actualCost ?? 0
  const expected = m?.expectedCost ?? null
  const stillToPay = expected !== null ? Math.max(expected - actual, 0) : null
  const ifExpected = m && expected !== null && m.netSale !== null ? m.netSale - expected : null
  const share = expected && expected > 0 ? Math.min(actual / expected, 1) : 0
  return (
    <section aria-label="Margin" data-slot="margin-costs" className="rounded border bg-surface">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <h2 className="text-base font-semibold">Margin</h2>
        {unknown ? <StatusBadge dimension="trust" value="basis-unknown" /> : m ? <StatusBadge dimension="costs" value={costsComplete ? 'complete' : 'provisional'} /> : null}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-fg-muted">
          <Icon icon={Lock} size="chip" /> Admin only
        </span>
      </div>
      {loading ? (
        <div className="grid gap-3 p-5" aria-busy="true" aria-label="Loading margin">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error || !m ? (
        <p className="p-5 text-sm text-fg-muted">The margin could not be read. Reload the page to try again.</p>
      ) : (
        <div className="grid gap-4 p-5">
          <div className="grid gap-1 rounded border border-dashed border-line-strong p-4">
            <div className="flex items-baseline justify-between gap-3 text-sm text-fg-2">
              <span>{unknown ? 'Margin' : 'Margin so far'}</span>
              <span className="text-xs text-fg-muted">{unknown ? 'Not calculated' : 'Net sale less costs paid'}</span>
            </div>
            <div className="text-xl">
              <Margin value={m.margin} state={m.marginState as 'provisional' | 'final' | 'basis_unknown' | null} size="xl" />
            </div>
            <p className="text-sm text-fg-2">
              {unknown
                ? 'Net sale is unknown while the price basis is unknown. Resolve it from the order header.'
                : costsComplete
                  ? 'Final. Costs are marked complete.'
                  : expected !== null
                    ? `Provisional. Only ${formatAmount(actual)} of an expected ${formatAmount(expected)} has been paid out. It becomes final when you mark costs complete.`
                    : 'Provisional. No expected cost is set, so only costs paid so far are counted. It becomes final when you mark costs complete.'}
            </p>
          </div>

          {expected !== null ? (
            <>
              <div aria-hidden="true" className="flex h-2 overflow-hidden rounded bg-selected">
                <span className="bg-fg" style={{ width: `${share * 100}%` }} />
              </div>
              <div className="grid gap-1">
                <Row label="Paid out">{formatAmount(actual)}</Row>
                <Row label="Still to pay, from expected cost">{stillToPay !== null ? formatAmount(stillToPay) : '—'}</Row>
                <Row label="Margin if costs land as expected">{ifExpected !== null ? formatAmount(ifExpected) : '—'}</Row>
              </div>
            </>
          ) : null}

          <div className="grid gap-1 border-t pt-4">
            <Row label="Net sale" sub={order.state?.invoicing === 'not_invoiced' ? 'from items, not yet invoiced' : 'invoiced'} strong>
              {m.netSale !== null ? formatAmount(m.netSale) : '—'}
            </Row>
            <Row label="Expected cost" sub="set with Expenses">
              {expected !== null ? formatAmount(expected) : <span className="text-fg-muted">Not set</span>}
            </Row>
            <Row label="Actual cost">{formatAmount(actual)}</Row>
          </div>

          <p className="rounded border border-dashed p-3 text-sm text-fg-muted" data-testid="margin-expenses-empty">
            {actual > 0 ? 'The expenses tagged to this order are listed here when Expenses arrives.' : 'No expense is tagged to this order yet. Expenses tagged to it, with their dates and payees, are listed here.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button disabled title="Arrives with Expenses (M04)">
              Mark costs complete
            </Button>
          </div>
          <p className="text-xs text-fg-muted">GST sits outside margin on both sides. Expenses are recorded at true cost, without recoverable input tax.</p>
        </div>
      )}
    </section>
  )
}

export function InvoicesPanel({ order, money, loading, error, isAdmin }: { order: OrderHeader; money: OrderMoney | null | undefined; loading: boolean; error: boolean; isAdmin: boolean }) {
  const m = money
  const invoiced = order.state?.invoiced ?? null
  const terms = order.paymentTermsDays
  return (
    <section aria-label="Invoices and payments" data-slot="invoices-payments" className="rounded border bg-surface">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <h2 className="text-base font-semibold">Invoices and payments</h2>
        {isAdmin ? (
          <Button size="sm" variant="quiet" icon={Banknote} className="ml-auto" disabled title="Arrives with Payments (M02)">
            Record payment
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="grid gap-3 p-5" aria-busy="true" aria-label="Loading invoices and payments">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error || !m ? (
        <p className="p-5 text-sm text-fg-muted">The balance could not be read. Reload the page to try again.</p>
      ) : (
        <div className="grid gap-3 p-5">
          <Row label="Invoiced">{invoiced !== null && invoiced > 0 ? formatAmount(invoiced) : <span className="text-fg-muted">Nothing yet</span>}</Row>
          <Row label={invoiced !== null && invoiced > 0 ? 'Gross to invoice' : 'Gross to invoice, from items'}>{formatAmount(m.grossTarget)}</Row>
          <div className="border-t pt-3">
            {m.settled > 0 ? (
              <Row label="Received">{formatAmount(m.settled)}</Row>
            ) : (
              <p className="text-sm text-fg-muted" data-testid="payments-empty">
                No payment has been received yet.
              </p>
            )}
          </div>
          <div className="border-t pt-3">
            <Row label="Balance" strong>
              <span data-testid="order-balance">{formatAmount(m.balance)}</span>
            </Row>
          </div>
          <p className="text-xs text-fg-muted">
            {m.dueOn
              ? `Due ${formatDay(m.dueOn)}.`
              : `Due date starts when the invoice is issued${terms !== null ? `, ${terms} days from its date` : ''}.`}
          </p>
        </div>
      )}
    </section>
  )
}
