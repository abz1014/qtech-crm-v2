import { Suspense } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'
import { useContentDrawn } from '@/lib/useContentDrawn'
import { MoreTrigger } from '@/features/jobs/MoreTrigger'
import type { JobSlotProps } from '@/features/jobs/slots'

// The RFQ menu and its dialogs are downloaded once the first page has drawn; prefetch.ts starts it too.
const RfqMoreInner = lazyWithReload(() => import('@/features/rfqs/jobSlots/RfqMoreInner'))

/*
 * "More" beside the next-step button of the job page, on a job that has an enquiry (the old RFQ page menu, removed 2026-10-30):
 * Edit RFQ details (everyone), and for admin and sales Mark quotation sent, Close because, Reopen, Mark won (a lost RFQ can still
 * be won) and, admin only, Delete RFQ. The button is drawn at once (disabled and busy); on the first page its menu waits only for the
 * page's content to be drawn (perf: the job page LCP), never for idle time.
 */
export default function RfqMore({ job }: JobSlotProps) {
  const drawn = useContentDrawn()
  if (!job.job.rfqId || job.job.orderId) return null
  const trigger = <MoreTrigger />
  if (!drawn) return trigger
  return (
    <Suspense fallback={trigger}>
      <RfqMoreInner job={job} />
    </Suspense>
  )
}
