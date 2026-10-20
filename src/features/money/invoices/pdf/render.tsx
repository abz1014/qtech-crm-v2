import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { InvoiceDocument } from '@/features/money/invoices/pdf/InvoiceDocument'
import type { InvoiceDoc } from '@/features/money/invoices/pdf/doc'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/** The lazy chunk's entry for the sales-tax invoice PDF; the fonts and the wordmark are the quotation's (R19 infrastructure). */
export async function renderInvoicePdf(doc: InvoiceDoc, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<InvoiceDocument doc={doc} profile={profile} logoSrc={logoSrc} />).toBlob()
}
