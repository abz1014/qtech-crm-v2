import { Skeleton } from '@/ui/Skeleton'
import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import type { JobSlotProps } from '@/features/jobs/slots'
import { OrderItemsPanel } from '@/features/orders/OrderItemsPanel'
import { TapText } from '@/features/orders/TapEdit'
import { useUpdateOrder } from '@/features/orders/hooks'
import { useEntryAccess } from '@/features/records/useEntryAccess'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'
import type { OrderHeader } from '@/features/orders/api'

/*
 * The Order stage of the job page (P5-D2): the customer PO, the order lines, Edit GST and lines and Remove line. Every piece is the
 * order page's own (OrderItemsPanel, TapText), so the two pages behave the same and nothing is written twice. Whose entry it is
 * (0092) is applied exactly as on the order page: somebody else's order keeps its PO, GST and prices closed with the reason said.
 */
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

export default function OrderWork({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.orderId) return null
  if (w.failed) return <p className="text-base text-fg-muted">The order did not load. Open the order page to try again.</p>
  if (!w.ready || !w.order || !w.items.data || !w.legs.data) return <Skeleton className="h-[10rem] w-full" />
  const basisUnknown = w.order.state?.dataTrust === 'basis_unknown'
  return (
    <div className="grid gap-3" data-order-work>
      {job.money ? <CustomerPo order={w.order} /> : null}
      <OrderItemsPanel order={w.order} items={w.items.data} legs={w.legs.data} money={job.money} canEdit={w.canEdit && job.money} basisUnknown={basisUnknown} pos={w.pos.data ?? []} />
    </div>
  )
}
