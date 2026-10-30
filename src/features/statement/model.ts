import { formatPaisa, productPaisa } from '@/lib/money'
import type { InquiryRow, QuoteLineRow, RfqItemRow } from '@/features/rfqs/api'
import { parseLeadTime, type WeightUnit } from '@/features/rfqs/lib/replyParse'

/*
 * The comparative statement of one RFQ / job: for each item, what every supplier that quoted it asked, with lead time, weight and
 * country of origin. Pure, so the screen, the PDF and the tests share one set of rules.
 *
 * Rules (owner, 2026-10-29):
 *   - It selects nothing. No "cheapest", no "recommended", nothing ticked. The default order is the supplier's name, A to Z. A person
 *     may sort by a column on screen; that changes the order of the rows and nothing else.
 *   - A line total is quantity x unit cost. That is what we pay, not a selling price; the CRM works out no selling price and no margin.
 *   - Totals are per supplier and per currency. Amounts in different currencies are never added together.
 *   - Admin and sales only (the database refuses an engineer the prices; the page does not draw for one).
 */

export type SortKey = 'supplier' | 'unit' | 'total' | 'lead' | 'weight' | 'origin'
export type SortDir = 'asc' | 'desc'
export interface SortSpec {
  key: SortKey
  dir: SortDir
}
/** What the statement opens with: the supplier's name, A to Z. */
export const DEFAULT_SORT: SortSpec = { key: 'supplier', dir: 'asc' }

export interface QuotedRow {
  kind: 'quoted'
  lineId: string
  supplierId: string
  supplierName: string
  currency: string
  /** The supplier's unit cost as a number (for sorting) and as it is shown: always 2 decimals, thousands grouped (rounded for display only). */
  unitCost: number
  unitCostText: string
  /** qty x unit cost, in the minor unit (paisa/cents), and as shown (the currency code goes in front). */
  totalMinor: bigint
  totalText: string
  leadTime: string | null
  leadDays: number | null
  /** Weight of ONE unit, in the unit the supplier gave. Null: not stated. */
  weightEach: number | null
  weightUnit: WeightUnit
  /** "0.4 kg": the weight of ONE unit, as the supplier gave it. */
  weightEachText: string | null
  /** The same weight in kg, for sorting. */
  weightKg: number | null
  origin: string | null
  note: string | null
}

/** Suppliers asked who gave no price for an item, grouped on one compact line: "No reply: A, B" and "Did not quote: C". */
export interface NoQuoteGroup {
  /** "No reply", "Can't quote" or "Did not quote". */
  label: string
  names: string[]
}

export interface StatementSection {
  item: RfqItemRow
  quantityText: string
  rows: QuotedRow[]
  /** The currency every row shares, else null (each cell then carries its own). Shown once in the column headings. */
  sharedCurrency: string | null
  /** Suppliers asked who gave no price for this item. Only built when asked for (the "did not reply" toggle). */
  noQuote: NoQuoteGroup[]
}

export interface SupplierTotal {
  supplierId: string
  supplierName: string
  itemsQuoted: number
  itemCount: number
  /** One entry per currency the supplier quoted in, A to Z by code. Never added across currencies. */
  byCurrency: Array<{ currency: string; totalMinor: bigint; totalText: string }>
}

export interface Statement {
  sections: StatementSection[]
  totals: SupplierTotal[]
  /** Suppliers asked with no price at all. */
  noReplyCount: number
}

const KG_PER: Record<WeightUnit, number> = { kg: 1, g: 0.001, lb: 0.45359237 }

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Always 2 decimals, thousands grouped: 115.8948 is "115.89", 1650 is "1,650.00". Rounds half away from zero, for display only. */
export function costText(value: number): string {
  return formatPaisa(productPaisa(1, value), 'always')
}

/** A quantity or weight, up to 3 decimals, no trailing zeros: 2.5, 400, 0.125. */
export function plainNumber(value: number): string {
  const [whole, frac = ''] = value.toFixed(3).split('.')
  const f = frac.replace(/0+$/, '')
  return f ? `${group(whole)}.${f}` : group(whole)
}

export const quantityText = (qty: number, unit: string | null): string => `${plainNumber(qty)}${unit ? ` ${unit}` : ''}`

function rowOf(item: RfqItemRow, inquiry: InquiryRow, l: QuoteLineRow): QuotedRow {
  const totalMinor = productPaisa(item.qty, l.unitPrice)
  const unit: WeightUnit = l.weightUnit ?? 'kg'
  const each = l.weight !== null && l.weight !== undefined && l.weight > 0 ? l.weight : null
  const lead = l.leadTime?.trim() || null
  return {
    kind: 'quoted',
    lineId: l.id,
    supplierId: inquiry.supplierId,
    supplierName: inquiry.supplierName,
    currency: l.currency,
    unitCost: l.unitPrice,
    unitCostText: costText(l.unitPrice),
    totalMinor,
    totalText: formatPaisa(totalMinor, 'always'),
    leadTime: lead,
    leadDays: lead ? (parseLeadTime(lead)?.daysMax ?? null) : null,
    weightEach: each,
    weightUnit: unit,
    weightEachText: each === null ? null : `${plainNumber(each)} ${unit}`,
    weightKg: each === null ? null : each * KG_PER[unit],
    origin: l.origin?.trim() || null,
    note: l.notes?.trim() || null,
  }
}

