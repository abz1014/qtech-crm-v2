export type Row = Record<string, unknown>

/** Trimmed string, or null for null, undefined and ''. */
export function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** The key used to match names: case, accents-as-composed, runs of spaces and edge spaces are ignored. */
export function normName(v: unknown): string {
  const s = clean(v)
  if (s === null) return ''
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** Money to two decimals, without float noise. */
export function money(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export function digits(v: unknown): string {
  return (clean(v) ?? '').replace(/\D/g, '')
}

export function str(row: Row, col: string): string | null {
  return clean(row[col])
}

export function numOf(row: Row, col: string): number | null {
  return num(row[col])
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

/** Stable order for the input rows, so that reruns give the same output whatever order the dump listed them in. */
export function stableOrder(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const ca = String(a['created_at'] ?? '')
    const cb = String(b['created_at'] ?? '')
    if (ca !== cb) return ca < cb ? -1 : 1
    const ia = pkOf(a)
    const ib = pkOf(b)
    return ia < ib ? -1 : ia > ib ? 1 : 0
  })
}

/** The old tables name their key id, invoice_id, expense_id, payment_id or payable_id. */
export function pkOf(row: Row): string {
  return String(row['id'] ?? row['invoice_id'] ?? row['expense_id'] ?? row['payment_id'] ?? row['payable_id'] ?? '')
}
