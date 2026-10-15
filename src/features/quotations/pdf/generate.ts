import type { PdfData } from '@/features/quotations/api'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/*
 * The only way the app makes a quotation PDF. @react-pdf/renderer is large, so it is behind a dynamic import: the main
 * bundle does not contain it and the chunk is fetched the first time someone issues or opens a PDF.
 */
export async function generateQuotationPdf(data: PdfData, profile: CompanyProfile): Promise<Blob> {
  const { renderQuotationPdf } = await import('@/features/quotations/pdf/render')
  return renderQuotationPdf(data, profile)
}
