import type { JobSlotProps } from '@/features/jobs/slots'
import { MoreTrigger } from '@/features/jobs/MoreTrigger'
import { useOrderHeader } from '@/features/orders/hooks'
import { OrderMoreMenu } from '@/features/orders/OrderMoreMenu'

/** The order's More menu on the job page (see OrderMore, which draws the button first). It needs the order's header only. */
export default function OrderMoreInner({ job }: JobSlotProps) {
  const j = job.job
  const header = useOrderHeader(j.orderId ?? undefined, job.money)
  if (header.isPending) return <MoreTrigger />
  if (!header.data) return null
  return <OrderMoreMenu order={header.data} recordPayment={false} afterDelete="/jobs" deleteJob={{ key: j.key, rfqId: j.rfqId, orderId: j.orderId, companyId: j.companyId, companyName: j.companyName }} />
}
