import type { Amount } from '@/lib/money'
import { orderRef } from '@/lib/refs'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { amountInWords } from '@/features/quotations/lib/totals'
import { dueOn } from '@/features/money/invoices/model'
import {
  buyerAddress,
  buyerRegistered,
  invoiceFigures,
  invoiceReadiness,
  type BuyerTax,
  type FiguresProblem,
  type InvoiceCopy,
  type InvoiceFigures,
  type LinePick,
  type PdfOrderLine,
  type Readiness,
} from '@/features/money/invoices/pdf/model'

/*
 * Everything the sales-tax invoice PDF prints, put together from what was read (api.ts) and what the person chose (the lines,
 * the copy). Pure: the dialog builds it on every change and the Document only draws it.
 */

/** What api.ts reads for one invoice. */
export interface InvoicePdfSource {
  invoice: { id: string; number: string | null; invoiceDate: string | null; net: Amount; gst: Amount; orderId: string | null }
  order: {
    id: string
    number: number
    customerPo: string | null
    /** The PO date (or the date confirmed on WhatsApp). */
    orderedOn: string | null
    paymentTermsDays: number | null
    legacyFlags: string[]
  } | null
  buyer: (BuyerTax & { id: string }) | null
  site: { name: string; address: string | null } | null
  lines: PdfOrderLine[]
  /** The order's other invoices, so the dialog can say this one is a part. */
  otherInvoices: Array<{ id: string; number: string | null; net: Amount }>
}

export interface InvoiceDoc {
  number: string
  invoiceDate: string
  copy: InvoiceCopy
  /** Invoice date plus the order's payment terms (else the company default); null with neither. */
  dueOn: string | null
  orderRef: string | null
  customerPo: string | null
  poDate: string | null
  siteName: string | null
  buyer: { name: string; address: string; ntn: string | null; strn: string | null; registered: boolean }
  figures: InvoiceFigures
  /** The value including tax in words ("... rupees only."). */
  words: string
}

export type BuildResult =
  | { ok: true; doc: InvoiceDoc; readiness: Readiness }
  | { ok: false; readiness: Readiness; problem: FiguresProblem | null }

export function readinessOf(src: InvoicePdfSource, profile: CompanyProfile | null | undefined): Readiness {
  return invoiceReadiness({
    seller: profile ?? null,
    buyer: src.buyer,
    siteAddress: src.site?.address ?? null,
    invoice: { number: src.invoice.number, invoiceDate: src.invoice.invoiceDate, orderId: src.invoice.orderId },
    orderFlags: src.order?.legacyFlags ?? [],
  })
}

/** The document, or why it cannot be made yet: what to fill in (readiness gaps) and whether the lines add up (problem). */
export function buildInvoiceDoc(
  src: InvoicePdfSource,
  profile: CompanyProfile | null | undefined,
  picks: readonly LinePick[],
  copy: InvoiceCopy,
): BuildResult {
  const readiness = readinessOf(src, profile)
  const fig = invoiceFigures(src.lines, picks, { net: src.invoice.net, gst: src.invoice.gst })
  const problem = fig.ok ? null : fig.problem
  if (readiness.gaps.length > 0 || !fig.ok || !src.buyer || !src.invoice.number || !src.invoice.invoiceDate) {
    return { ok: false, readiness, problem }
  }
  const buyer = src.buyer
  const terms = src.order?.paymentTermsDays ?? profile?.default_payment_terms_days ?? null
  return {
    ok: true,
    readiness,
    doc: {
      number: src.invoice.number.trim(),
      invoiceDate: src.invoice.invoiceDate,
      copy,
      dueOn: dueOn(src.invoice.invoiceDate, terms),
      orderRef: src.order ? orderRef(src.order.number) : null,
      customerPo: src.order?.customerPo?.trim() || null,
      poDate: src.order?.customerPo?.trim() ? src.order.orderedOn : null,
      siteName: src.site?.name ?? null,
      buyer: {
        name: buyer.name,
        address: buyerAddress(buyer, src.site?.address ?? null) ?? '',
        ntn: buyer.ntn?.trim() || null,
        strn: buyer.strn?.trim() || null,
        registered: buyerRegistered(buyer) === true,
      },
      figures: fig.figures,
      words: amountInWords(fig.figures.gross),
    },
  }
}
