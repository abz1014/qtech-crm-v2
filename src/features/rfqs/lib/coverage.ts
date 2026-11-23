import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import { askedAbout } from '@/features/rfqs/lib/askedItems'

/*
 * Who answered what (the coverage board, the gap bar and the supplier rows, owner's lean cut of supplier-replies-mockup.html). One
 * status per supplier and item, from the facts the page already reads: the quote lines, the cannot-quote records (per item, or the
 * whole inquiry), the quoting-later records (0145) and which items the supplier was asked about (0140). "Replied" is the reply
 * chip's rule (SupplierReplies.tsx ReplyChip): a price, a cannot quote, or v_inquiry_state saying quoted or no_offer.
 * Nothing here looks at a price amount: the board never ranks, and an engineer's lines carry no price at all.
 */

export type CellStatus = 'priced' | 'later' | 'cannot' | 'left-out' | 'no-reply' | 'not-asked'

/** The words for each status (the legend, the side panel, the screen reader). */
export const STATUS_WORDS: Record<CellStatus, string> = {
  priced: 'Priced',
  later: 'Quoting later',
  cannot: 'Cannot quote',
  'left-out': 'Replied, left this item out',
  'no-reply': 'No reply yet',
  'not-asked': 'Not asked',
}

/** The part of an inquiry these rules read. */
export type CoverageInquiry = Pick<InquiryRow, 'id' | 'supplierId' | 'supplierName' | 'supplierCountry' | 'sentOn' | 'noOfferOn' | 'itemDeclines' | 'itemWaits' | 'askedItemIds' | 'responseState'> & {
  lines: readonly { itemId: string }[]
}
export type CoverageItem = Pick<RfqItemRow, 'id' | 'number' | 'description' | 'brandName'>

export type Reach = 'local' | 'international'

/** Local is Pakistan (by name or code, any case). An unknown country is neither. */
export function supplierReach(country: string | null | undefined): Reach | null {
  const c = (country ?? '').trim().toLowerCase()
  if (!c) return null
  return c === 'pakistan' || c === 'pk' ? 'local' : 'international'
}

export const REACH_WORDS: Record<Reach, string> = { local: 'Local', international: 'International' }

/** The reply chip's rule: a price, a cannot quote, or the database says quoted or no offer. */
export function hasReplied(i: CoverageInquiry): boolean {
  return i.lines.length > 0 || Boolean(i.noOfferOn) || i.responseState === 'quoted' || i.responseState === 'no_offer'
}

/** Asked (sent, or answered): a supplier only on the shortlist is not on the board. */
export function isAsked(i: CoverageInquiry): boolean {
  return Boolean(i.sentOn) || Boolean(i.noOfferOn) || i.lines.length > 0
}

/** Where one supplier stands on one item. */
export function cellStatus(i: CoverageInquiry, itemId: string): CellStatus {
  if (i.lines.some(l => l.itemId === itemId)) return 'priced'
  if (i.itemDeclines[itemId]) return 'cannot'
  if (i.itemWaits?.[itemId]) return 'later'
  if (!askedAbout(i, itemId)) return 'not-asked'
  if (i.noOfferOn) return 'cannot'
  return hasReplied(i) ? 'left-out' : 'no-reply'
}

export interface Counts {
  priced: number
  later: number
  cannot: number
  'left-out': number
  'no-reply': number
  'not-asked': number
}

const zero = (): Counts => ({ priced: 0, later: 0, cannot: 0, 'left-out': 0, 'no-reply': 0, 'not-asked': 0 })

export interface ItemSummary {
  counts: Counts
  /** No supplier has priced it. */
  noPrice: boolean
  /** A supplier still has to answer it (quoting later, or no reply yet). */
  open: boolean
}

/** One item across the suppliers asked. */
export function itemSummary(inquiries: readonly CoverageInquiry[], itemId: string): ItemSummary {
  const counts = zero()
  for (const i of inquiries) counts[cellStatus(i, itemId)] += 1
  return { counts, noPrice: counts.priced === 0, open: counts.later + counts['no-reply'] > 0 }
}

/** "3 prices", "1 price", "No price". */
export function pricesWord(n: number): string {
  return n === 0 ? 'No price' : `${n} ${n === 1 ? 'price' : 'prices'}`
}

/** "1 later · 1 no reply", or '' when nobody still has to answer. */
export function openWords(c: Counts): string {
  return [c.later ? `${c.later} later` : '', c['no-reply'] ? `${c['no-reply']} no reply` : ''].filter(Boolean).join(' · ')
}

export interface SupplierCounts extends Counts {
  /** Items this supplier was asked about (or answered anyway). */
  asked: number
  total: number
}

/** One supplier across the items. */
export function supplierCounts(i: CoverageInquiry, items: readonly CoverageItem[]): SupplierCounts {
  const counts = zero()
  for (const it of items) counts[cellStatus(i, it.id)] += 1
  return { ...counts, asked: items.length - counts['not-asked'], total: items.length }
}

/** "Asked for all 31 · 4 priced · 1 cannot", "Asked for 5 of 31 · 2 later". */
export function supplierCountsText(c: SupplierCounts): string {
  const head = c.asked === c.total ? `Asked for all ${c.total}` : `Asked for ${c.asked} of ${c.total}`
  const parts = [
    c.priced ? `${c.priced} priced` : '',
    c.later ? `${c.later} later` : '',
    c.cannot ? `${c.cannot} cannot` : '',
    c['left-out'] ? `${c['left-out']} left out` : '',
  ].filter(Boolean)
  return [head, ...parts].join(' · ')
}

