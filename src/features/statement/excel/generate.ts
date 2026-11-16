import { importWithReload } from '@/lib/importWithReload'
import type { StatementPdfData } from '@/features/statement/pdf/StatementDocument'
import type { CompanyProfile } from '@/features/settings/companyProfile'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/*
 * The only way the app makes a comparative statement Excel file. SheetJS is large, so it is behind a dynamic import: the main bundle
 * does not contain it, and its chunk is fetched the first time a person downloads the Excel file.
 */
export async function generateStatementXlsx(data: StatementPdfData, profile: CompanyProfile): Promise<Blob> {
  const { buildStatementWorkbook } = await importWithReload(() => import('@/features/statement/excel/workbook'))
  const bytes = buildStatementWorkbook(data, profile)
  return new Blob([bytes as BlobPart], { type: XLSX_TYPE })
}
