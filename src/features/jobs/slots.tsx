import { Suspense } from 'react'
import type { JobRow } from '@/features/jobs/api'
import { JOB_SLOTS, type JobSlotName, type SlotComponent } from '@/features/jobs/slotRegistry'

/*
 * The job page's slots: the places other lanes plug their components into WITHOUT editing the job page (lane L3: the order actions
 * of P5-D2; lane L6: "Add to this job"; later: the engineer's one-tap buttons).
 *
 * HOW TO PLUG IN
 *   1. Write a component that takes `{ job: JobContext }` and is the default export of its own module (it is loaded lazily, so a
 *      slot costs the job page nothing until it is drawn).
 *   2. Add ONE line to JOB_SLOTS in slotRegistry.ts, under the slot's name:
 *        'stage:supplier-order': [lazy(() => import('@/features/orders/jobSlots/PlaceSupplierOrder'))],
 *      (use `lazyWithReload as lazy` from '@/lib/importWithReload', like every other lazy page).
 *   3. Do the write through the existing hooks (they refresh the job: every write goes through invalidateAfter, which marks
 *      `qk.jobs` stale). A slot never reads or draws a price unless `job.money` is true; an engineer's `job.money` is false and
 *      the slot is drawn for them too, so check it.
 *
 * THE SLOTS
 *   'next-step'              beside the one green button of the next-step band (secondary buttons only: the page has ONE green
 *                            button; its label and target come from lib/nextStep.ts, which L3 extends for the order steps)
 *   'stage:enquiry' ... 'stage:payment'
 *                            inside that stage's section of the accordion, below its read-only summary. Rendered only while
 *                            the section is open. The stage names are the seven stops (see StopName).
 *   'side'                   a panel in the right column, above Notes and files ("Add to this job" is plugged in here)
 *   'files'                  in the Notes and files panel, beside its "Add" button (a file or photo upload; has_prices is set by
 *                            the upload, P5-E-UI)
 *
 * WHAT A SLOT GETS (JobContext): the job (key, kind, ids, customer, stage, stage_detail), the person's role, and the money switch.
 * `rfqId` is null for a direct order (Job O-45), `orderId` is null until the enquiry is won.
 */
export interface JobContext {
  job: JobRow
  role: 'admin' | 'sales' | 'engineer'
  /** The person may see prices: admin and sales. An engineer's slot must draw and fetch no amount. */
  money: boolean
}

export interface JobSlotProps {
  job: JobContext
}

/** Draws every component plugged into `name`, or nothing. */
export function JobSlot({ name, context, slots = JOB_SLOTS }: { name: JobSlotName; context: JobContext; slots?: Record<JobSlotName, readonly SlotComponent[]> }) {
  const parts = slots[name]
  if (parts.length === 0) return null
  return (
    <>
      {parts.map((Part, i) => (
        <Suspense key={i} fallback={null}>
          <Part job={context} />
        </Suspense>
      ))}
    </>
  )
}
