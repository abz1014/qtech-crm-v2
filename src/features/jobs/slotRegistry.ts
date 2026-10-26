import type { ComponentType, LazyExoticComponent } from 'react'
import type { JobSlotProps } from '@/features/jobs/slots'
import type { StopName } from '@/features/jobs/lib/stages'

/* The slot table: see slots.tsx for how to plug in. One line per component. */
export type StageSlotName = 'stage:enquiry' | 'stage:quotation' | 'stage:order' | 'stage:supplier-order' | 'stage:delivery' | 'stage:invoice' | 'stage:payment'
export type JobSlotName = 'next-step' | 'side' | 'files' | StageSlotName

export type SlotComponent = LazyExoticComponent<ComponentType<JobSlotProps>>

/** One line per plugged-in component. Empty until a lane adds its own. */
export const JOB_SLOTS: Record<JobSlotName, readonly SlotComponent[]> = {
  'next-step': [],
  side: [],
  files: [],
  'stage:enquiry': [],
  'stage:quotation': [],
  'stage:order': [],
  'stage:supplier-order': [],
  'stage:delivery': [],
  'stage:invoice': [],
  'stage:payment': [],
}

/** The slot name of a stop ("Supplier order" -> 'stage:supplier-order'). */
export const stageSlot = (stop: StopName): StageSlotName => `stage:${stop.toLowerCase().replace(/ /g, '-')}` as StageSlotName

