import { useState } from 'react'
import { Plus } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { lazyShown } from '@/lib/lazyDialog'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/form/Select'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import type { JobSlotProps } from '@/features/jobs/slots'
import { LegsPanel } from '@/features/orders/LegsPanel'
import { useUpdateItem } from '@/features/orders/hooks'
import type { OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'

const AddLegDialog = lazyShown(() => import('@/features/orders/AddDialogs').then(m => m.AddLegDialog))

/*
 * The Supplier order stage of the job page (P5-D2): who each line is bought from, and the supplier orders themselves: Mark placed
 * (no PO), Issue PO and Revise PO, Pay supplier (LegsPanel with part="order": the same component and rows as the order page; the
 * delivery buttons are in the Delivery stage). Lines with no supplier are listed first, each with a "Choose supplier" menu of the
 * suppliers already on this order, and "Add supplier" for a new one. A service has no supplier. Admin and sales only: an engineer
 * is shown the supplier orders and no price, and chooses nothing.
 */
function ChooseSuppliers({ order, items, legs }: { order: OrderHeader; items: readonly OrderItemRow[]; legs: readonly OrderLegRow[] }) {
  const { toast } = useToast()
  const update = useUpdateItem(order.id)
  const [adding, setAdding] = useState(false)
  const unsourced = items.filter(i => !i.isService && !i.legId)
  if (unsourced.length === 0) return null
  return (
    <section aria-label="Lines with no supplier" className="rounded-panel border bg-surface" data-slot="choose-supplier">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h3 className="text-base font-semibold">{unsourced.length === 1 ? '1 line has no supplier' : `${unsourced.length} lines have no supplier`}</h3>
        <Button size="sm" icon={Plus} className="ml-auto" onClick={() => setAdding(true)}>
          Add supplier
        </Button>
      </div>
      <ul className="divide-y">
        {unsourced.map(it => (
          <li key={it.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
            <span className="min-w-0 text-base [overflow-wrap:anywhere]">
              <span className="font-medium">{it.description}</span> <span className="num text-fg-muted">{`× ${it.qty}`}</span>
            </span>
            <Select
              aria-label={`Choose supplier, ${it.description}`}
              value=""
              placeholder={legs.length === 0 ? 'Add a supplier first' : 'Choose supplier'}
              disabled={legs.length === 0 || update.isPending}
              options={legs.map(l => ({ value: l.id, label: `${l.supplierName}${l.currency ? ` (${l.currency})` : ''}` }))}
              onChange={e => {
                const legId = e.target.value
                if (!legId) return
                update.mutate(
                  { id: it.id, patch: { supplier_order_id: legId } },
                  {
                    onSuccess: () => toast({ title: 'Supplier chosen', body: it.description, tone: 'success' }),
                    onError: err => toast({ title: 'Could not choose the supplier', body: mapPgError(err, { entity: 'line' }).message, tone: 'danger' }),
                  },
                )
              }}
            />
          </li>
        ))}
      </ul>
      {adding ? <AddLegDialog order={order} legs={legs} onClose={() => setAdding(false)} /> : null}
    </section>
  )
}

export default function SupplierOrderWork({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.orderId) return null
  if (w.failed) return <p className="text-base text-fg-muted">The supplier orders did not load. Open the order page to try again.</p>
  if (!w.ready || !w.order || !w.items.data || !w.legs.data) return <Skeleton className="h-40 w-full" />
  return (
    <div className="grid gap-3" data-supplier-order-work>
      {job.money && w.canEdit ? <ChooseSuppliers order={w.order} items={w.items.data} legs={w.legs.data} /> : null}
      <LegsPanel order={w.order} legs={w.legs.data} items={w.items.data} pos={w.pos.data ?? []} money={job.money} isAdmin={job.role === 'admin'} canEdit={w.canEdit} part="order" />
    </div>
  )
}
