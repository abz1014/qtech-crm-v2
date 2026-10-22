// A8 (R25, R26): the one module that composes the reason strings for ranked supplier quotes, the float suggestions and the
// memory card. Pure and framework-free. Nothing here ranks anything: rank_item_quotes() (the database) decides the order, and
// this module only says why, in plain words, from the columns it returned.
//
// Rules (BUILD_PLAN A8.2, DECISIONS 2026-10-16):
//  - There is no score. Every key behind the order is printed as a count out of a count ("on time 4 of 4 deliveries").
//  - Evidence cites the order number, the date we placed it and the days to delivery, in the words "delivered after N days".
//    There is no "Received" step on a leg: a leg goes Placed, then Delivered.
//  - A supplier with fewer than 3 deliveries is never called proven or often late: just the counts ("2 deliveries, both late").
//  - The selling price and the spread are for admin and sales only. They are composed only when `showSell` is true AND the row
//    carries them (the database returns NULL for an engineer, so an engineer's strings can never hold one).
//  - Prices that are an estimate (a conversion, a difference) are rounded to the nearest 100 PKR and carry the sign "≈".

import { formatAmount, formatRate } from '@/lib/money'
import { orderRef } from '@/lib/refs'
import type { MemoryRow } from '@/lib/memory'
import { daysBetween, parseDay } from '../dateText'

// ------------------------------------------------------------------------------------------------ input shapes

/** One row of rank_item_quotes(): a quote line of an RFQ item with its rank and the reasons behind it. */
export interface RankRow {
  rfq_item_id: string
  quote_line_id: string
  supplier_id: string
  item_qty: number | null
  price: number
  currency: string
  pkr_unit_price: number | null
  fx_state: 'same_currency' | 'fresh' | 'stale' | 'unusable' | 'none' | string
  fx_rate_pkr: number | null
  fx_rate_on: string | null
  fx_age_days: number | null
  comparable: boolean
  rank: number | null
  within_band: boolean | null
  pct_above_best: number | null
  /** Admin and sales only; null for an engineer. */
  sell_unit_net: number | null
  sell_source: 'quoted' | 'last_sold' | 'none' | string | null
  sell_order_number: number | null
  sell_on: string | null
  spread_unit: number | null
  spread_total: number | null
  /** 1 proven, 2 unproven, 3 often late. */
  reliability_band: number | null
  deliveries: number | null
  on_time: number | null
  late: number | null
  median_days_late: number | null
  orders_count: number | null
  orders_value_pkr: number | null
  last_order_number: number | null
  last_order_on: string | null
  last_order_delivered_after_days: number | null
  replied: number | null
  asked: number | null
  lead_time: string | null
  in_stock: boolean | null
}

/** The order evidence of supplier_item_memory(): the most recent order at the best tier with a leg for the supplier. */
export interface Evidence {
  /** 0 model, 1 item, 2 brand, 3 family. */
  tier: number
  orderNumber: number | null
  itemDesc: string | null
  qty: number | null
  placedOn: string | null
  expectedOn: string | null
  deliveredOn: string | null
  /** delivered - placed; null unless both exist. */
  deliveredAfterDays: number | null
  /** Legs with this supplier at that tier. */
  count: number | null
}

/** Names that make a brand-level or family-level evidence line readable. */
export interface EvidenceNames {
  brand?: string | null
  family?: string | null
}

// ------------------------------------------------------------------------------------------------ output shapes

export type ReasonIcon =
  | 'best'
  | 'gap'
  | 'band'
  | 'spread'
  | 'sell-none'
  | 'on-time'
  | 'late'
  | 'few'
  | 'none-yet'
  | 'history'
  | 'evidence'
  | 'rate'
  | 'unranked'

/** A piece of a reason. `num` marks a figure, a date or an order number (set in the mono face). */
export interface ReasonPart {
  text: string
  num?: boolean
}

export interface Reason {
  /** Stable key: price, band, rate, spread, sell, record, history, evidence, unranked. */
  id: string
  icon: ReasonIcon
  parts: ReasonPart[]
  /** The same words as one plain string. */
  text: string
  tone?: 'warn'
}

export interface ReasonSet {
  /** The one line shown under a collapsed row. */
  short: Reason[]
  /** The lines shown when the row is opened. */
  full: Reason[]
}

