import { useState } from 'react'
import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import { useCompanyProfile } from '@/features/settings/hooks'
import { profileGaps } from '@/features/quotations/lib/profileGaps'
import { downloadStoredPoPdf, getLegPo, loadPoPdfData } from '@/features/purchaseOrders/api'
import { useStorePoPdf } from '@/features/purchaseOrders/hooks'
import { generatePurchaseOrderPdf } from '@/features/purchaseOrders/pdf/generate'

/**
 * "View PO": opens the leg's latest PO as a PDF in a new tab. The stored PDF when there is one; otherwise it is made now (and stored for
 * next time) if the company profile allows it. The tab is opened inside the tap so a pop-up blocker lets it through.
 */
export function useOpenPoPdf(orderId: string) {
  const { toast } = useToast()
  const profileQ = useCompanyProfile()
  const store = useStorePoPdf(orderId)
  const [busyLeg, setBusyLeg] = useState<string | null>(null)

  const open = async (legId: string) => {
    setBusyLeg(legId)
    const tab = window.open('', '_blank')
    try {
      const po = await getLegPo(legId)
      if (!po) throw new Error('This supplier order has no PO yet.')
      let blob: Blob
      if (po.pdfPath) {
        blob = await downloadStoredPoPdf(po.pdfPath)
      } else {
        const profile = profileQ.data
        const gaps = profileGaps(profile)
        if (!profile || gaps.length > 0) {
          tab?.close()
          toast({ title: 'The PDF needs the company profile', body: `Add the ${gaps.join(' and ')} in Settings, Company.`, tone: 'danger' })
          return
        }
        blob = await generatePurchaseOrderPdf(await loadPoPdfData(po.id), profile)
        await store.mutateAsync({ po, pdf: blob })
      }
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      tab?.close()
      toast({ title: 'Could not get the PDF', body: mapPgError(err, { entity: 'PDF' }).message, tone: 'danger' })
    } finally {
      setBusyLeg(null)
    }
  }
  return { open, busyLeg }
}
