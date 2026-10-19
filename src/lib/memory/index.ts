// Supplier memory, the display side (R17; DATA_MODEL 5c and Amendment A2b). Pure and framework-free.
//
// The database derives the facts (supplier_item_memory(), v_supplier_stats). This module decides how they are SAID:
//  - every rate is a count out of a count, never a percentage and never a score;
//  - below a threshold only the raw fact is shown ("asked twice, 1 reply", "no history yet");
//  - prices in history show the rate captured on the day ("at the time"), never today's; a line with no captured rate
//    shows its own currency only;
//  - a price older than 18 months carries its age; a price whose currency is unverified is hidden;
//  - imported history is marked wherever it feeds a number.
// Nothing here orders anything. (A8 supersedes the old "memory never reorders" rule: the float suggestions are ordered by track record
// inside each reason group, in features/rfqs/lib/supplierSuggestion.ts.)

import { formatAmount, formatRate } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'

// ------------------------------------------------------------------------------------------------ inputs

/** The columns of supplier_item_memory() the UI reads (every column the function returns). */
export interface MemoryRow {
  supplier_id: string
  best_tier: number | null
  best_tier_label?: string | null
  supplied_before: boolean | null
  last_quote_tier?: number | null
  last_quote_on?: string | null
  last_quote_price?: number | null
  last_quote_currency?: string | null
  last_quote_price_hidden?: boolean | null
  last_quote_fx_rate_pkr?: number | null
  last_quote_fx_rate_on?: string | null
  last_quote_price_pkr?: number | null
  last_quote_qty?: number | null
  last_quote_unit?: string | null
  last_quote_lead_time?: string | null
  last_quote_is_legacy?: boolean | null
  recent_lead_times?: readonly string[] | null
  last_po_tier?: number | null
  last_po_on?: string | null
  last_po_price?: number | null
  last_po_currency?: string | null
  last_po_fx_rate_pkr?: number | null
  last_po_fx_rate_on?: string | null
  last_po_price_pkr?: number | null
  last_po_qty?: number | null
  last_po_unit?: string | null
  last_ordered_source?: string | null
  last_ordered_tier?: number | null
  last_ordered_on?: string | null
  last_ordered_price?: number | null
  last_ordered_currency?: string | null
  last_ordered_fx_rate_pkr?: number | null
  last_ordered_fx_rate_on?: string | null
  last_ordered_price_pkr?: number | null
  last_ordered_qty?: number | null
  last_ordered_unit?: string | null
  /** A8 (0049): the most recent non-cancelled order at the best tier with a leg for this supplier. Null when there is none. */
  evidence_tier?: number | null
  evidence_order_id?: string | null
  evidence_order_number?: number | null
  evidence_item_desc?: string | null
  evidence_qty?: number | null
  evidence_placed_on?: string | null
  evidence_expected_on?: string | null
  evidence_delivered_on?: string | null
  evidence_delivered_after_days?: number | null
  evidence_count_at_tier?: number | null
}

/** The columns of v_supplier_stats the card reads. A company with no activity has none of them (all null). */
export interface MemoryStats {
  asked?: number | null
  replied?: number | null
  no_offer?: number | null
  reply_days_n?: number | null
  median_reply_days?: number | null
  chosen_of?: number | null
  chosen?: number | null
  deliveries?: number | null
  late?: number | null
  median_days_late?: number | null
  last_contact?: string | null
  legacy_asked?: number | null
  prices_hidden?: number | null
  /** Non-cancelled orders with a leg for this supplier (v_supplier_stats.orders_count, 0066). */
  orders_count?: number | null
  brand_names?: readonly string[] | null
}

// ------------------------------------------------------------------------------------------------ tiers

export type TierLabel = 'same model' | 'same item' | 'same brand' | 'same family'

const TIERS: TierLabel[] = ['same model', 'same item', 'same brand', 'same family']

export function tierLabelOf(tier: number | null | undefined): TierLabel | null {
  return tier === 0 || tier === 1 || tier === 2 || tier === 3 ? TIERS[tier] : null
}

/** One sentence on why this history counts for this item. */
export function matchedOn(tier: number | null | undefined): string {
  switch (tier) {
    case 0:
      return 'Matched on model code.'
    case 1:
      return 'Matched on brand and description.'
    case 2:
      return 'Matched on brand only.'
    case 3:
      return 'Matched on item family only.'
    default:
      return 'Matched on a brand or family they carry. Nothing quoted or ordered for it yet.'
  }
}