export interface ReasonContext {
  /** True for admin and sales. An engineer's strings never name a selling price or a spread. */
  showSell: boolean
  /** How many comparable lines of this item are inside the 2% band. The band line is only printed when it decided something (2 or more). */
  bandSize: number
  /** The order evidence for this supplier and item (supplier_item_memory), when it is loaded. */
  evidence?: Evidence | null
  names?: EvidenceNames
}

// ------------------------------------------------------------------------------------------------ small helpers

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "12 Mar 2026". */
export function dmy(iso: string | null | undefined): string {
  const p = parseDay(iso)
  return p ? `${p.d} ${MON[p.m - 1]} ${p.y}` : ''
}

const t = (text: string): ReasonPart => ({ text })
const n = (text: string): ReasonPart => ({ text, num: true })

function reason(id: string, icon: ReasonIcon, parts: ReasonPart[], tone?: 'warn'): Reason {
  return { id, icon, parts, text: parts.map(p => p.text).join(''), ...(tone ? { tone } : {}) }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** A PKR figure that is an estimate: nearest 100 from 1,000 up, nearest 10 below. */
export function approxPkr(value: number): string {
  const abs = Math.abs(value)
  const step = abs >= 1000 ? 100 : 10
  const r = Math.round(abs / step) * step
  return formatAmount(r, 'never')
}

/** "2.6M" from 100,000 up (one decimal); a rounded thousand figure below. */
export function pkrTotal(value: number): string {
  if (value >= 100_000) return `${(Math.round(value / 100_000) / 10).toFixed(1)}M`
  return formatAmount(Math.round(value / 1000) * 1000, 'never')
}

/** "1.3%": one decimal. */
export function pctText(pct: number): string {
  return `${(Math.round(pct * 10) / 10).toFixed(1)}%`
}

const times = (count: number) => `${count} ${count === 1 ? 'time' : 'times'}`

// ------------------------------------------------------------------------------------------------ evidence

/** The evidence columns of a supplier_item_memory() row, or null when the supplier has no order at any tier. */
export function evidenceOf(row: MemoryRow | null | undefined): Evidence | null {
  if (!row || row.evidence_tier === null || row.evidence_tier === undefined) return null
  return {
    tier: row.evidence_tier,
    orderNumber: row.evidence_order_number ?? null,
    itemDesc: row.evidence_item_desc ?? null,
    qty: row.evidence_qty ?? null,
    placedOn: row.evidence_placed_on ?? null,
    expectedOn: row.evidence_expected_on ?? null,
    deliveredOn: row.evidence_delivered_on ?? null,
    deliveredAfterDays: row.evidence_delivered_after_days ?? null,
    count: row.evidence_count_at_tier ?? null,
  }
}

/** Days from placed to expected, for "(expected 14)". Null unless both dates exist. */
export function expectedDays(ev: Pick<Evidence, 'placedOn' | 'expectedOn'>): number | null {
  return ev.placedOn && ev.expectedOn ? daysBetween(ev.placedOn, ev.expectedOn) : null
}

/** How the leg ended: delivered on time, late, or not delivered yet (and how far past expected it is). */
export function deliveryState(ev: Evidence, today?: string | null): { kind: 'on-time' | 'late' | 'waiting' | 'open'; daysLate: number | null; daysPast: number | null } {
  if (ev.deliveredOn) {
    const late = ev.expectedOn ? daysBetween(ev.expectedOn, ev.deliveredOn) : 0
    return { kind: late > 0 ? 'late' : 'on-time', daysLate: late > 0 ? late : null, daysPast: null }
  }
  const past = today && ev.expectedOn ? daysBetween(ev.expectedOn, today) : 0
  return { kind: past > 0 ? 'waiting' : 'open', daysLate: null, daysPast: past > 0 ? past : null }
}

/**
 * The evidence line, in the owner's words: the order number, the date we placed it and the days to delivery.
 *   tier 0, 1  "Ordered Siemens SITRANS P320 ×4 for ORD-0031, placed 12 Mar 2026, delivered after 19 days (expected 14)"
 *   tier 2, 3  "Ordered in Flow meters 3 times; last for ORD-0027, placed 3 Feb 2026, delivered after 9 days"
 *   not yet    "..., placed 1 Nov 2026, not delivered yet"
 */
export function evidenceReason(ev: Evidence, names: EvidenceNames = {}): Reason {
  const ref = ev.orderNumber !== null ? orderRef(ev.orderNumber) : 'an order'
  const parts: ReasonPart[] = []
  if (ev.tier <= 1) {
    const what = ev.itemDesc?.trim() || 'this item'
    parts.push(t(`Ordered ${what}`))
    if (ev.qty !== null) parts.push(t(' ×'), n(formatAmount(ev.qty, 'auto')))
    parts.push(t(' for '), n(ref))
  } else {
    const scope = ev.tier === 2 ? (names.brand?.trim() ? names.brand.trim() : 'this brand') : names.family?.trim() ? `in ${names.family.trim()}` : 'in this family'
    parts.push(t(`Ordered ${scope} `), n(times(ev.count ?? 1)), t('; last for '), n(ref))
  }
  if (ev.placedOn) parts.push(t(', placed '), n(dmy(ev.placedOn)))
  if (ev.deliveredAfterDays !== null) {
    parts.push(t(', delivered after '), n(plural(ev.deliveredAfterDays, 'day', 'days')))
    const exp = ev.tier <= 1 ? expectedDays(ev) : null
    if (exp !== null) parts.push(t(' (expected '), n(String(exp)), t(')'))
  } else if (ev.deliveredOn) {
    parts.push(t(', delivered '), n(dmy(ev.deliveredOn)))
  } else {
    parts.push(t(', not delivered yet'))
  }
  return reason('evidence', 'evidence', parts)
}

// ------------------------------------------------------------------------------------------------ delivery record

/** "on time 5 of 6 deliveries", "no deliveries yet", "too few to judge": the counts the record stands on. */
export interface RecordFacts {
  deliveries: number
  onTime: number
  late: number
  medianDaysLate: number | null
}

/** 1 proven (3 or more deliveries, on time at least 2/3), 2 unproven (fewer than 3), 3 often late. The same bands as the database. */
export function reliabilityBand(f: Pick<RecordFacts, 'deliveries' | 'onTime'>): 1 | 2 | 3 {
  if (f.deliveries < 3) return 2
  return f.onTime * 3 >= f.deliveries * 2 ? 1 : 3
}

/**
 * Fewer than 3 deliveries, in plain words (owner audit N4): "1 delivery, late", "2 deliveries, both late", "2 deliveries, 1 on
 * time", "2 deliveries, both on time". The number of deliveries is the leading count; this is the rest of the line.
 */
function fewRest(f: RecordFacts): string {
  const word = f.deliveries === 1 ? 'delivery' : 'deliveries'
  const all = f.deliveries === 1 ? '' : f.deliveries === 2 ? 'both ' : 'all '
  if (f.onTime >= f.deliveries) return `${word}, ${all}on time`
  if (f.onTime <= 0) return `${word}, ${all}late`
  return `${word}, ${f.onTime} on time`
}

/** The delivery record line. `long` is the opened-row wording; the short one fits a collapsed row. */
export function recordReason(f: RecordFacts, long: boolean): Reason {
  if (f.deliveries <= 0) return reason('record', 'none-yet', [t('No deliveries yet')])
  const band = reliabilityBand(f)
  if (band === 1) return reason('record', 'on-time', [t('On time '), n(String(f.onTime)), t(' of '), n(String(f.deliveries)), t(' deliveries')])
  if (band === 3) {
    const parts = [t('Often late: on time '), n(String(f.onTime)), t(' of '), n(String(f.deliveries))]
    if (long) parts.push(t(' deliveries'))
    if (long && f.medianDaysLate !== null) parts.push(t(' · late ones median '), n(String(Math.round(f.medianDaysLate))), t(' days'))
    return reason('record', 'late', parts, 'warn')
  }
  return long
    ? reason('record', 'few', [n(String(f.deliveries)), t(` ${fewRest(f)} (too few to judge)`)])
    : reason('record', 'few', [n(String(f.deliveries)), t(` ${fewRest(f)}`)])
}

/** For the float suggestions and the memory line: the same record line from v_supplier_stats columns. Null when nothing was asked. */
export function recordFromStats(s: { deliveries?: number | null; late?: number | null; median_days_late?: number | null } | null | undefined): Reason | null {
  const deliveries = s?.deliveries ?? 0
  if (deliveries <= 0) return null
  const late = Math.min(s?.late ?? 0, deliveries)
  return recordReason({ deliveries, onTime: deliveries - late, late, medianDaysLate: s?.median_days_late ?? null }, false)
}

// ------------------------------------------------------------------------------------------------ the ranked row

/** The compared figure of a row and its unit: PKR when there is a PKR price, else the quote's own currency (an item with no rate). */
function basis(row: RankRow): { value: number; pkr: boolean } {
  return row.pkr_unit_price !== null ? { value: row.pkr_unit_price, pkr: true } : { value: row.price, pkr: false }
}

function gapReason(row: RankRow): Reason {
  const pct = row.pct_above_best ?? 0
  const b = basis(row)
  const best = b.value / (1 + pct / 100)
  const diff = b.value - best
  const amount = b.pkr ? `≈ PKR ${approxPkr(diff)}` : `${row.currency} ${formatAmount(Math.round(diff * 100) / 100, 'auto')}`
  return reason('price', 'gap', [t(amount + ' each above the best ('), n(pctText(pct)), t(')')])
}

function bestReason(row: RankRow, long: boolean): Reason {
  if (!long) return reason('price', 'best', [t('Best price')])
  const b = basis(row)
  if (!b.pkr) return reason('price', 'best', [t(`Best price: ${row.currency} ${formatAmount(row.price, 'auto')} each, every quote is in ${row.currency}`)])
  if (row.currency === 'PKR' || row.fx_rate_pkr === null) return reason('price', 'best', [t('Best price: PKR '), n(formatAmount(row.price, 'auto')), t(' each')])
  const age = row.fx_age_days ?? 0
  const when = age === 0 ? 'today' : `${plural(age, 'day', 'days')} old`
  return reason('price', 'best', [
    t(`Best price: ≈ PKR ${approxPkr(b.value)} each (${row.currency} ${formatAmount(row.price, 'auto')} at ${formatRate(row.fx_rate_pkr)}, ${when})`),
  ])
}

function spreadReason(row: RankRow, long: boolean): Reason | null {
  if (row.spread_unit === null) return null
  const neg = row.spread_unit < 0
  const each = `${neg ? '−' : ''}PKR ${approxPkr(row.spread_unit)}`
  if (!long) return reason('spread', 'spread', [t(`Spread ≈ ${each} each`)], neg ? 'warn' : undefined)
  const total = row.spread_total !== null && (row.item_qty ?? 1) !== 1 ? `, ${neg ? '−' : ''}PKR ${approxPkr(row.spread_total)} for ${formatAmount(row.item_qty ?? 1, 'auto')}` : ''
  let against = ''
  if (row.sell_unit_net !== null) {
    const price = `PKR ${formatAmount(row.sell_unit_net, 'auto')}`
    against = row.sell_source === 'last_sold' ? `, against the last price we sold, ${price}${row.sell_order_number !== null ? ` (${orderRef(row.sell_order_number)}${row.sell_on ? `, ${dmy(row.sell_on)}` : ''})` : ''}` : `, against our quoted ${price}`
  }
  const tail = neg ? '. The supplier price is above our selling price. Before freight and duty.' : '. Supplier price only, before freight and duty.'
  return reason('spread', 'spread', [t(`Spread ≈ ${each} each${total}${against}${tail}`)], neg ? 'warn' : undefined)
}

function rateReason(row: RankRow): Reason | null {
  if (row.fx_state !== 'stale' || row.fx_age_days === null) return null
  return reason('rate', 'rate', [t('Rate '), n(plural(row.fx_age_days, 'day', 'days')), t(' old')], 'warn')
}

function historyReason(row: RankRow): Reason | null {
  const count = row.orders_count ?? 0
  if (count <= 0) return null
  const parts: ReasonPart[] = [t('Ordered from '), n(times(count))]
  if (row.last_order_number !== null) {
    parts.push(t(', last '), n(orderRef(row.last_order_number)))
    if (row.last_order_on) parts.push(t(' on '), n(dmy(row.last_order_on)))
  }
  if (row.orders_value_pkr !== null && row.orders_value_pkr > 0) parts.push(t(' · ≈ PKR '), n(pkrTotal(row.orders_value_pkr)), t(' in total'))
  return reason('history', 'history', parts)
}

/** Why a line is not ranked: the rate is missing or too old. The currency is named so the person knows which rate to add. */
export function unrankedReason(row: RankRow): Reason {
  if (row.fx_state === 'unusable') {
    const age = row.fx_age_days
    return reason('unranked', 'unranked', [t(`Not ranked: the ${row.currency} rate is ${age !== null ? `${plural(age, 'day', 'days')} old` : 'too old'}. Add a current one.`)])
  }
  return reason('unranked', 'unranked', [t(`Not ranked: no current ${row.currency} rate. Add one.`)])
}

export function recordFacts(row: RankRow): RecordFacts {
  const deliveries = row.deliveries ?? 0
  const late = row.late ?? 0
  return { deliveries, onTime: row.on_time ?? Math.max(0, deliveries - late), late, medianDaysLate: row.median_days_late ?? null }
}

/**
 * The reasons for one ranked row, as in g2-ranking-split: the collapsed one-liner and the opened list.
 * Order of the opened list: price gap or best price, the 2% band, a stale rate, the spread (or why there is none), the delivery
 * record, the order history, the order evidence.
 */
export function reasonsFor(row: RankRow, ctx: ReasonContext): ReasonSet {
  const record = recordReason(recordFacts(row), false)
  const recordLong = recordReason(recordFacts(row), true)
  const history = historyReason(row)
  const evidence = ctx.evidence
    ? evidenceReason(ctx.evidence, ctx.names)
    : row.last_order_number !== null && row.last_order_on
      ? reason('evidence', 'evidence', [
          t('Last order '),
          n(orderRef(row.last_order_number)),
          t(', placed '),
          n(dmy(row.last_order_on)),
          ...(row.last_order_delivered_after_days !== null ? [t(', delivered after '), n(plural(row.last_order_delivered_after_days, 'day', 'days'))] : [t(', not delivered yet')]),
        ])
      : null

  if (!row.comparable || row.rank === null) {
    const un = unrankedReason(row)
    return { short: [un, record], full: [un, recordLong, ...(history ? [history] : []), ...(evidence ? [evidence] : [])] }
  }

  const best = (row.pct_above_best ?? 0) <= 0
  const band = ctx.bandSize >= 2 && row.within_band === true
  const bandShort = reason('band', 'band', [t('Within 2% of the best: by delivery record')])
  const bandLong = reason('band', 'band', [t('Within 2% of the best price: ordered by delivery record')])
  const rate = rateReason(row)
  const sellOn = ctx.showSell
  const spreadShort = sellOn ? spreadReason(row, false) : null
  const spreadLong = sellOn ? spreadReason(row, true) : null
  const noSell = sellOn && row.sell_source === 'none' ? reason('sell', 'sell-none', [t('No selling price yet: ranked by supplier price')]) : null

  const short = [best ? bestReason(row, false) : gapReason(row), ...(band ? [bandShort] : []), record, ...(rate ? [rate] : []), ...(spreadShort ? [spreadShort] : [])]
  const full = [
    best ? bestReason(row, true) : gapReason(row),
    ...(band ? [bandLong] : []),
    ...(rate ? [rate] : []),
    ...(spreadLong ? [spreadLong] : noSell ? [noSell] : []),
    recordLong,
    ...(history ? [history] : []),
    ...(evidence ? [evidence] : []),
  ]
  return { short, full }
}

/**
 * The "Cheapest: X. Y is only 1.2% dearer and ..." line, in the words of the tie-breaker rank_item_quotes really used (0049): inside
 * the 2% band the better delivery record (reliability_band, lower is better) wins, then more orders with us, then the more recent
 * order, then the price. `recommended` is rank 1; `cheapest` is the lowest PKR price of the item.
 */
export function whyNotCheapest(
  recommended: Pick<RankRow, 'pct_above_best' | 'reliability_band' | 'orders_count' | 'last_order_on'>,
  cheapest: Pick<RankRow, 'reliability_band' | 'orders_count' | 'last_order_on'>,
): string {
  const pct = recommended.pct_above_best ?? 0
  const gap = Math.round(pct * 10) / 10 > 0 ? `is only ${pctText(pct)} dearer` : 'costs about the same'
  const band = (r: Pick<RankRow, 'reliability_band'>) => r.reliability_band ?? 2
  const orders = (r: Pick<RankRow, 'orders_count'>) => r.orders_count ?? 0
  let why: string
  if (band(recommended) < band(cheapest)) why = 'has the better delivery record'
  else if (band(recommended) === band(cheapest) && orders(recommended) > orders(cheapest)) {
    const n = orders(recommended)
    why = `has the same delivery record and more orders with us (${n} to ${orders(cheapest)})`
  } else if (band(recommended) === band(cheapest) && orders(recommended) === orders(cheapest) && (recommended.last_order_on ?? '') > (cheapest.last_order_on ?? '')) {
    why = `has the same delivery record and order count, and we ordered from them more recently (${dmy(recommended.last_order_on)})`
  } else why = 'is within 2% of it'
  return `${gap} and ${why}`
}

/** How many comparable lines of one item sit inside the 2% band (the band line is only worth printing from 2). */
export function bandSizeOf(rows: readonly Pick<RankRow, 'comparable' | 'within_band'>[]): number {
  return rows.filter(r => r.comparable && r.within_band === true).length
}

/**
 * What we would sell the item for, on the item's line (admin and sales only). Null for an engineer, whatever the rows hold.
 * "Selling price PKR 612,000 each, quoted", "..., last sold on ORD-0027", or "No selling price yet".
 */
export function sellNote(rows: readonly RankRow[], showSell: boolean): { kind: 'quoted' | 'last_sold' | 'none'; text: string; amount: string | null } | null {
  if (!showSell) return null
  const r = rows.find(x => x.sell_unit_net !== null)
  if (!r || r.sell_unit_net === null) return { kind: 'none', text: 'No selling price yet', amount: null }
  const amount = `PKR ${formatAmount(r.sell_unit_net, 'auto')}`
  if (r.sell_source === 'last_sold') return { kind: 'last_sold', amount, text: `each, last sold${r.sell_order_number !== null ? ` on ${orderRef(r.sell_order_number)}` : ''}` }
  return { kind: 'quoted', amount, text: 'each, quoted' }
}

// ------------------------------------------------------------------------------------------------ the memory card's evidence block

/** One order row of the evidence block. */
export interface EvidenceOrderRow {
  ref: string
  /** "Siemens SITRANS P320 ×4". */
  what: string
  /** "placed 12 Mar 2026 · expected 26 Mar 2026". */
  when: string
  /** "delivered after 19 days" or "not delivered yet". */
  result: string
  /** "expected in 14 · late", "expected in 14 · on time", "5 days past expected", or null. */
  detail: string | null
  tone: 'late' | 'wait' | null
}

export interface EvidenceBlock {
  /** "Recent orders of this item from Metro Process Controls" or "Ordered in Pressure transmitters, 3 times". */
  title: string
  /** "3 of 4": the orders shown out of the legs at this tier. Null when the count is unknown. */
  countText: string | null
  /** The newest order at the best tier. Same as orders[0]. */
  order: EvidenceOrderRow
  /** Up to three recent orders at the best tier, newest first (supplier_item_evidence). */
  orders: EvidenceOrderRow[]
  /** Counts out of counts from v_supplier_stats. */
  counts: { label: string; value: string; tone?: 'late' }[]
  /** The same evidence as the one sentence the float list and the RFQ rows print. */
  line: string
}

function orderRow(ev: Evidence, today: string): EvidenceOrderRow {
  const ref = ev.orderNumber !== null ? orderRef(ev.orderNumber) : 'Order'
  const state = deliveryState(ev, today)
  const exp = expectedDays(ev)
  const what = ev.tier <= 1 ? `${ev.itemDesc?.trim() || 'This item'}${ev.qty !== null ? ` ×${formatAmount(ev.qty, 'auto')}` : ''}` : ev.itemDesc?.trim() || 'Order'
  const whenParts = [ev.placedOn ? `placed ${dmy(ev.placedOn)}` : null, ev.expectedOn ? `expected ${dmy(ev.expectedOn)}` : null].filter(Boolean)
  const result = ev.deliveredAfterDays !== null ? `delivered after ${plural(ev.deliveredAfterDays, 'day', 'days')}` : ev.deliveredOn ? `delivered ${dmy(ev.deliveredOn)}` : 'not delivered yet'
  let detail: string | null = null
  if (state.kind === 'on-time') detail = exp !== null ? `expected in ${exp} · on time` : 'on time'
  else if (state.kind === 'late') detail = exp !== null ? `expected in ${exp} · late` : 'late'
  else if (state.kind === 'waiting') detail = `${plural(state.daysPast ?? 0, 'day', 'days')} past expected`
  return { ref, what, when: whenParts.join(' · '), result, detail, tone: state.kind === 'late' ? 'late' : state.kind === 'waiting' ? 'wait' : null }
}

/** The rows of supplier_item_evidence() for one supplier as Evidence, newest first. */
export interface EvidenceFeedRow {
  evidence_rank?: number | null
  tier: number
  order_number?: number | null
  item_desc?: string | null
  qty?: number | null
  placed_on?: string | null
  expected_on?: string | null
  delivered_on?: string | null
  delivered_after_days?: number | null
  count_at_tier?: number | null
}

export function evidenceFromFeed(rows: readonly EvidenceFeedRow[] | null | undefined): Evidence[] {
  return [...(rows ?? [])]
    .sort((a, b) => (a.evidence_rank ?? 0) - (b.evidence_rank ?? 0))
    .map(r => ({
      tier: r.tier,
      orderNumber: r.order_number ?? null,
      itemDesc: r.item_desc ?? null,
      qty: r.qty ?? null,
      placedOn: r.placed_on ?? null,
      expectedOn: r.expected_on ?? null,
      deliveredOn: r.delivered_on ?? null,
      deliveredAfterDays: r.delivered_after_days ?? null,
      count: r.count_at_tier ?? null,
    }))
}

/**
 * The evidence block of the memory card: up to three recent orders at the best tier, then the supplier's delivery counts.
 * `ev` is the newest order (supplier_item_memory); `more` is the full list from supplier_item_evidence (it starts with the same
 * order). With no list the block shows the one order, as before.
 */
export function evidenceBlock(
  ev: Evidence,
  names: EvidenceNames & { supplier: string },
  stats: { deliveries?: number | null; late?: number | null; median_days_late?: number | null; orders_count?: number | null } | null | undefined,
  today: string,
  more?: readonly Evidence[] | null,
): EvidenceBlock {
  const list = more && more.length > 0 ? more.slice(0, 3) : [ev]
  const rows = list.map(e => orderRow(e, today))
  const ref = ev.orderNumber !== null ? orderRef(ev.orderNumber) : 'Order'
  const title =
    ev.tier <= 1
      ? `${rows.length > 1 ? 'Recent orders' : 'Latest order'} of this item from ${names.supplier}`
      : ev.tier === 2
        ? `Ordered ${names.brand?.trim() || 'this brand'}, ${times(ev.count ?? 1)}`
        : `Ordered in ${names.family?.trim() || 'this family'}, ${times(ev.count ?? 1)}`
  const deliveries = stats?.deliveries ?? 0
  const late = Math.min(stats?.late ?? 0, deliveries)
  const counts: EvidenceBlock['counts'] = []
  if (deliveries > 0) {
    counts.push({ label: 'Deliveries', value: String(deliveries) })
    counts.push({ label: 'On time', value: `${deliveries - late} of ${deliveries}` })
    counts.push({ label: 'Late', value: `${late} of ${deliveries}`, tone: late > 0 && reliabilityBand({ deliveries, onTime: deliveries - late }) === 3 ? 'late' : undefined })
    if (stats?.median_days_late != null) counts.push({ label: 'Late ones', value: `median ${Math.round(stats.median_days_late)} days`, tone: 'late' })
  }
  const ordered = stats?.orders_count ?? 0
  if (ordered > 0) counts.push({ label: 'Ordered from', value: times(ordered) })
  if (ev.orderNumber !== null) counts.push({ label: 'Last order', value: `${ref}${ev.placedOn ? ` · ${dmy(ev.placedOn)}` : ''}` })
  return {
    title,
    countText: ev.count !== null && ev.count > 0 ? `${Math.min(rows.length, ev.count)} of ${ev.count}` : null,
    order: rows[0],
    orders: rows,
    counts,
    line: evidenceReason(ev, names).text,
  }
}
