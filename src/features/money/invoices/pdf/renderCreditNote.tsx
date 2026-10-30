import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { CreditNoteDocument } from '@/features/money/invoices/pdf/CreditNoteDocument'
import type { CreditNoteDoc } from '@/features/money/invoices/pdf/creditNoteDoc'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/** The lazy chunk's entry for the credit note PDF; fonts and wordmark are the invoice's (render.tsx). */
export async function renderCreditNotePdf(doc: CreditNoteDoc, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<CreditNoteDocument doc={doc} profile={profile} logoSrc={logoSrc} />).toBlob()
}
