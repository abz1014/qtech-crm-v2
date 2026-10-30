import { importWithReload } from '@/lib/importWithReload'
import type { StatementPdfData } from '@/features/statement/pdf/StatementDocument'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/*
 * The only way the app makes a comparative statement PDF. @react-pdf/renderer is large, so it is behind a dynamic import: the main
 * bundle does not contain it, and the chunk (shared with the quotation, the PO and the invoice) is fetched the first time a PDF is made.
 */
export async function generateStatementPdf(data: StatementPdfData, profile: CompanyProfile): Promise<Blob> {
  const { renderStatementPdf } = await importWithReload(() => import('@/features/statement/pdf/render'))
  return renderStatementPdf(data, profile)
}
