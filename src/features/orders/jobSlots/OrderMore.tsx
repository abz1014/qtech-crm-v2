import type { JobSlotProps } from '@/features/jobs/slots'
import { OrderMoreMenu } from '@/features/orders/OrderHeaderBlock'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'

/*
 * "More" beside the next-step button of the job page (P5-D2): the order's own menu: History, Cancel or Reopen order, and Delete
 * order (admin; it lists what blocks it first). A deleted order lands on the jobs list. Admin and sales only, as on the order
 * page: an engineer has no menu.
 */
export default function OrderMore({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.orderId || !job.money || !w.order) return null
  return <OrderMoreMenu order={w.order} recordPayment={false} afterDelete="/jobs" />
}
