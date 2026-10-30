import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { StatementDocument, type StatementPdfData } from '@/features/statement/pdf/StatementDocument'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/** The lazy chunk's entry for the comparative statement PDF; the fonts and the wordmark are the quotation's. */
export async function renderStatementPdf(data: StatementPdfData, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<StatementDocument data={data} profile={profile} logoSrc={logoSrc} />).toBlob()
}
