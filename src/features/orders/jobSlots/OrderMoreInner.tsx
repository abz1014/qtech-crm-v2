import type { JobSlotProps } from '@/features/jobs/slots'
import { OrderMoreMenu } from '@/features/orders/OrderHeaderBlock'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'

/** The order's More menu on the job page (see OrderMore, which decides when it is downloaded). */
export default function OrderMoreInner({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.order) return null
  const j = job.job
  return <OrderMoreMenu order={w.order} recordPayment={false} afterDelete="/jobs" deleteJob={{ key: j.key, rfqId: j.rfqId, orderId: j.orderId, companyId: j.companyId, companyName: j.companyName }} />
}
