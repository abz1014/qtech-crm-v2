import { Suspense } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'
import { useContentDrawn } from '@/lib/useContentDrawn'
import { MoreTrigger } from '@/features/jobs/MoreTrigger'
import type { JobSlotProps } from '@/features/jobs/slots'

// The order's menu (its own small module, with its dialogs lazy) is downloaded once the first page has drawn; prefetch.ts starts it too.
const OrderMoreInner = lazyWithReload(() => import('@/features/orders/jobSlots/OrderMoreInner'))

/*
 * "More" beside the next-step button of the job page (P5-D2): the order's own menu: History, Cancel or Reopen order, and Delete
 * order (admin; it lists what blocks it first). A deleted order lands on the jobs list. Admin and sales only, as on the order
 * page: an engineer has no menu, and nothing at all for a job with no order yet. The button itself is drawn at once (disabled and
 * busy); on the first page its menu waits only for the page's content to be drawn (perf: the job page's LCP), never for idle time.
 */
export default function OrderMore({ job }: JobSlotProps) {
  const drawn = useContentDrawn()
  if (!job.job.orderId || !job.money) return null
  const trigger = <MoreTrigger />
  if (!drawn) return trigger
  return (
    <Suspense fallback={trigger}>
      <OrderMoreInner job={job} />
    </Suspense>
  )
}
