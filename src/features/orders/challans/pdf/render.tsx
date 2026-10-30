import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { ChallanDocument } from '@/features/orders/challans/pdf/ChallanDocument'
import type { ChallanDoc } from '@/features/orders/challans/pdf/doc'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/** The lazy chunk's entry for the delivery challan (the fonts and the wordmark are the quotation's and the invoice's). */
export async function renderChallanPdf(doc: ChallanDoc, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<ChallanDocument doc={doc} profile={profile} logoSrc={logoSrc} />).toBlob()
}
