/** Human references: "RFQ-0177", "ORD-0038". The database holds the bare number; this is the one place that dresses it. */
const pad = (n: number) => String(n).padStart(4, '0')

export const rfqRef = (n: number): string => `RFQ-${pad(n)}`
export const orderRef = (n: number): string => `ORD-${pad(n)}`

/** "PO-26-0017": the number and the year the PO was first issued (a revision keeps its number). */
export const poRef = (n: number, issuedOn: string): string => `PO-${issuedOn.slice(2, 4)}-${pad(n)}`
