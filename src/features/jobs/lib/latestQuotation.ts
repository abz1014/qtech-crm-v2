/** The newest quotation sent on the enquiry (latest issue date, then the highest revision), or null when none was sent. */
export function latestQuotation<T extends { issuedOn: string; revision: number; netTotal: number; gstTotal: number }>(rows: readonly T[] | undefined): T | null {
  if (!rows || rows.length === 0) return null
  return [...rows].sort((x, y) => x.issuedOn.localeCompare(y.issuedOn) || x.revision - y.revision)[rows.length - 1]
}
