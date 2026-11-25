/** Human references: "RFQ-0177", "ORD-0038". The database holds the bare number; this is the one place that dresses it. */
const pad = (n: number) => String(n).padStart(4, '0')

export const rfqRef = (n: number): string => `RFQ-${pad(n)}`
export const orderRef = (n: number): string => `ORD-${pad(n)}`

/**
 * A job's number on screen, as its documents print it: "RFQ-0139" for a job that began as an RFQ (job key "139") and "ORD-0045" for
 * an order with no RFQ (job key "O-45"). The key stays the address (/jobs/O-45), and search still reads "Job 139" and "O-45".
 */
export function jobRef(key: string): string {
  const order = /^O-(\d+)$/.exec(key)
  if (order) return orderRef(Number(order[1]))
  return /^\d+$/.test(key) ? rfqRef(Number(key)) : key
}

/** "PO-26-0017": the number and the year the PO was first issued (a revision keeps its number). */
export const poRef = (n: number, issuedOn: string): string => `PO-${issuedOn.slice(2, 4)}-${pad(n)}`

/** "PO-26-0017" for the first issue and "PO-26-0017 Rev 2" for a later revision, as quotations read: "R0" is jargon (24 Nov 2026). */
export const poRevRef = (n: number, issuedOn: string, revision?: number | null): string =>
  revision ? `${poRef(n, issuedOn)} Rev ${revision}` : poRef(n, issuedOn)
