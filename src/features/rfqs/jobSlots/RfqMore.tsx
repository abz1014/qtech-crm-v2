import { Suspense, useEffect, useState } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'
import type { JobSlotProps } from '@/features/jobs/slots'

// The RFQ menu and its dialogs are downloaded once the page has drawn, never with the page's first paint.
const RfqMoreInner = lazyWithReload(() => import('@/features/rfqs/jobSlots/RfqMoreInner'))

/*
 * "More" beside the next-step button of the job page, on a job that has an enquiry (the old RFQ page menu, removed 2026-10-30):
 * Edit RFQ details (everyone), and for admin and sales Mark quotation sent, Close because, Reopen, Mark won (a lost RFQ can still
 * be won) and, admin only, Delete RFQ. Nothing is downloaded or drawn until the browser is idle (perf: the job page LCP).
 */
export default function RfqMore({ job }: JobSlotProps) {
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
  if (!idle || !job.job.rfqId || job.job.orderId) return null
  return (
    <Suspense fallback={null}>
      <RfqMoreInner job={job} />
    </Suspense>
  )
}
