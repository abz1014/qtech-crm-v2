import type { JobSlotProps } from '@/features/jobs/slots'
import { MoreTrigger } from '@/features/jobs/MoreTrigger'
import { useOrderHeader } from '@/features/orders/hooks'
import { OrderMoreMenu } from '@/features/orders/OrderMoreMenu'
import { jobLabel } from '@/features/jobs/lib/listModel'

/** The order's More menu on the job page (see OrderMore, which draws the button first). It needs the order's header only. */
export default function OrderMoreInner({ job }: JobSlotProps) {
  const j = job.job
  const header = useOrderHeader(j.orderId ?? undefined, job.money)
  if (header.isPending) return <MoreTrigger />
  if (!header.data) return null
  // a job with an enquiry reassigns the enquiry and its orders together; a direct order reassigns itself
  const scope = j.rfqId ? { rfqId: j.rfqId, label: `${jobLabel(j.key)} · ${j.companyName}`, ownerId: j.ownerId, ownerName: j.ownerName } : undefined
  return <OrderMoreMenu order={header.data} scope={scope} recordPayment={false} afterDelete="/jobs" deleteJob={{ key: j.key, rfqId: j.rfqId, orderId: j.orderId, companyId: j.companyId, companyName: j.companyName }} />
}
