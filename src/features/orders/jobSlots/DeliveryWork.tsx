import { Skeleton } from '@/ui/Skeleton'
import type { JobSlotProps } from '@/features/jobs/slots'
import { CommissioningPanel } from '@/features/orders/CommissioningPanel'
import { LegsPanel } from '@/features/orders/LegsPanel'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'

/*
 * The Delivery stage of the job page (P5-D2): the goods coming in and the installation. "Delivered today" (ONE button per supplier
 * order, here and nowhere else on this page), Chase goods and the expected date (taps to edit) come from LegsPanel with
 * part="delivery"; then Commissioning (plan it: date, visit time and type, engineers; Mark done), the order page's own panel.
 * An engineer gets the same without a price.
 */
export default function DeliveryWork({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.orderId) return null
  if (w.failed) return <p className="text-base text-fg-muted">The delivery details did not load. Open the order page to try again.</p>
  if (!w.ready || !w.order || !w.items.data || !w.legs.data) return <Skeleton className="h-40 w-full" />
  return (
    <div className="grid gap-3" data-delivery-work>
      {w.legs.data.length > 0 ? (
        <LegsPanel order={w.order} legs={w.legs.data} items={w.items.data} pos={w.pos.data ?? []} money={job.money} isAdmin={job.role === 'admin'} canEdit={w.canEdit} part="delivery" />
      ) : null}
      <CommissioningPanel order={w.order} engineers={w.engineers.data ?? []} isEngineer={job.role === 'engineer'} canEdit={w.canEdit} />
    </div>
  )
}
