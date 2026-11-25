/**
 * The quotation number as printed. A quotation with a customer code (0147) is "QTS-IFL-4810": the code and the running number. An
 * older one has no code and keeps "QT-26-0042" (the number and the year it was first issued). With a revision, " R2" is added.
 */
export function quotationRef(number: number, issuedOn: string, revision?: number, code?: string | null): string {
  const base = code ? `QTS-${code}-${number}` : `QT-${issuedOn.slice(2, 4)}-${String(number).padStart(4, '0')}`
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
