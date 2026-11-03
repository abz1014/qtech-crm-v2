import { Suspense, useState } from 'react'
import { Scale } from 'lucide-react'
import { lazyWithReload } from '@/lib/importWithReload'
import { lazyShown } from '@/lib/lazyDialog'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import type { JobSlotProps } from '@/features/jobs/slots'
import { OrderItemsPanel } from '@/features/orders/OrderItemsPanel'
import { TapText } from '@/features/orders/TapEdit'
import { useUpdateOrder } from '@/features/orders/hooks'
import { useEntryAccess } from '@/features/records/useEntryAccess'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'
import type { OrderHeader, OrderItemRow, OrderMoney } from '@/features/orders/api'

/*
 * The Order stage of the job page (P5-D2): the customer PO, the order lines, Edit GST and lines and Remove line. Every piece is the
 * order page's own (OrderItemsPanel, TapText), so the two pages behave the same and nothing is written twice. Whose entry it is
 * (0092) is applied exactly as on the order page: somebody else's order keeps its PO, GST and prices closed with the reason said.
 */
/** "Is GST included in these prices?" on an imported order whose price basis was never recorded: the admin answers it here. */
function BasisQuestion({ order, items, money, admin }: { order: OrderHeader; items: readonly OrderItemRow[]; money: OrderMoney | null | undefined; admin: boolean }) {
  const [resolving, setResolving] = useState(false)
  return (
    <>
      <Banner
        tone="warning"
        title="Is GST included in these prices?"
        action={
          admin ? (
            <Button icon={Scale} onClick={() => setResolving(true)}>
              Is GST included?
            </Button>
          ) : undefined
        }
      >
        The old CRM did not say. Until someone answers, this order is left out of margin, GST totals and the net cash that counts towards targets.
      </Banner>
      {resolving ? <ResolveBasisDialog order={order} items={items} money={money} onClose={() => setResolving(false)} /> : null}
    </>
  )
}

function CustomerPo({ order }: { order: OrderHeader }) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id, order.updatedAt)
  const entry = useEntryAccess({ createdBy: order.createdBy ?? null, ownerId: order.owner?.id ?? null })
  const cancelled = order.cancelledOn !== null
  return (
    <p className="text-base text-fg-2" data-slot="customer-po">
      Customer PO{' '}
      <TapText
        value={order.customerPo}
        label="Customer PO number"
        empty="add"
        placeholder="Not yet received"
        disabled={cancelled || !entry.can}
        render={v => <span className="num">{v}</span>}
        onSave={async v => {
          try {
            await update.mutateAsync({ customer_po_number: v })
          } catch (err) {
            toast({ title: 'Could not save the PO number', body: mapPgError(err, { entity: 'PO number' }).message, tone: 'danger' })
            return false // the editor stays open with what was typed
          }
        }}
      />
      {!entry.can && !cancelled && entry.note ? (
        <span className="ml-2" role="note" data-slot="not-yours">
          {`${entry.note}.`}
        </span>
      ) : null}
    </p>
  )
}

// Admin only, downloaded when the Order stage is opened: the margin card (expected cost, costs complete) and the unknown price basis question.
const MarginPanel = lazyWithReload(() => import('@/features/money/costs/MarginPanel').then(m => ({ default: m.MarginPanel })))
const ResolveBasisDialog = lazyShown(() => import('@/features/orders/ResolveBasisDialog').then(m => m.ResolveBasisDialog))

export default function OrderWork({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.orderId) return null
  if (w.failed) return <p className="text-base text-fg-muted">The order did not load. Reload the page to try again.</p>
  if (!w.ready || !w.order || !w.items.data || !w.legs.data) return <Skeleton className="h-[10rem] w-full" />
  const basisUnknown = w.order.state?.dataTrust === 'basis_unknown'
  const admin = job.role === 'admin'
  return (
    <div className="grid gap-3" data-order-work>
      {basisUnknown && job.money ? <BasisQuestion order={w.order} items={w.items.data} money={w.orderMoney.data} admin={admin} /> : null}
      {job.money ? <CustomerPo order={w.order} /> : null}
      <OrderItemsPanel order={w.order} items={w.items.data} legs={w.legs.data} money={job.money} canEdit={w.canEdit && job.money} basisUnknown={basisUnknown} pos={w.pos.data ?? []} />
      {admin ? (
        <Suspense fallback={<Skeleton className="h-[8rem] w-full" />}>
          <MarginPanel order={w.order} money={w.orderMoney.data} loading={w.orderMoney.isPending} error={w.orderMoney.isError} />
        </Suspense>
      ) : null}
    </div>
  )
}
