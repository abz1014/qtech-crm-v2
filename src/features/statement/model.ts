import { formatPaisa, productPaisa } from '@/lib/money'
import type { InquiryRow, QuoteLineRow, RfqItemRow } from '@/features/rfqs/api'
import { reasonLabel } from '@/features/rfqs/lib/cantQuote'
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
  /** The supplier's unit cost as a number (for sorting) and as it is shown: "412.5" is "412.50", "0.0125" stays "0.0125". */
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
  weightEachText: string | null
  weightTotalText: string | null
  /** The same weight in kg, for sorting. */
  weightKg: number | null
  origin: string | null
  note: string | null
}

export interface NoQuoteRow {
  kind: 'none'
  supplierId: string
  supplierName: string
  /** "No reply", "Can't quote: not our brand" or "Did not quote this item". */
  reason: string
}

export interface StatementSection {
  item: RfqItemRow
  quantityText: string
  rows: QuotedRow[]
  /** Suppliers asked who gave no price for this item. Only built when asked for (the "No reply" toggle). */
  noQuote: NoQuoteRow[]
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

/** "1650" -> "1,650.00", "0.0125" -> "0.0125", "412.5" -> "412.50": at least 2 decimals, at most 4, thousands grouped. */
export function costText(value: number): string {
  const [whole, frac = ''] = value.toFixed(4).split('.')
  let f = frac.replace(/0+$/, '')
  if (f.length < 2) f = f.padEnd(2, '0')
  return `${group(whole)}.${f}`
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
    weightTotalText: each === null ? null : `${plainNumber(Number((each * item.qty).toFixed(3)))} ${unit}`,
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
    const noQuote: NoQuoteRow[] = []
    for (const inq of asked) {
      const line = inq.lines.find(l => l.itemId === item.id)
      if (line) {
        rows.push(rowOf(item, inq, line))
        continue
      }
      if (!opts.showNoReply) continue
      const declined = inq.itemDeclines[item.id]
      const reason =
        inq.lines.length === 0 && inq.noOfferOn
          ? `Can't quote${inq.noOfferReason ? `: ${reasonLabel(inq.noOfferReason)}` : ''}`
          : declined
            ? `Can't quote: ${reasonLabel(declined)}`
            : inq.lines.length === 0
              ? 'No reply'
              : 'Did not quote this item'
      noQuote.push({ kind: 'none', supplierId: inq.supplierId, supplierName: inq.supplierName, reason })
    }
    return { item, quantityText: quantityText(item.qty, item.unit), rows: sortRows(rows, opts.sort), noQuote: noQuote.sort(byName) }
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
