import { type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PackageSearch } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useLegPos, useOrderEngineers, useOrderHeader, useOrderItems, useOrderLegs, useOrderMoney } from '@/features/orders/hooks'
import { OrderHeaderBlock } from '@/features/orders/OrderHeaderBlock'
import { orderPrimary } from '@/features/orders/lib/primaryAction'
import { businessToday } from '@/lib/dates'
import { OrderItemsPanel } from '@/features/orders/OrderItemsPanel'
import { LegsPanel } from '@/features/orders/LegsPanel'
import { CommissioningPanel } from '@/features/orders/CommissioningPanel'
import { MarginPanel } from '@/features/orders/MoneyPanels'
import { AttachmentsPanel } from '@/features/rfqs/AttachmentsPanel'

/*
 * Order detail (O03; g2-order-detail.html). /orders/:id.
 *
 * Who sees what (DATA_MODEL section 10, DECISIONS 2026-10-13): admin and sales see prices, the invoicing and payment dimensions and the
 * balance; admin alone sees the costs dimension and the margin panel; an engineer sees the lines, the legs and the commissioning, and no
 * price, GST, supplier price, invoicing, payment or cost anywhere: those reads are not made. The mockup's engineer frame still draws
 * prices; the brief for this task overrides it (see DECISIONS, O01/O03).
 *
 * FE-2 entry burden, listed for the commit:
 *   required     nothing. Every action is a stamp or a toggle: Mark placed, Received today, Delivered today (1 tap each);
 *                Mark done today (1 tap, 0 typed). A cancel needs a reason (1 choice). Add line needs a description and a price;
 *                Add leg needs a supplier.
 *   pre-filled   today's date on every stamp; expected date from the placed date plus the supplier's lead time; terms from the last order;
 *                the leg's currency from what the supplier last used.
 *   optional     editing a stamped date, a leg reference, the customer PO number, the planned date, the order notes, GST per line.
 *
 * Marked places for later tasks (drawn disabled or as empty states, each naming its task): order-actions (M01 to M03), margin-costs (M03, M04),
 * invoices-payments (M01, M02), issue-po on each leg (O07).
 */

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 md:px-8">{children}</div>
}

/** The loading state in the final layout, so nothing jumps when the data arrives. */
function PageSkeleton() {
  return (
    <Shell>
      <div className="grid gap-4" aria-busy="true" aria-label="Loading order">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-5 w-72 max-w-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
        <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <div className="grid gap-6">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    </Shell>
  )
}

export default function OrderDetailScreen() {
  const { id } = useParams()
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const money = role === 'admin' || role === 'sales'
  const isAdmin = role === 'admin'
  const isEngineer = role === 'engineer'
  const header = useOrderHeader(id, money)
  const items = useOrderItems(id, money)
  const legs = useOrderLegs(id, items.data)
  const engineers = useOrderEngineers(id)
  const orderMoney = useOrderMoney(id, role === 'admin' ? 'admin' : role === 'sales' ? 'sales' : null)
  const pos = useLegPos(id, (legs.data ?? []).map(l => l.id), money)

  if (header.isPending) return <PageSkeleton />
  if (header.isError) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          title="This order did not load"
          actions={
            <>
              <Button variant="primary" onClick={() => void header.refetch()}>
                Try again
              </Button>
              <Link to="/orders" className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
                Back to orders
              </Link>
            </>
          }
          meta={
            <span className="num">
              When {new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · Request GET /orders/{id}
            </span>
          }
        >
          The order is safe. The request to the server did not finish before any data came back. Nothing you entered here was lost.
        </EmptyState>
      </Shell>
    )
  }
  if (!header.data) {
    return (
      <Shell>
        <EmptyState
          icon={PackageSearch}
          title="This order isn't here"
          actions={
            <Link to="/orders" className="inline-flex h-control items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground">
              All orders
            </Link>
          }
        >
          The link may be wrong, or the order was removed. Open the order list to find it.
        </EmptyState>
      </Shell>
    )
  }

  const order = header.data
  const canEdit = order.cancelledOn === null
  const loadError = items.isError || legs.isError
  const lists = items.data && legs.data
  const basisUnknown = order.state?.dataTrust === 'basis_unknown'
  // The page's ONE primary (green) button, chosen by the order's state (lib/primaryAction.ts). Worked out once, here, so the header draws it
  // and the panels below know not to repeat it.
  const primary = orderPrimary(order, legs.data ?? [], pos.data ?? [], role, orderMoney.data, businessToday())
  return (
    <Shell>
      <OrderHeaderBlock
        order={order}
        legs={legs.data ?? []}
        items={items.data ?? []}
        engineers={engineers.data ?? []}
        role={role}
        orderMoney={orderMoney.data}
        moneyLoading={money && orderMoney.isPending}
        pos={pos.data ?? []}
        primary={primary}
      />

      <div className="mt-6 grid gap-6">
        {loadError ? (
          <EmptyState
            mood="error"
            title="Couldn't load the items and supplier orders"
            actions={
              <Button
                variant="primary"
                onClick={() => {
                  void items.refetch()
                  void legs.refetch()
                }}
              >
                Try again
              </Button>
            }
          >
            Nothing was changed. Check your connection and try again.
          </EmptyState>
        ) : !lists ? (
          <div className="grid gap-4" aria-busy="true" aria-label="Loading items and supplier orders">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : (
          <>
            <OrderItemsPanel order={order} items={items.data} legs={legs.data} money={money} canEdit={canEdit && money} basisUnknown={basisUnknown} pos={pos.data ?? []} />
            <div className={isAdmin ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]' : 'grid gap-6'}>
              <div className="grid min-w-0 gap-6">
                <LegsPanel order={order} legs={legs.data} items={items.data} pos={pos.data ?? []} money={money} isAdmin={isAdmin} canEdit={canEdit} />
                <CommissioningPanel order={order} engineers={engineers.data ?? []} isEngineer={isEngineer} canEdit={canEdit} markDoneAbove={primary?.kind === 'mark-done'} />
                <AttachmentsPanel orderId={order.id} />
              </div>
              {/* The side column is admin's Margin (with the one order-level Add expense). Invoices and payments are in the header's status
                  strip, and the engineer's site is in the header's "Your job". */}
              {isAdmin ? (
                <aside className="grid min-w-0 gap-6 lg:col-start-2 lg:row-start-1" aria-label="Margin and costs">
                  <MarginPanel order={order} money={orderMoney.data} loading={orderMoney.isPending} error={orderMoney.isError} />
                </aside>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
