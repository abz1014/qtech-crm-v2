import { type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PackageSearch } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useOrderEngineers, useOrderHeader, useOrderItems, useOrderLegs } from '@/features/orders/hooks'
import { OrderHeaderBlock } from '@/features/orders/OrderHeaderBlock'
import { OrderItemsPanel } from '@/features/orders/OrderItemsPanel'
import { LegsPanel } from '@/features/orders/LegsPanel'
import { CommissioningPanel } from '@/features/orders/CommissioningPanel'

/*
 * Order detail (O03; g2-order-detail.html). /orders/:id.
 *
 * Who sees what (DATA_MODEL section 10, DECISIONS 2026-10-13): admin and sales see prices and the invoicing dimension; an engineer sees
 * the lines, the legs and the commissioning, and no price, GST, supplier price, invoicing or total anywhere: those reads are not made.
 * The mockup's engineer frame still shows prices; the brief for this task overrides it (see DECISIONS, O01/O03).
 *
 * FE-2 entry burden, listed for the commit:
 *   required     nothing. Every action is a stamp or a toggle: Mark placed, Received today, Delivered today (1 tap each);
 *                Mark done today (1 tap, 0 typed). A cancel needs a reason (1 choice).
 *   pre-filled   today's date on every stamp; expected date from the placed date plus the supplier's lead time; terms from the last order.
 *   optional     editing a stamped date, a leg reference, the customer PO number, the planned date, the order notes, GST per line.
 *
 * Slots for later tasks (empty elements, marked data-slot): order-actions (M01 to M03), margin-costs (M04), invoices-payments (M01, M02),
 * issue-po on each leg (O07), add-leg.
 */

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 md:px-8">{children}</div>
}

function PageSkeleton() {
  return (
    <Shell>
      <div className="grid gap-4" aria-busy="true" aria-label="Loading order">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-5 w-72 max-w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
        <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
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
  const isEngineer = role === 'engineer'
  const header = useOrderHeader(id, money)
  const items = useOrderItems(id, money)
  const legs = useOrderLegs(id, items.data)
  const engineers = useOrderEngineers(id)

  if (header.isPending) return <PageSkeleton />
  if (header.isError) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          title="Couldn't load this order"
          actions={
            <Button variant="primary" onClick={() => void header.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
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
  return (
    <Shell>
      <OrderHeaderBlock order={order} legs={legs.data ?? []} engineers={engineers.data ?? []} isEngineer={isEngineer} money={money} />

      <div className="mt-6 grid gap-6">
        {loadError ? (
          <EmptyState
            mood="error"
            title="Couldn't load the items and legs"
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
          <div className="grid gap-4" aria-busy="true" aria-label="Loading items and legs">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : (
          <>
            <OrderItemsPanel orderId={order.id} items={items.data} legs={legs.data} money={money} canEdit={canEdit && money} />
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid min-w-0 gap-6">
                <LegsPanel order={order} legs={legs.data} items={items.data} money={money} canEdit={canEdit} />
                <CommissioningPanel order={order} engineers={engineers.data ?? []} isEngineer={isEngineer} canEdit={canEdit} />
              </div>
              <aside className="grid min-w-0 gap-6" aria-label="Site and money">
                <section aria-label="Site" className="rounded border bg-surface">
                  <h2 className="border-b px-5 py-4 text-base font-semibold">Site</h2>
                  <dl className="grid gap-3 px-5 py-4 text-sm">
                    <div className="flex justify-between gap-4 border-b pb-3">
                      <dt className="text-fg-muted">Delivery site</dt>
                      <dd className="min-w-0 text-right">{order.site?.name ?? <span className="text-fg-muted">Not set</span>}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-fg-muted">Address</dt>
                      <dd className="min-w-0 text-right">{order.site?.address ?? <span className="text-fg-muted">Not set</span>}</dd>
                    </div>
                  </dl>
                </section>
                {/* data-slot="margin-costs" (M04, admin only): the margin panel with expected cost and tagged expenses. */}
                {role === 'admin' ? <div data-slot="margin-costs" /> : null}
                {/* data-slot="invoices-payments" (M01, M02; admin and sales): invoices, payments and the balance. */}
                {money ? <div data-slot="invoices-payments" /> : null}
              </aside>
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
