import type { ComponentType, LazyExoticComponent } from 'react'
import { lazyWithReload as lazy } from '@/lib/importWithReload'
import type { JobSlotProps } from '@/features/jobs/slots'
import type { StopName } from '@/features/jobs/lib/stages'

/* The slot table: see slots.tsx for how to plug in. One line per component. */
export type StageSlotName = 'stage:enquiry' | 'stage:quotation' | 'stage:order' | 'stage:supplier-order' | 'stage:delivery' | 'stage:invoice' | 'stage:payment'
export type JobSlotName = 'next-step' | 'side' | 'files' | StageSlotName

export type SlotComponent = LazyExoticComponent<ComponentType<JobSlotProps>>

/** One line per plugged-in component. Empty until a lane adds its own. */
export const JOB_SLOTS: Record<JobSlotName, readonly SlotComponent[]> = {
  'next-step': [lazy(() => import('@/features/orders/jobSlots/OrderMore')), lazy(() => import('@/features/rfqs/jobSlots/RfqMore'))],
  // P4-B: Add to this job (paste, photo or file; a guess of what it is, one tap to confirm).
  side: [lazy(() => import('@/features/jobs/AddToJob'))],
  files: [],
  'stage:enquiry': [],
  'stage:quotation': [],
  'stage:order': [lazy(() => import('@/features/orders/jobSlots/OrderWork'))],
  'stage:supplier-order': [lazy(() => import('@/features/orders/jobSlots/SupplierOrderWork'))],
  'stage:delivery': [lazy(() => import('@/features/orders/jobSlots/DeliveryWork'))],
  'stage:invoice': [lazy(() => import('@/features/orders/jobSlots/InvoiceWork'))],
  'stage:payment': [lazy(() => import('@/features/orders/jobSlots/PaymentWork'))],
}

/** The slot name of a stop ("Supplier order" -> 'stage:supplier-order'). */
export const stageSlot = (stop: StopName): StageSlotName => `stage:${stop.toLowerCase().replace(/ /g, '-')}` as StageSlotName

