import type { ExpenseReportView } from '@/features/money/expenseReport/model'

/*
 * The Expenses report PDF. @react-pdf/renderer is large, so it sits behind a dynamic import (the chunk the invoice, quotation and
 * supplier PO already share): the first load does not grow, and the chunk is fetched the first time a PDF is made.
 */
export async function generateExpenseReportPdf(v: ExpenseReportView, printedOn: string): Promise<Blob> {
  const { renderExpenseReportPdf } = await import('@/features/money/expenseReport/pdf/render')
  return renderExpenseReportPdf(v, printedOn)
}

/** Saves a blob under a file name (an <a download> click; nothing leaves the device). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
