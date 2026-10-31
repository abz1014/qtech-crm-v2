import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { StatementDocument } from '@/features/money/statement/StatementDocument'
import type { Statement } from '@/features/money/statement/model'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/** The lazy chunk's entry for the statement PDF; fonts and wordmark are the invoice's. */
export async function renderStatementPdf(statement: Statement, customerName: string, profile: CompanyProfile, printedOn: string): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<StatementDocument statement={statement} customerName={customerName} profile={profile} logoSrc={logoSrc} printedOn={printedOn} />).toBlob()
}
