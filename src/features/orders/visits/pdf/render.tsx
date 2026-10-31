import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { ServiceReportDocument } from '@/features/orders/visits/pdf/ServiceReportDocument'
import type { ServiceReportDoc } from '@/features/orders/visits/pdf/doc'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/** The lazy chunk's entry for the service report (the fonts and the wordmark are the quotation's and the invoice's). */
export async function renderServiceReportPdf(doc: ServiceReportDoc, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<ServiceReportDocument doc={doc} profile={profile} logoSrc={logoSrc} />).toBlob()
}
