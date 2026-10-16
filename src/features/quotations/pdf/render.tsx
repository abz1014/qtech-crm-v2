import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { QuotationDocument } from '@/features/quotations/pdf/QuotationDocument'
import type { PdfData } from '@/features/quotations/api'
import type { CompanyProfile } from '@/features/settings/companyProfile'

export async function renderQuotationPdf(data: PdfData, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<QuotationDocument data={data} profile={profile} logoSrc={logoSrc} />).toBlob()
}
