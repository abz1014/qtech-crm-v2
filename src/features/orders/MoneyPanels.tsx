import { formatDay } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { RecordPaymentButton } from '@/features/money/OrderMoneyButtons'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'
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

// The Margin panel (M04) lives with the other money code: it is admin only and reads order_costs, expenses and v_order_money.
export { MarginPanel } from '@/features/money/costs/MarginPanel'

export function InvoicesPanel({ order, money, loading, error, isAdmin }: { order: OrderHeader; money: OrderMoney | null | undefined; loading: boolean; error: boolean; isAdmin: boolean }) {
  const m = money
  const invoiced = order.state?.invoiced ?? null
  const terms = order.paymentTermsDays
  return (
    <section aria-label="Invoices and payments" data-slot="invoices-payments" className="rounded border bg-surface">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <h2 className="text-base font-semibold">Invoices and payments</h2>
        {isAdmin ? (
          <RecordPaymentButton orderId={order.id} size="sm" variant="quiet" className="ml-auto" />
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
