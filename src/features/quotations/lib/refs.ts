/** "QT-26-0042" from the number and the year it was first issued; with a revision, "QT-26-0042 R2". */
export function quotationRef(number: number, issuedOn: string, revision?: number): string {
  const yy = issuedOn.slice(2, 4)
  const base = `QT-${yy}-${String(number).padStart(4, '0')}`
  return revision === undefined ? base : `${base} R${revision}`
}

/** Calendar addition on the date parts, so no timezone can move the day. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** A quotation has expired when its valid-until date is before today (the day itself is still valid). */
export function isExpired(validUntil: string, today: string): boolean {
  return validUntil < today
}
