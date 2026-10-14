/** Human references: "RFQ-0177", "ORD-0038". The database holds the bare number; this is the one place that dresses it. */
const pad = (n: number) => String(n).padStart(4, '0')

export const rfqRef = (n: number): string => `RFQ-${pad(n)}`
export const orderRef = (n: number): string => `ORD-${pad(n)}`
