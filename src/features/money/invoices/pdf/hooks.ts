import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import { downloadBlob, sharePdf } from '@/features/quotations/lib/sharePdf'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import * as api from '@/features/money/invoices/pdf/api'
import type { InvoiceDoc } from '@/features/money/invoices/pdf/doc'
import { generateInvoicePdf } from '@/features/money/invoices/pdf/generate'
import { invoiceFileName } from '@/features/money/invoices/pdf/model'

/*
 * The invoice PDF's hooks (R01 pattern). The keys hang under existing ones, so the writes that already invalidate those reach
 * them: an invoice change (qk.money.invoices.detail) refreshes its PDF source, a company change (qk.companies.detail) its tax
 * details. Reads are fresh each time the dialog opens (staleTime 0): the PDF must print what the register holds now.
 */
export const pdfKeys = {
  source: (invoiceId: string) => [...qk.money.invoices.detail(invoiceId), 'pdf-source'] as const,
  orderInvoices: (orderId: string) => [...qk.money.invoices.all, 'pdf-order-invoices', orderId] as const,
  buyerTax: (companyId: string) => [...qk.companies.detail(companyId), 'buyer-tax'] as const,
}

export function useInvoicePdfSource(invoiceId: string | null | undefined) {
  return useQuery({
    queryKey: pdfKeys.source(invoiceId ?? ''),
    queryFn: () => api.loadInvoicePdfSource(invoiceId as string),
    enabled: Boolean(invoiceId),
    staleTime: 0,
  })
}

export function useOrderInvoices(orderId: string | null | undefined) {
  return useQuery({
    queryKey: pdfKeys.orderInvoices(orderId ?? ''),
    queryFn: () => api.listOrderInvoices(orderId as string),
    enabled: Boolean(orderId),
    staleTime: 0,
  })
}

export function useBuyerTax(companyId: string | null | undefined) {
  return useQuery({ queryKey: pdfKeys.buyerTax(companyId ?? ''), queryFn: () => api.getBuyerTax(companyId as string), enabled: Boolean(companyId) })
}

/** Saves the buyer's tax details on the company; the company screens and every open invoice PDF source read them again. */
export function useSaveBuyerTax(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: api.BuyerTaxPatch) => api.saveBuyerTax(companyId, patch),
    onSuccess: async () => {
      await Promise.all([invalidateAfter(client, 'company.update', { id: companyId }), client.invalidateQueries({ queryKey: qk.money.invoices.all })])
    },
  })
}

export type PdfAction = 'open' | 'share'

/**
 * Make the PDF and hand it over: "open" shows it in a new tab (opened inside the tap, so no pop-up blocker stops it), "share"
 * opens the phone's share sheet with the file, or downloads it where the browser cannot share files. Nothing is stored and
 * nothing is sent by the CRM.
 */
export function useInvoicePdfActions() {
  const { toast } = useToast()
  const [busy, setBusy] = useState<PdfAction | null>(null)
  const run = async (what: PdfAction, doc: InvoiceDoc, profile: CompanyProfile) => {
    if (busy) return
    setBusy(what)
    const tab = what === 'open' ? window.open('', '_blank') : null
    const name = invoiceFileName(doc.number, doc.copy)
    try {
      const blob = await generateInvoicePdf(doc, profile)
      if (what === 'open') {
        const url = URL.createObjectURL(blob)
        if (tab) tab.location.href = url
        else downloadBlob(blob, name)
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        const result = await sharePdf(blob, name, `Sales tax invoice ${doc.number} for ${doc.buyer.name}`)
        if (result === 'downloaded') toast({ title: 'PDF downloaded', body: name })
      }
    } catch (err) {
      tab?.close()
      toast({ title: 'Could not make the PDF', body: mapPgError(err, { entity: 'PDF' }).message, tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }
  return {
    busy,
    open: (doc: InvoiceDoc, profile: CompanyProfile) => run('open', doc, profile),
    share: (doc: InvoiceDoc, profile: CompanyProfile) => run('share', doc, profile),
  }
}

/** Whether this browser can hand a file to the share sheet (phones); elsewhere "share" is a download. */
export function canShareFiles(): boolean {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { canShare?: (d: ShareData) => boolean })
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [new File([new Blob()], 'x.pdf', { type: 'application/pdf' })] })
  } catch {
    return false
  }
}
