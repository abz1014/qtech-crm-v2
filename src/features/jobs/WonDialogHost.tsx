import { Suspense, useMemo } from 'react'
import { useSeesPrices } from '@/app/session'
import { lazyWithReload } from '@/lib/importWithReload'
import { useFxLatest, useRfqHeader, useRfqInquiries } from '@/features/rfqs/hooks'
import { toRateTable } from '@/features/rfqs/lib/comparePrices'
import { useWonDialog } from '@/features/orders/useWonDialog'

const ConvertDialog = lazyWithReload(() => import('@/features/orders/ConvertDialog').then(m => ({ default: m.ConvertDialog })))

/* Kept apart from EnquiryWork so the job page does not carry the whole enquiry side (items, prices, replies) before it is opened. */
/** Mark won's Create order dialog, open while the address carries ?won=1 (admin and sales; the dialog refuses an engineer). */
export function WonDialogHost({ rfqId }: { rfqId: string }) {
  const [wonOpen, setWonOpen] = useWonDialog()
  const prices = useSeesPrices()
  const header = useRfqHeader(wonOpen ? rfqId : undefined)
  const inquiries = useRfqInquiries(wonOpen ? rfqId : undefined)
  const fx = useFxLatest()
  const rates = useMemo(() => toRateTable(fx.data ?? []), [fx.data])
  if (!wonOpen || !prices || !header.data || !inquiries.data) return null
  return (
    <Suspense fallback={null}>
      <ConvertDialog rfq={header.data} inquiries={inquiries.data} rates={rates} onClose={() => setWonOpen(false)} />
    </Suspense>
  )
}