const byName = (a: { supplierName: string }, b: { supplierName: string }) => a.supplierName.localeCompare(b.supplierName, 'en', { sensitivity: 'base' })

/** null sorts last whichever way the column is sorted: a blank is not the smallest or the largest value. */
function compareNullable(a: number | string | null, b: number | string | null, dir: SortDir): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const c = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b), 'en', { sensitivity: 'base' }) : a - b
  return dir === 'asc' ? c : -c
}

/** Orders rows by one column. Amounts in different currencies are grouped by currency code first, never compared as numbers. */
export function sortRows(rows: readonly QuotedRow[], sort: SortSpec = DEFAULT_SORT): QuotedRow[] {
  const out = [...rows]
  const sign = sort.dir === 'asc' ? 1 : -1
  out.sort((a, b) => {
    let c = 0
    switch (sort.key) {
      case 'supplier':
        c = byName(a, b) * sign
        break
      case 'unit':
        c = a.currency.localeCompare(b.currency) || compareNullable(a.unitCost, b.unitCost, sort.dir)
        break
      case 'total': {
        const diff = a.totalMinor < b.totalMinor ? -1 : a.totalMinor > b.totalMinor ? 1 : 0
        c = a.currency.localeCompare(b.currency) || diff * sign
        break
      }
      case 'lead':
        c = compareNullable(a.leadDays, b.leadDays, sort.dir)
        break
      case 'weight':
        c = compareNullable(a.weightKg, b.weightKg, sort.dir)
        break
      case 'origin':
        c = compareNullable(a.origin, b.origin, sort.dir)
        break
    }
    return c || byName(a, b)
  })
  return out
}

export interface BuildOptions {
  /** List suppliers asked who gave no price for an item (default off). */
  showNoReply?: boolean
  sort?: SortSpec
}

/** A supplier "asked": the enquiry went to it, or it answered. A supplier only on the shortlist is not asked yet. */
const wasAsked = (i: InquiryRow) => Boolean(i.sentOn || i.noOfferOn || i.lines.length > 0)

export function buildStatement(items: readonly RfqItemRow[], inquiries: readonly InquiryRow[], opts: BuildOptions = {}): Statement {
  const asked = inquiries.filter(wasAsked)
  const sections: StatementSection[] = items.map(item => {
    const rows: QuotedRow[] = []
    const noQuote = new Map<string, string[]>()
    for (const inq of asked) {
      const line = inq.lines.find(l => l.itemId === item.id)
      if (line) {
        rows.push(rowOf(item, inq, line))
        continue
      }
      if (!opts.showNoReply) continue
      const declined = inq.itemDeclines[item.id]
      const label = inq.lines.length === 0 && inq.noOfferOn ? "Can't quote" : declined ? "Can't quote" : inq.lines.length === 0 ? 'No reply' : 'Did not quote'
      noQuote.set(label, [...(noQuote.get(label) ?? []), inq.supplierName])
    }
    const currencies = [...new Set(rows.map(r => r.currency))]
    const groups: NoQuoteGroup[] = ['No reply', "Can't quote", 'Did not quote']
      .filter(l => noQuote.has(l))
      .map(l => ({ label: l, names: (noQuote.get(l) as string[]).sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })) }))
    return { item, quantityText: quantityText(item.qty, item.unit), rows: sortRows(rows, opts.sort), sharedCurrency: currencies.length === 1 ? currencies[0] : null, noQuote: groups }
  })

  const totals: SupplierTotal[] = asked
    .filter(i => i.lines.length > 0)
    .map(inq => {
      const sums = new Map<string, bigint>()
      let quoted = 0
      for (const item of items) {
        const l = inq.lines.find(x => x.itemId === item.id)
        if (!l) continue
        quoted += 1
        sums.set(l.currency, (sums.get(l.currency) ?? 0n) + productPaisa(item.qty, l.unitPrice))
      }
      return {
        supplierId: inq.supplierId,
        supplierName: inq.supplierName,
        itemsQuoted: quoted,
        itemCount: items.length,
        byCurrency: [...sums.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, totalMinor]) => ({ currency, totalMinor, totalText: formatPaisa(totalMinor, 'always') })),
      }
    })
    .filter(t => t.itemsQuoted > 0)
    .sort(byName)

  return { sections, totals, noReplyCount: asked.filter(i => i.lines.length === 0).length }
}

const SORT_WORDS: Record<SortKey, string> = {
  supplier: 'supplier name',
  unit: 'unit cost',
  total: 'line total',
  lead: 'lead time',
  weight: 'weight',
  origin: 'country of origin',
}

/** What the person is looking at, in words: printed on screen and on the PDF so an order is never read as a ranking. */
/** Said on screen only when a person has sorted by a column: it is an order on the page and nothing more. */
export function orderNote(sort: SortSpec): string | null {
  if (sort.key === 'supplier' && sort.dir === 'asc') return null
  const dir = sort.key === 'supplier' ? (sort.dir === 'asc' ? 'A to Z' : 'Z to A') : sort.dir === 'asc' ? 'low to high' : 'high to low'
  return `Sorted by ${SORT_WORDS[sort.key]}, ${dir}${sort.key === 'unit' || sort.key === 'total' ? ' (within each currency)' : ''}. This only changes the order on the page.`
}
