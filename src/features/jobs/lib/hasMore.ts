import type { JobContext } from '@/features/jobs/slots'

/**
 * Whether this person's job page has a More menu with any item in it: the order's menu (History, Cancel or Reopen, Delete) for admin
 * and sales on a job with an order, the enquiry's menu (Edit RFQ details, ...) on a job with an enquiry and no order yet. An engineer
 * has the enquiry's menu only. The phone's action bar shows when this is true, even with no next-step button (a paid or cancelled job).
 */
export function jobHasMore(ctx: JobContext): boolean {
  const { job, money } = ctx
  if (job.orderId) return money
  return Boolean(job.rfqId)
}
