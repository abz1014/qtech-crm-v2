import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { ExpenseReportDocument } from '@/features/money/expenseReport/pdf/ExpenseReportDocument'
import type { ExpenseReportView } from '@/features/money/expenseReport/model'

/** The lazy chunk's entry for the Expenses report PDF (the fonts and wordmark of the invoice and quotation). */
export async function renderExpenseReportPdf(v: ExpenseReportView, printedOn: string): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<ExpenseReportDocument v={v} logoSrc={logoSrc} printedOn={printedOn} />).toBlob()
}
