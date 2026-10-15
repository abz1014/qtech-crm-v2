import type { ReactNode } from 'react'
import { hasPaisa, paisaToFixed, sumPaisa, toPaisa, type Amount, type PaisaMode } from '@/lib/money'

/* Column model and pure helpers for DataTable (kept apart so they can be unit-tested without a DOM). */

export type Cell = string | number | null | undefined
export type ColumnKind = 'text' | 'num' | 'money' | 'date'

export interface Column<T> {
  id: string
  /** Plain text: the header, the aria label and the CSV header. Put "(PKR)" on money columns. */
  header: string
  /** text left; num and money right, mono. date is mono, left. */
  kind?: ColumnKind
  /** The raw value: used for sorting, totals and CSV. Money values are rupees (number or decimal string). */
  value?: (row: T) => Cell
  /** What to draw. Defaults to the value, formatted for its kind. */
  cell?: (row: T) => ReactNode
  align?: 'left' | 'right'
  sortable?: boolean
  /** Fixed width in px (or any CSS length). Text then truncates with an ellipsis. */
  width?: number | string
  /** Hide below the md breakpoint (tablet portrait and phones). */
  hideBelowMd?: boolean
  /** true: sum of `value` (exact, in paisa, for money). A function draws a custom total from the rows. */
  total?: true | ((rows: T[]) => ReactNode)
  /** Money columns: 'column-auto' (default) shows two decimals on every row when any row has paisa. */
  paisa?: PaisaMode | 'column-auto'
  /** CSV cell; defaults to `value` (money becomes a number, never a string that could start with "-"). */
  csv?: (row: T) => Cell
}

export type SortDir = 'asc' | 'desc'
export interface SortState {
  id: string
  dir: SortDir
}

const num = (v: Cell): bigint | number | null => {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'number' ? v : Number(v)
}

/** Compare two raw cells. Nulls sort last in both directions. Money compares exactly, in paisa. */
export function compareCells(a: Cell, b: Cell, kind: ColumnKind = 'text'): number {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an || bn) return an === bn ? 0 : an ? 1 : -1
  if (kind === 'money') {
    const x = toPaisa(a as Amount)
    const y = toPaisa(b as Amount)
    return x < y ? -1 : x > y ? 1 : 0
  }
  if (kind === 'num') return (num(a) as number) - (num(b) as number)
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' })
}

export function sortRows<T>(rows: readonly T[], col: Column<T> | undefined, dir: SortDir): T[] {
  if (!col?.value) return [...rows]
  const get = col.value
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((r1, r2) => {
    const a = get(r1)
    const b = get(r2)
    const missing = a === null || a === undefined || a === '' || b === null || b === undefined || b === ''
    // Missing values stay last whichever way the column is sorted.
    return missing ? compareCells(a, b, col.kind) : sign * compareCells(a, b, col.kind)
  })
}

/** Exact column total: bigint paisa for money, a plain number for counts and quantities. */
export function columnTotal<T>(col: Column<T>, rows: readonly T[]): bigint | number | null {
  if (col.total !== true || !col.value) return null
  const get = col.value
  if (col.kind === 'money') {
    return sumPaisa(rows.map(get).filter((v): v is Amount => v !== null && v !== undefined && v !== ''))
  }
  return rows.reduce<number>((n, r) => n + (Number(get(r)) || 0), 0)
}

/** Does this money column need two decimals on every row (any row has non-zero paisa, or its total does)? */
export function columnShowsPaisa<T>(col: Column<T>, rows: readonly T[]): boolean {
  if (col.kind !== 'money' || !col.value) return false
  const get = col.value
  return hasPaisa(rows.map(get) as Array<Amount | null | undefined>)
}

export interface CsvOptions {
  /** Append a "Total" row when any column has totals. Default true. */
  totals?: boolean
}

/** Cells for generateCSV: header row first handled by the caller. Money exports as a number to the paisa. */
export function tableCsvRows<T>(columns: Column<T>[], rows: readonly T[], opts: CsvOptions = {}): { headers: string[]; rows: Array<Array<string | number | null>> } {
  const cellOf = (col: Column<T>, row: T): string | number | null => {
    const v = (col.csv ?? col.value)?.(row)
    if (v === null || v === undefined || v === '') return null
    return col.kind === 'money' && !col.csv ? Number(paisaToFixed(toPaisa(v as Amount))) : v
  }
  const body = rows.map(r => columns.map(c => cellOf(c, r)))
  if (opts.totals !== false && columns.some(c => c.total === true)) {
    body.push(
      columns.map((c, i) => {
        const t = columnTotal(c, rows)
        if (t === null) return i === 0 ? 'Total' : null
        return typeof t === 'bigint' ? Number(paisaToFixed(t)) : t
      }),
    )
  }
  return { headers: columns.map(c => c.header), rows: body }
}

export type Density = 'comfortable' | 'compact'

/** "Fri 27 Nov, 09:41" in the business timezone (Asia/Karachi): the stamp under a table that could not load. */
export function formatStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const p = (t: string) => parts.find(x => x.type === t)?.value ?? ''
  return `${p('weekday')} ${p('day')} ${p('month')}, ${p('hour')}:${p('minute')}`
}

/** The default sentence under a table that failed to load, with the stamp and the request reference. */
export const ERROR_MESSAGE = 'Your changes are safe. Check your connection and try again.'
