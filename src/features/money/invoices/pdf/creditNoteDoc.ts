import { toPaisa } from '@/lib/money'
import { orderRef } from '@/lib/refs'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { amountInWords } from '@/features/quotations/lib/totals'
import { buyerAddress, buyerRegistered, type BuyerTax } from '@/features/money/invoices/pdf/model'

/*
 * What the credit note PDF prints (0112). Same family as the sales-tax invoice: the quotation's letterhead, the buyer box, the order
 * references, and the stored figures (never recomputed). A credit note has no lines of its own: one row names the invoice it credits and
 * why, with the value excluding tax, the sales tax and the value including tax that are credited. Pure: the button builds it and the
 * Document only draws it.
 */
export interface CreditNotePdfSource {
  creditNote: { id: string; number: string; issuedOn: string; net: number | string; gst: number | string; reason: string }
  invoice: { number: string | null; invoiceDate: string | null }
  order: { number: number; customerPo: string | null } | null
  buyer: (BuyerTax & { id: string }) | null
  siteAddress: string | null
}

export interface CreditNoteDoc {
  number: string
  issuedOn: string
  invoiceNumber: string
  invoiceDate: string | null
  reason: string
  orderRef: string | null
  customerPo: string | null
  buyer: { name: string; address: string; ntn: string | null; strn: string | null; registered: boolean }
  net: bigint
  gst: bigint
  gross: bigint
  /** The credited value including tax, in words. */
  words: string
}

export type CreditNoteBuild = { ok: true; doc: CreditNoteDoc } | { ok: false; gaps: string[] }

export function buildCreditNoteDoc(src: CreditNotePdfSource, profile: CompanyProfile | null | undefined): CreditNoteBuild {
  const gaps: string[] = []
  if (!profile?.legal_name?.trim()) gaps.push('Add the company name in Settings, Company.')
  if (!src.buyer) gaps.push('The customer could not be read.')
  else if (!buyerAddress(src.buyer, src.siteAddress)) gaps.push(`Add ${src.buyer.name}'s invoice address on the company page.`)
  if (!src.invoice.number) gaps.push('The invoice has no number.')
  if (gaps.length > 0 || !src.buyer) return { ok: false, gaps }
  const net = toPaisa(src.creditNote.net)
  const gst = toPaisa(src.creditNote.gst)
  return {
    ok: true,
    doc: {
      number: src.creditNote.number.trim(),
      issuedOn: src.creditNote.issuedOn,
      invoiceNumber: (src.invoice.number ?? '').trim(),
      invoiceDate: src.invoice.invoiceDate,
      reason: src.creditNote.reason,
      orderRef: src.order ? orderRef(src.order.number) : null,
      customerPo: src.order?.customerPo?.trim() || null,
      buyer: {
        name: src.buyer.name,
        address: buyerAddress(src.buyer, src.siteAddress) ?? '',
        ntn: src.buyer.ntn?.trim() || null,
        strn: src.buyer.strn?.trim() || null,
        registered: buyerRegistered(src.buyer) === true,
      },
      net,
      gst,
      gross: net + gst,
      words: amountInWords(net + gst),
    },
  }
}

export const creditNoteFileName = (number: string): string => `${number.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'credit-note'}.pdf`
