import { importWithReload } from '@/lib/importWithReload'
import type { Statement } from '@/features/money/statement/model'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/* The only way the app makes a statement PDF; @react-pdf/renderer stays in its own chunk (shared with the invoice and quotation). */
export async function generateStatementPdf(statement: Statement, customerName: string, profile: CompanyProfile, printedOn: string): Promise<Blob> {
  const { renderStatementPdf } = await importWithReload(() => import('@/features/money/statement/render'))
  return renderStatementPdf(statement, customerName, profile, printedOn)
}