/** no-reply: asked, nothing back. later: something still promised. done: every asked item answered. shortlist: not asked yet. */
export type SupplierStage = 'no-reply' | 'later' | 'done' | 'shortlist'
const STAGE_ORDER: Record<SupplierStage, number> = { 'no-reply': 0, later: 1, done: 2, shortlist: 3 }

export function supplierStage(i: CoverageInquiry, items: readonly CoverageItem[]): SupplierStage {
  if (!isAsked(i)) return 'shortlist'
  const c = supplierCounts(i, items)
  if (!hasReplied(i) && c.later === 0) return 'no-reply'
  if (c.later > 0 || c['no-reply'] > 0) return 'later'
  return 'done'
}

/** No reply first, then the ones still quoting some items later, then the complete ones; the order they were asked in otherwise. */
export function sortSuppliers<T extends CoverageInquiry>(inquiries: readonly T[], items: readonly CoverageItem[]): T[] {
  return inquiries
    .map((i, n) => ({ i, n, s: STAGE_ORDER[supplierStage(i, items)] }))
    .sort((a, b) => a.s - b.s || a.n - b.n)
    .map(x => x.i)
}

/** "8 asked · 2 local, 6 international". A supplier with no country is counted as asked only. */
export function askedReachText(inquiries: readonly CoverageInquiry[]): string {
  const asked = inquiries.filter(isAsked)
  const local = asked.filter(i => supplierReach(i.supplierCountry) === 'local').length
  const intl = asked.filter(i => supplierReach(i.supplierCountry) === 'international').length
  const reach = [local ? `${local} local` : '', intl ? `${intl} international` : ''].filter(Boolean).join(', ')
  return reach ? `${asked.length} asked · ${reach}` : `${asked.length} asked`
}

/** The board shows from 5 items or 3 suppliers asked; below that the items list says it all. */
export function showBoard(itemCount: number, askedCount: number): boolean {
  return askedCount > 0 && (itemCount >= 5 || askedCount >= 3)
}

export interface Gap {
  items: CoverageItem[]
  /** Of those, the ones a supplier still has to answer. */
  open: number
}

/** The items no supplier asked has priced. */
export function gapOf(items: readonly CoverageItem[], inquiries: readonly CoverageInquiry[]): Gap {
  const asked = inquiries.filter(isAsked)
  const gap = items.map(it => ({ it, s: itemSummary(asked, it.id) })).filter(x => x.s.noPrice)
  return { items: gap.map(x => x.it), open: gap.filter(x => x.s.open).length }
}

const GAP_NAMED = 6

/** "2 items have no price yet: item 27 (WIKA), item 28 (B&R)." and "2 of them still have a supplier to answer." */
export function gapText(gap: Gap): { lead: string; list: string; open: string | null } {
  const n = gap.items.length
  const named = gap.items.slice(0, GAP_NAMED).map(it => (it.brandName ? `item ${it.number} (${it.brandName})` : `item ${it.number}`))
  const more = n > GAP_NAMED ? ` and ${n - GAP_NAMED} more` : ''
  const lead = n === 1 ? '1 item has no price yet:' : `${n} items have no price yet:`
  const open = gap.open === 0 ? null : n === 1 ? 'A supplier still has to answer it.' : `${gap.open} of them still have a supplier to answer.`
  return { lead, list: `${named.join(', ')}${more}.`, open }
}

/** Short column names: the first word, or the first two when two suppliers share the first. */
export function shortNames(names: readonly string[]): string[] {
  const first = (s: string) => s.trim().split(/\s+/)[0] ?? s
  const two = (s: string) => s.trim().split(/\s+/).slice(0, 2).join(' ')
  return names.map(n => (names.filter(m => first(m).toLowerCase() === first(n).toLowerCase()).length > 1 ? two(n) : first(n)))
}

export interface BrandGroup<T> {
  brand: string
  items: T[]
}

/** The items by brand, in the order each brand first appears; one group when there is only one brand. */
export function groupByBrand<T extends CoverageItem>(items: readonly T[]): BrandGroup<T>[] {
  const groups: BrandGroup<T>[] = []
  for (const it of items) {
    const brand = it.brandName?.trim() || 'No brand'
    const g = groups.find(x => x.brand === brand)
    if (g) g.items.push(it)
    else groups.push({ brand, items: [it] })
  }
  return groups
}

export type BoardFilter = 'all' | 'no-price' | 'later'

/** The items a filter and a search leave. The search looks in the description (which holds the part number) and the brand. */
export function filterItems<T extends CoverageItem & { familyName?: string | null }>(
  items: readonly T[],
  inquiries: readonly CoverageInquiry[],
  filter: BoardFilter,
  search: string,
): T[] {
  const q = search.trim().toLowerCase()
  return items.filter(it => {
    if (filter !== 'all') {
      const s = itemSummary(inquiries, it.id)
      if (filter === 'no-price' && !s.noPrice) return false
      if (filter === 'later' && s.counts.later === 0) return false
    }
    if (!q) return true
    return [it.description, it.brandName ?? '', it.familyName ?? '', String(it.number)].some(f => f.toLowerCase().includes(q))
  })
}
