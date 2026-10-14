/*
 * Amount text helpers for NumberInput (U07). PKR amounts are grouped in thousands
 * with commas (1,600,764) exactly as in the mockups, never lakh grouping.
 */
const groupFmt = (fraction: { min: number; max: number }) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: fraction.min, maximumFractionDigits: fraction.max, useGrouping: true })

/** "1,600,764", " 1 600 764", "1600764.50" -> number. Empty or unparseable -> null. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '')
  if (cleaned === '' || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Display text for a value. `decimals` fixes the places (278.40); without it up
 * to two places show only when there are any (1,600,764 and 12.5).
 */
export function formatAmount(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return decimals === undefined
    ? groupFmt({ min: 0, max: 2 }).format(value)
    : groupFmt({ min: decimals, max: decimals }).format(value)
}
