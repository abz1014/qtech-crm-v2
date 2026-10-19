import { downloadCSV, generateCSV } from '@/lib/csvExport'

export const csvFile = (name: string, month: string): string => `${name}-${month}.csv`

/** One tap: builds the file from the same figures the page shows and downloads it (src/lib/csvExport, formula-safe). */
export function downloadReport(table: { headers: string[]; rows: unknown[][] }, filename: string): void {
  downloadCSV(generateCSV(table.headers, table.rows), filename)
}
