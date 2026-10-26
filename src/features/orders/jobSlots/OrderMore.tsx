import { Suspense, useEffect, useState } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'
import type { JobSlotProps } from '@/features/jobs/slots'

// The order's menu (OrderHeaderBlock and its dialogs) is downloaded once the page has drawn, never with the page's first paint.
const OrderMoreInner = lazyWithReload(() => import('@/features/orders/jobSlots/OrderMoreInner'))

/*
 * "More" beside the next-step button of the job page (P5-D2): the order's own menu: History, Cancel or Reopen order, and Delete
 * order (admin; it lists what blocks it first). A deleted order lands on the jobs list. Admin and sales only, as on the order
 * page: an engineer has no menu. Nothing is downloaded or drawn until the browser is idle (perf: the job page's LCP), and nothing
 * at all for a job with no order yet.
 */
export default function OrderMore({ job }: JobSlotProps) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => setIdle(true), { timeout: 2000 })
      return () => w.cancelIdleCallback?.(h)
    }
    const t = window.setTimeout(() => setIdle(true), 500)
    return () => window.clearTimeout(t)
  }, [])
  if (!idle || !job.job.orderId || !job.money) return null
  return (
    <Suspense fallback={null}>
      <OrderMoreInner job={job} />
    </Suspense>
  )
}
