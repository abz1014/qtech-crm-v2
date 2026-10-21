import { downloadCSV, generateCSV } from '@/lib/csvExport'
import { monthName, type PayableRow } from '@/features/money/monthEnd/model'

export const csvFile = (name: string, month: string): string => `${name}-${month}.csv`

/** One tap: builds the file from the same figures the page shows and downloads it (src/lib/csvExport, formula-safe). */
export function downloadReport(table: { headers: string[]; rows: unknown[][] }, filename: string): void {
  downloadCSV(generateCSV(table.headers, table.rows), filename)
}

/**
 * "Pay" on a We owe suppliers row: the Add expense dialog on Expenses, filled in like the order's Pay {supplier} (the same dialog:
 * the order, the supplier order and so the supplier, and the amount still owed). Only a row still owing that knows its order.
 *   /money/expenses?add=1&order=<id>&leg=<id>&amount=384497&note=Owed (about) on 30 Nov, from We owe suppliers
 */
export function payHref(r: Pick<PayableRow, 'state' | 'orderId' | 'legId' | 'owedPkr'>, asOf: string): string | null {
  if (r.state !== 'owing' || !r.orderId) return null
  const p = new URLSearchParams({ add: '1', order: r.orderId, leg: r.legId })
  const owed = r.owedPkr === null ? 0 : Math.round(Number(r.owedPkr))
  if (owed > 0) {
    p.set('amount', String(owed))
    p.set('note', `Owed (about) on ${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7)).slice(0, 3)}, from We owe suppliers`)
  }
  return `/money/expenses?${p.toString()}`
}
