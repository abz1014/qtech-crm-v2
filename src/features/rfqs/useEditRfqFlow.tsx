import { Suspense, useState, type ReactNode } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'
import type { RfqHeader } from '@/features/rfqs/api'

// The dialog (and the company picker it uses) is downloaded when it is opened, not with the RFQ page (perf).
const EditRfqDialog = lazyWithReload(() => import('@/features/rfqs/EditRfqDialog').then(m => ({ default: m.EditRfqDialog })))

/** "Edit RFQ details" in the More menu: `ask` opens the dialog, `node` is drawn once beside the menu. */
export function useEditRfqFlow(rfq: RfqHeader): { ask: () => void; node: ReactNode } {
  const [open, setOpen] = useState(false)
  return {
    ask: () => setOpen(true),
    node: open ? (
      <Suspense fallback={null}>
        <EditRfqDialog rfq={rfq} onClose={() => setOpen(false)} />
      </Suspense>
    ) : null,
  }
}
