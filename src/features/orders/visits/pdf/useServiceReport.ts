import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSeesPrices } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import type { OrderHeader } from '@/features/orders/api'
import { orderItemsQuery } from '@/features/orders/hooks'
import { saveBlob } from '@/features/orders/pdf/download'
import type { VisitRow } from '@/features/orders/visits/model'
import { buildServiceReportDoc, serviceReportFileName } from '@/features/orders/visits/pdf/doc'
import { generateServiceReportPdf } from '@/features/orders/visits/pdf/generate'
import { companyProfileQuery } from '@/features/settings/hooks'

/**
 * Download the service report of a visit. Nothing is read until the button is pressed: then the order's lines and the company profile
 * (both usually already on the page), the PDF is made in the browser and saved. The lines are read the way the page reads them for this
 * role (an engineer's carry no price), and only their description, quantity and unit are used.
 */
export function useServiceReport(order: OrderHeader, visit: VisitRow) {
  const client = useQueryClient()
  const money = useSeesPrices()
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const download = async () => {
    if (pending) return
    setPending(true)
    try {
      const [items, profile] = await Promise.all([
        client.fetchQuery({ ...orderItemsQuery(order.id, money), staleTime: 30_000 }),
        client.fetchQuery({ ...companyProfileQuery(money), staleTime: 30_000 }),
      ])
      const doc = buildServiceReportDoc(order, visit, items, businessToday())
      saveBlob(await generateServiceReportPdf(doc, profile), serviceReportFileName(doc))
    } catch (err) {
      toast({ title: 'Could not make the service report', body: mapPgError(err, { entity: 'service report' }).message, tone: 'danger' })
    } finally {
      setPending(false)
    }
  }
  return { pending, download }
}
