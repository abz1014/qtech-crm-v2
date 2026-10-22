import { importWithReload } from '@/lib/importWithReload'
import type { InvoiceDoc } from '@/features/money/invoices/pdf/doc'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/*
 * The only way the app makes a sales-tax invoice PDF. @react-pdf/renderer is large, so it is behind a dynamic import: the main
 * bundle does not contain it, and the chunk (shared with the quotation and the supplier PO) is fetched the first time a PDF is made.
 */
export async function generateInvoicePdf(doc: InvoiceDoc, profile: CompanyProfile): Promise<Blob> {
  const { renderInvoicePdf } = await importWithReload(() => import('@/features/money/invoices/pdf/render'))
  return renderInvoicePdf(doc, profile)
}
