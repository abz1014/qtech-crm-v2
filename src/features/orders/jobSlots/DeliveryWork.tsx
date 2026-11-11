import { useState } from 'react'
import { CircleCheck, CircleDashed, FileText } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { FoldRow } from '@/ui/FoldRow'
import { Skeleton } from '@/ui/Skeleton'
import type { JobSlotProps } from '@/features/jobs/slots'
import { ChallansPanel } from '@/features/orders/challans/ChallansPanel'
import { useOrderChallans } from '@/features/orders/challans/hooks'
import { CommissioningPanel } from '@/features/orders/CommissioningPanel'
import { LegsPanel } from '@/features/orders/LegsPanel'
import { visitTypeLabel } from '@/features/orders/lib/visit'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'
import type { OrderHeader, PersonRow } from '@/features/orders/api'

/*
 * The Delivery stage of the job page (P5-D2): the goods coming in and the installation. One hairline list (clarity redesign, no box in a
 * box): "Delivered today" (ONE button per supplier order, here and nowhere else on this page), Chase goods and the expected date (taps to
 * edit) come from LegsPanel with part="delivery"; then Commissioning and Delivery challans as two closed rows whose summaries already show
 * their values (plan it: date, visit type, engineers; Mark done today is the one on this page, inside Commissioning).
 * An engineer gets neither: their buttons are on the site card (EngineerActions).
 */
function commissioningSummary(order: OrderHeader, engineers: readonly PersonRow[], today: string): string {
  if (!order.needsCommissioning) return 'Supply only'
  const type = visitTypeLabel(order.visitType) || 'Installation'
  const when = order.doneOn ? `done ${formatShortDate(order.doneOn, today)}` : order.plannedOn ? `planned ${formatShortDate(order.plannedOn, today)}` : 'not planned'
  const who = engineers.length ? ` · ${engineers.map(e => e.name).join(', ')}` : ''
  return `${type} ${when}${who}`
}

export default function DeliveryWork({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  const challans = useOrderChallans(w.orderId ?? '')
  const [commissioning, setCommissioning] = useState(false)
  const [papers, setPapers] = useState(false)
  // An engineer's Delivered today and Installed today are on the site card of their job page (EngineerActions): not a second one here.
  if (!w.orderId || job.role === 'engineer') return null
  if (w.failed) return <p className="text-base text-fg-muted">The delivery details did not load. Reload the page to try again.</p>
  if (!w.ready || !w.order || !w.items.data || !w.legs.data) return <Skeleton className="h-[10rem] w-full" />
  const order = w.order
  const engineers = w.engineers.data ?? []
  const today = businessToday()
  const issued = challans.data?.length ?? 0
  const hasGoods = w.items.data.some(i => !i.isService)
  const challanSummary = challans.isError ? 'Did not load' : challans.isLoading ? '…' : issued > 0 ? `${issued} issued` : hasGoods ? 'None yet' : 'No goods'
  return (
    <div data-delivery-work>
      {w.legs.data.length > 0 ? (
        <LegsPanel order={order} legs={w.legs.data} items={w.items.data} pos={w.pos.data ?? []} money={job.money} isAdmin={job.role === 'admin'} canEdit={w.canEdit} part="delivery" />
      ) : null}
      <FoldRow
        state={order.needsCommissioning && order.doneOn ? { icon: CircleCheck, word: 'Done', className: 'text-tone-success-fg' } : { icon: CircleDashed, word: order.needsCommissioning ? 'Not done' : 'Not needed' }}
        title="Commissioning"
        summary={commissioningSummary(order, engineers, today)}
        open={commissioning}
        onToggle={() => setCommissioning(o => !o)}
        controlsId="delivery-commissioning-body"
        bodyLabel="Commissioning"
        dataStage="Commissioning"
      >
        <CommissioningPanel order={order} engineers={engineers} isEngineer={false} canEdit={w.canEdit} inFold />
      </FoldRow>
      <FoldRow
        state={{ icon: FileText, word: issued > 0 ? 'Issued' : 'None' }}
        // Not "Delivery challans": a step button is found by its name starting with "Delivery"; the body keeps the region name tests and readers know.
        title="Challans"
        summary={challanSummary}
        open={papers}
        onToggle={() => setPapers(o => !o)}
        controlsId="delivery-challans-body"
        bodyLabel="Delivery challans"
        dataStage="Challans"
      >
        <ChallansPanel order={order} items={w.items.data} inFold />
      </FoldRow>
    </div>
  )
}