// ------------------------------------------------------------------------------------------------ dates

/** Prices older than this show their age (DATA_MODEL 5c). */
export const OLD_PRICE_MONTHS = 18

const dparts = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}

/** Whole calendar months from `iso` to `today`. */
export function monthsBetween(iso: string, today: string): number {
  const a = dparts(iso)
  const b = dparts(today)
  if (!a || !b) return 0
  return Math.max(0, (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0))
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (iso: string) => {
  const p = dparts(iso)
  return p ? `${MON[p.m - 1]} ${p.y}` : iso
}

export interface AgedDate {
  /** "14 Jun", or "Apr 2025" once old. */
  text: string
  /** "19 months ago", only once the date is older than 18 months. */
  ago: string | null
}

export function agedDate(iso: string, today: string): AgedDate {
  const months = monthsBetween(iso, today)
  if (months > OLD_PRICE_MONTHS) return { text: monthYear(iso), ago: `${months} months ago` }
  return { text: formatShortDate(iso, today), ago: null }
}

// ------------------------------------------------------------------------------------------------ one price

export interface PriceFact {
  state: 'none' | 'hidden' | 'price'
  /** "USD 1,980" (the original currency first), or the bare number when no currency was recorded. */
  amount: string | null
  /** The figure alone with two decimals ("214.00"), for tables where every price lines up. */
  figure: string | null
  /** The PKR value at the rate captured that day, "551,000". Null when no rate was captured, or the price is in PKR. */
  pkr: string | null
  /** The rate behind `pkr`, "326.80 · 11 Oct". */
  rate: string | null
  /** One line when there is no PKR figure and a reader would wonder why. */
  note: string | null
  date: AgedDate | null
  qty: string | null
  /** Where an ordered price came from. */
  source: string | null
  imported: boolean
  /** The price is already in PKR: there is nothing to convert. */
  inPkr: boolean
}

const NONE: PriceFact = { state: 'none', amount: null, figure: null, pkr: null, rate: null, note: null, date: null, qty: null, source: null, imported: false, inPkr: false }

function qtyText(qty: number | null | undefined, unit: string | null | undefined): string | null {
  if (qty === null || qty === undefined) return null
  const n = formatAmount(qty, 'auto')
  return unit && unit.trim() ? `${n} ${unit.trim()}` : n
}

export interface PriceIn {
  on: string | null | undefined
  price: number | null | undefined
  currency: string | null | undefined
  hidden?: boolean | null
  rate: number | null | undefined
  rateOn: string | null | undefined
  pkr: number | null | undefined
  qty?: number | null
  unit?: string | null
  imported?: boolean
  source?: string | null
}

/** One recorded price, said the way every history display says it (5c item 5). */
export function priceFactOf(p: PriceIn, today: string): PriceFact {
  if (!p.on) return NONE
  const date = agedDate(p.on, today)
  const cur = p.currency?.trim() || null
  if (p.hidden) {
    return { ...NONE, state: 'hidden', date, note: 'currency unverified, so not shown', qty: qtyText(p.qty, p.unit), imported: Boolean(p.imported), source: p.source ?? null }
  }
  if (p.price === null || p.price === undefined) return NONE
  const amount = cur ? `${cur} ${formatAmount(p.price, 'auto')}` : formatAmount(p.price, 'auto')
  let pkr: string | null = null
  let rate: string | null = null
  let note: string | null = null
  if (!cur) {
    note = 'no currency recorded on the order'
  } else if (cur === 'PKR') {
    // Nothing to convert.
  } else if (p.pkr !== null && p.pkr !== undefined && p.rate !== null && p.rate !== undefined) {
    pkr = formatAmount(p.pkr, 'never')
    rate = `${formatRate(p.rate)}${p.rateOn ? ` · ${formatShortDate(p.rateOn, today)}` : ''}`
  } else {
    note = 'PKR value not captured at the time'
  }
  return { state: 'price', amount, figure: formatAmount(p.price, 'always'), pkr, rate, note, date, qty: qtyText(p.qty, p.unit), source: p.source ?? null, imported: Boolean(p.imported), inPkr: cur === 'PKR' }
}

export function lastQuoteFact(r: MemoryRow | null | undefined, today: string): PriceFact {
  if (!r || !r.last_quote_on) return NONE
  return priceFactOf(
    {
      on: r.last_quote_on,
      price: r.last_quote_price,
      currency: r.last_quote_currency,
      hidden: r.last_quote_price_hidden,
      rate: r.last_quote_fx_rate_pkr,
      rateOn: r.last_quote_fx_rate_on,
      pkr: r.last_quote_price_pkr,
      qty: r.last_quote_qty,
      unit: r.last_quote_unit,
      imported: r.last_quote_is_legacy ?? false,
    },
    today,
  )
}

export function lastOrderedFact(r: MemoryRow | null | undefined, today: string): PriceFact {
  if (!r || !r.last_ordered_on || r.last_ordered_price === null || r.last_ordered_price === undefined) return NONE
  return priceFactOf(
    {
      on: r.last_ordered_on,
      price: r.last_ordered_price,
      currency: r.last_ordered_currency,
      rate: r.last_ordered_fx_rate_pkr,
      rateOn: r.last_ordered_fx_rate_on,
      pkr: r.last_ordered_price_pkr,
      qty: r.last_ordered_qty,
      unit: r.last_ordered_unit,
      source: r.last_ordered_source === 'order' ? 'agreed on order, no PO issued' : 'PO',
    },
    today,
  )
}

// ------------------------------------------------------------------------------------------------ the facts about the supplier

const WORDS = ['no times', 'once', 'twice']
const times = (n: number) => (n < WORDS.length ? WORDS[n] : `${n} times`)
const repliesText = (n: number) => (n === 0 ? 'no reply' : n === 1 ? '1 reply' : `${n} replies`)

export interface TwoLine {
  main: string
  sub: string | null
}

/** "answered 4 of 6" with the usual reply time only when 3 replies were logged here; raw facts below 3 asks. */
export function repliesFact(s: MemoryStats | null | undefined): TwoLine {
  const asked = s?.asked ?? 0
  const replied = s?.replied ?? 0
  if (asked <= 0) return { main: 'No history yet', sub: null }
  if (asked < 3) return { main: `asked ${asked === 1 ? 'once' : times(asked)}`, sub: repliesText(replied) }
  const median = s?.median_reply_days
  if (median !== null && median !== undefined) {
    const days = Math.round(median)
    return { main: `answered ${replied} of ${asked}`, sub: days < 1 ? 'usually logs a reply the same day' : `usually logs a reply in ~${days} ${days === 1 ? 'day' : 'days'}` }
  }
  return { main: `answered ${replied} of ${asked}`, sub: 'reply time needs 3 replies logged here' }
}

/** "chosen 2 of 3 times" and "late 1 of 4 deliveries"; null when neither has anything behind it. */
export function ordersFact(s: MemoryStats | null | undefined): TwoLine | null {
  const chosenOf = s?.chosen_of ?? 0
  const deliveries = s?.deliveries ?? 0
  if (chosenOf < 1 && deliveries < 1) return null
  const late = s?.late ?? 0
  const lateText =
    deliveries >= 1
      ? `late ${late} of ${deliveries} ${deliveries === 1 ? 'delivery' : 'deliveries'}${s?.median_days_late != null ? `, usually ~${Math.round(s.median_days_late)} days over` : ''}`
      : null
  if (chosenOf >= 1) {
    const base = 'a quoted item was later ordered'
    return { main: `chosen ${s?.chosen ?? 0} of ${chosenOf} ${chosenOf === 1 ? 'time' : 'times'}`, sub: lateText ? `${base} · ${lateText}` : base }
  }
  return { main: `${deliveries} ${deliveries === 1 ? 'delivery' : 'deliveries'}`, sub: lateText }
}

// ------------------------------------------------------------------------------------------------ the card

export interface MemoryCard {
  tierLabel: TierLabel | null
  matchedOn: string
  /** "this item" for tiers 0 and 1, "this brand" for 2, "this family" for 3. */
  scope: 'item' | 'brand' | 'family'
  quote: PriceFact
  ordered: PriceFact
  /** The lead time as the supplier wrote it, and the one before that. */
  lead: { latest: string | null; before: string | null }
  brands: readonly string[]
  replies: TwoLine
  orders: TwoLine | null
  lastContact: string | null
  hasImported: boolean
  /** Nothing on record for this supplier at all. */
  empty: boolean
  footnote: string
}

export function buildMemoryCard(row: MemoryRow | null | undefined, stats: MemoryStats | null | undefined, today: string): MemoryCard {
  const tier = row?.best_tier ?? null
  const quote = lastQuoteFact(row, today)
  const ordered = lastOrderedFact(row, today)
  const leads = (row?.recent_lead_times ?? []).filter(l => l && l.trim())
  const latestLead = leads[0] ?? (row?.last_quote_lead_time && row.last_quote_lead_time.trim() ? row.last_quote_lead_time : null)
  const asked = stats?.asked ?? 0
  const lastContact = stats?.last_contact ?? null
  const orders = ordersFact(stats)
  const hasImported = (stats?.legacy_asked ?? 0) > 0 || quote.imported
  const hidden = stats?.prices_hidden ?? 0
  const empty = asked === 0 && !lastContact && quote.state === 'none' && ordered.state === 'none' && !orders

  const notes: string[] = []
  if (empty) notes.push('Nothing recorded or imported for this supplier yet.')
  else {
    if (asked > 0 && asked < 3) notes.push(`${asked === 1 ? 'One enquiry' : asked === 2 ? 'Two enquiries' : `${asked} enquiries`} on record. Too few to say how quickly they usually reply.`)
    if (hasImported) notes.push(`Includes imported history${hidden > 0 ? ` · ${hidden} ${hidden === 1 ? 'price' : 'prices'} hidden (currency unverified)` : ''}.`)
    if ([quote, ordered].some(p => p.date?.ago)) notes.push(`Prices older than ${OLD_PRICE_MONTHS} months are marked with their age.`)
    if (orders && lastContact) notes.push(`Last contacted ${formatShortDate(lastContact, today)}.`)
  }

  return {
    tierLabel: tierLabelOf(tier),
    matchedOn: matchedOn(tier),
    scope: tier === 2 ? 'brand' : tier === 3 ? 'family' : 'item',
    quote,
    ordered,
    lead: { latest: latestLead, before: leads.length > 1 ? leads[1] : null },
    brands: stats?.brand_names ?? [],
    replies: repliesFact(stats),
    orders,
    lastContact,
    hasImported,
    empty,
    footnote: notes.join(' '),
  }
}

// ------------------------------------------------------------------------------------------------ the chip on a reply row

export interface LastPriceChip {
  state: 'price' | 'hidden'
  /** "USD 412", or the bare number when no currency was recorded. */
  amount: string | null
  pkr: string | null
  rate: string | null
  /** "PKR value not captured at the time", when a reader would wonder. */
  note: string | null
  date: AgedDate
  tierLabel: TierLabel
  from: 'quote' | 'order'
  imported: boolean
}

/**
 * "Last price for this item" for one supplier: their last quote or last ordered price for the SAME item (tier 0 or 1:
 * same model or same item; a same-brand or same-family price is not a price for this item). The stronger match wins,
 * then the newer date, then the quote. Shown at the rate of the day. Null when there is none.
 */
export function lastPriceChip(row: MemoryRow | null | undefined, today: string): LastPriceChip | null {
  if (!row) return null
  const cands: { from: 'quote' | 'order'; tier: number; on: string }[] = []
  if (row.last_quote_on && row.last_quote_tier != null && row.last_quote_tier <= 1) cands.push({ from: 'quote', tier: row.last_quote_tier, on: row.last_quote_on })
  if (row.last_ordered_on && row.last_ordered_price != null && row.last_ordered_tier != null && row.last_ordered_tier <= 1) {
    cands.push({ from: 'order', tier: row.last_ordered_tier, on: row.last_ordered_on })
  }
  if (cands.length === 0) return null
  cands.sort((a, b) => a.tier - b.tier || (a.on < b.on ? 1 : a.on > b.on ? -1 : 0) || (a.from === 'quote' ? -1 : 1))
  const best = cands[0]
  const fact = best.from === 'quote' ? lastQuoteFact(row, today) : lastOrderedFact(row, today)
  if (fact.state === 'none' || !fact.date) return null
  return {
    state: fact.state === 'hidden' ? 'hidden' : 'price',
    amount: fact.amount,
    pkr: fact.pkr,
    rate: fact.rate,
    note: fact.note,
    date: fact.date,
    tierLabel: tierLabelOf(best.tier) as TierLabel,
    from: best.from,
    imported: fact.imported,
  }
}
