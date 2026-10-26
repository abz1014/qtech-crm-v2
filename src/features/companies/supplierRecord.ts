import { agedDate, priceFactOf, type PriceFact } from '@/lib/memory'
import { poRef, orderRef, rfqRef } from '@/lib/refs'
import { formatShortDate } from '@/lib/formatDay'
import { daysLate, daysOverdue } from '@/lib/timeWords'
import { reasonLabel } from '@/features/rfqs/lib/cantQuote'

/*
 * What the company page's supplier panels say (R18; g2-company.html): recent quotes, deliveries, "Open with them" and what
 * the last contact was. One pure function over rows the API already fetched, so every rule (thresholds, "at the time",
 * legacy marks) is tested without a database. Facts with counts; nothing is scored, ranked or ordered by how well a
 * supplier has done.
 */

// ------------------------------------------------------------------------------------------------ raw rows (api.ts normalises to these)

export interface RawInquiry {
  id: string
  rfqId: string
  sentOn: string | null
  lastChasedOn: string | null
  chaseCount: number
  noOfferOn: string | null
  noOfferReason: string | null
  legacy: boolean
}
export interface RawLine {
  id: string
  inquiryId: string
  itemId: string
  unitPrice: number
  currency: string
  leadTime: string | null
  fxRatePkr: number | null
  fxRateOn: string | null
  /** The business-timezone date the line was entered (created_at). For an imported line this is the import day. */
  enteredOn: string
  hidden: boolean
  legacy: boolean
}
export interface RawItem {
  id: string
  rfqId: string
  position: number
  description: string
  qty: number
  unit: string | null
  brandName: string | null
}
export interface RawRfq {
  id: string
  number: number
  closedOn: string | null
}
/** An order line that came from an RFQ item: which order, and whose leg it is on. */
export interface RawOrderItem {
  itemId: string
  orderNumber: number
  cancelled: boolean
  supplierId: string | null
}
export interface RawLeg {
  id: string
  orderNumber: number
  cancelled: boolean
  placedOn: string | null
  expectedOn: string | null
  receivedOn: string | null
  legacy: boolean
  currency: string | null
  po: { number: number; revision: number; issuedOn: string } | null
}
export interface SupplierRecordRaw {
  supplierId: string
  inquiries: RawInquiry[]
  lines: RawLine[]
  items: RawItem[]
  rfqs: RawRfq[]
  orderItems: RawOrderItem[]
  legs: RawLeg[]
}

// ------------------------------------------------------------------------------------------------ output

export type QuoteOutcome = 'quoted' | 'ordered-here' | 'ordered-elsewhere' | 'not-ordered' | 'quoted-open' | 'waiting' | 'no-reply' | 'declined'

export interface QuoteRow {
  key: string
  /** The enquiry this row answers (or is still waiting on): the merged Enquiries list takes its reply time from it. */
  inquiryId: string
  /** Sorting date, YYYY-MM-DD. */
  date: string
  dateText: string
  /** "19 months ago", only past 18 months. */
  ago: string | null
  rfqId: string
  rfqRef: string
  item: string
  qty: string | null
  brand: string | null
  /** An enquiry with no price has the empty fact. */
  price: PriceFact
  leadTime: string | null
  outcome: QuoteOutcome
  /** "ORD-0038" when the item was ordered on a leg with them. */
  orderRef: string | null
  /** Small print under the item: "Asked 24 Nov, 3 days ago" (an enquiry still waiting). */
  itemNote: string | null
  /** What the PKR column says when there is no price: "Awaiting a quote", "Asked 2 Jun, never answered", the reason it was declined. */
  pkrNote: string | null
  imported: boolean
}

/** An imported purchase-order leg past its date that was never marked delivered: not known to be late. */
export const IMPORTED_NOT_DELIVERED = 'Imported, not marked delivered'

export type DeliveryResult =
  | { kind: 'ontime'; days: number; text: string }
  | { kind: 'late'; days: number; text: string }
  | { kind: 'overdue'; days: number; text: string }
  | { kind: 'expected'; days: number; text: string }
  | { kind: 'imported'; days: number; text: string }
  | { kind: 'undated'; days: number; text: string }

export interface DeliveryRow {
  key: string
  po: string | null
  orderRef: string
  expectedOn: string | null
  receivedOn: string | null
  /** Imported dates are estimates. */
  estimated: boolean
  result: DeliveryResult
}

export interface OpenWithThem {
  enquiries: { inquiryId: string; rfqId: string; rfqRef: string; waitingDays: number }[]
  legs: { legId: string; orderRef: string; text: string }[]
  /** The currency they last quoted in, else the one on their last leg. */
  currency: string | null
}

export type LastContactPart = string | { rfqId: string; ref: string }

export interface SupplierRecord {
  quotes: QuoteRow[]
  /** Every row fetched (the newest 60 enquiries), for "Show all" on the Enquiries list. */
  allQuotes: QuoteRow[]
  quoteCount: number
  deliveries: DeliveryRow[]
  deliveryCount: number
  open: OpenWithThem
  /** What the last contact was, as a sentence in pieces so an RFQ reference can be a link ("Enquiry asked for RFQ-0171. No reply yet."). */
  lastContact: LastContactPart[] | null
  /** One unit per delivery with both dates, for the squares: imported on-time ones are drawn dashed ("dates estimated"). */
  deliveryUnits: { ontime: number; late: number; estimatedOntime: number }
  /** First and last dates in what was fetched, for the imported-only footnote ("Jan 2024 to Sep 2026"). */
  span: { from: string; to: string } | null
}

// ------------------------------------------------------------------------------------------------ helpers

const day = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN
}
export const daysBetween = (from: string, to: string): number => Math.round((day(to) - day(from)) / 86_400_000)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const NONE_PRICE = priceFactOf({ on: null, price: null, currency: null, rate: null, rateOn: null, pkr: null }, '2000-01-01')

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
const qtyOf = (qty: number, unit: string | null) => (qty ? `${qty}${unit ? ` ${unit}` : ''}` : null)

export const QUOTE_ROWS_SHOWN = 10
export const DELIVERY_ROWS_SHOWN = 8

// ------------------------------------------------------------------------------------------------ the builder

export function buildSupplierRecord(raw: SupplierRecordRaw, today: string): SupplierRecord {
  const inqById = new Map(raw.inquiries.map(i => [i.id, i]))
  const itemById = new Map(raw.items.map(i => [i.id, i]))
  const rfqById = new Map(raw.rfqs.map(r => [r.id, r]))
  const itemsOfRfq = new Map<string, RawItem[]>()
  for (const it of raw.items) itemsOfRfq.set(it.rfqId, [...(itemsOfRfq.get(it.rfqId) ?? []), it].sort((a, b) => a.position - b.position))
  const linesByInquiry = new Map<string, RawLine[]>()
  for (const l of raw.lines) linesByInquiry.set(l.inquiryId, [...(linesByInquiry.get(l.inquiryId) ?? []), l])
  const ordersOfItem = new Map<string, RawOrderItem[]>()
  for (const o of raw.orderItems) if (!o.cancelled) ordersOfItem.set(o.itemId, [...(ordersOfItem.get(o.itemId) ?? []), o])

  const ref = (rfqId: string) => {
    const r = rfqById.get(rfqId)
    return r ? rfqRef(r.number) : 'RFQ'
  }

  // ---- recent quotes: a row per quote line, and a row per sent enquiry that has none
  const rows: QuoteRow[] = []
  for (const l of raw.lines) {
    const inq = inqById.get(l.inquiryId)
    const it = itemById.get(l.itemId)
    if (!inq || !it) continue
    const date = l.legacy ? (inq.sentOn ?? l.enteredOn) : l.enteredOn
    const orders = ordersOfItem.get(l.itemId) ?? []
    const here = orders.filter(o => o.supplierId === raw.supplierId).sort((a, b) => b.orderNumber - a.orderNumber)[0]
    rows.push({
      key: `q-${l.id}`,
      inquiryId: inq.id,
      date,
      dateText: l.legacy ? monthYear(date) : formatShortDate(date, today),
      ago: agedDate(date, today).ago,
      rfqId: it.rfqId,
      rfqRef: ref(it.rfqId),
      item: it.description,
      qty: qtyOf(it.qty, it.unit),
      brand: it.brandName,
      price: priceFactOf(
        {
          on: date,
          price: l.unitPrice,
          currency: l.currency,
          hidden: l.hidden,
          rate: l.fxRatePkr,
          rateOn: l.fxRateOn,
          pkr: l.fxRatePkr !== null ? Math.round(l.unitPrice * l.fxRatePkr * 100) / 100 : null,
          imported: l.legacy,
        },
        today,
      ),
      leadTime: l.leadTime && l.leadTime.trim() ? l.leadTime.trim() : null,
      outcome: here ? 'ordered-here' : orders.length > 0 ? 'ordered-elsewhere' : rfqById.get(it.rfqId)?.closedOn ? 'not-ordered' : 'quoted-open',
      orderRef: here ? orderRef(here.orderNumber) : null,
      itemNote: null,
      pkrNote: null,
      imported: l.legacy,
    })
  }
  for (const inq of raw.inquiries) {
    if (!inq.sentOn || (linesByInquiry.get(inq.id)?.length ?? 0) > 0) continue
    const items = itemsOfRfq.get(inq.rfqId) ?? []
    const first = items[0]
    const waited = daysBetween(inq.sentOn, today)
    const outcome: QuoteOutcome = inq.noOfferOn ? 'declined' : waited >= 7 ? 'no-reply' : 'waiting'
    rows.push({
      key: `i-${inq.id}`,
      inquiryId: inq.id,
      date: inq.sentOn,
      dateText: inq.legacy ? monthYear(inq.sentOn) : formatShortDate(inq.sentOn, today),
      ago: agedDate(inq.sentOn, today).ago,
      rfqId: inq.rfqId,
      rfqRef: ref(inq.rfqId),
      item: first ? first.description : 'Items on this RFQ',
      qty: items.length > 1 ? `+ ${plural(items.length - 1, 'more item')}` : first ? qtyOf(first.qty, first.unit) : null,
      brand: first?.brandName ?? null,
      price: NONE_PRICE,
      leadTime: null,
      outcome,
      orderRef: null,
      itemNote: outcome === 'waiting' ? `Asked ${formatShortDate(inq.sentOn, today)}, ${plural(waited, 'day')} ago` : null,
      pkrNote:
        outcome === 'declined'
          ? inq.noOfferReason
            ? reasonLabel(inq.noOfferReason)
            : 'No reason given'
          : outcome === 'no-reply'
            ? `Asked ${formatShortDate(inq.sentOn, today)}, ${inq.chaseCount > 0 ? `chased ${inq.chaseCount === 1 ? 'once' : `${inq.chaseCount} times`}, ` : ''}never answered`
            : 'Awaiting a quote',
      imported: inq.legacy,
    })
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key < b.key ? -1 : 1))

  // ---- deliveries: legs with an expected or a delivered date (a leg goes Placed, then Delivered; received_on follows delivered_on)
  const legRows: { row: DeliveryRow; sort: string }[] = []
  for (const leg of raw.legs) {
    if (leg.cancelled || (!leg.expectedOn && !leg.receivedOn)) continue
    let result: DeliveryResult
    if (leg.expectedOn && leg.receivedOn) {
      const d = daysBetween(leg.expectedOn, leg.receivedOn)
      result = d > 0 ? { kind: 'late', days: d, text: `Delivered ${daysLate(d)}` } : { kind: 'ontime', days: Math.max(0, -d), text: 'On time' }
    } else if (leg.expectedOn) {
      const over = daysBetween(leg.expectedOn, today)
      // an imported leg past its date was probably delivered and never marked: no day count, neutral (owner decision 1b)
      result = leg.legacy && over > 0 ? { kind: 'imported', days: 0, text: IMPORTED_NOT_DELIVERED } : over > 0 ? { kind: 'overdue', days: over, text: daysOverdue(over) } : { kind: 'expected', days: Math.max(0, -over), text: 'Not delivered yet' }
    } else {
      result = { kind: 'undated', days: 0, text: 'No expected date' }
    }
    legRows.push({
      row: {
        key: leg.id,
        po: leg.po ? `${poRef(leg.po.number, leg.po.issuedOn)}${leg.po.revision > 0 ? ` · R${leg.po.revision}` : ''}` : null,
        orderRef: orderRef(leg.orderNumber),
        expectedOn: leg.expectedOn,
        receivedOn: leg.receivedOn,
        estimated: leg.legacy,
        result,
      },
      sort: leg.receivedOn ?? leg.expectedOn ?? '',
    })
  }
  legRows.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0))

  // ---- open with them
  const waiting = raw.inquiries
    .filter(i => i.sentOn && !i.noOfferOn && (linesByInquiry.get(i.id)?.length ?? 0) === 0 && !rfqById.get(i.rfqId)?.closedOn)
    .sort((a, b) => ((a.sentOn as string) < (b.sentOn as string) ? 1 : -1))
    .map(i => ({ inquiryId: i.id, rfqId: i.rfqId, rfqRef: ref(i.rfqId), waitingDays: Math.max(0, daysBetween(i.sentOn as string, today)) }))
  const openLegs = raw.legs
    .filter(l => !l.cancelled && !l.receivedOn)
    .sort((a, b) => b.orderNumber - a.orderNumber)
    .map(l => {
      const late = l.expectedOn ? daysBetween(l.expectedOn, today) : 0
      return {
        legId: l.id,
        orderRef: orderRef(l.orderNumber),
        text: l.expectedOn
          ? late > 0 && l.legacy
            ? `expected ${formatShortDate(l.expectedOn, today)}, ${IMPORTED_NOT_DELIVERED.toLowerCase()}`
            : late > 0
            ? `expected ${formatShortDate(l.expectedOn, today)}, ${plural(late, 'day')} late`
            : `expected ${formatShortDate(l.expectedOn, today)}`
          : l.placedOn
            ? `placed ${formatShortDate(l.placedOn, today)}`
            : 'not placed yet',
      }
    })
  const lastLine = [...raw.lines].filter(l => !l.hidden).sort((a, b) => (a.enteredOn < b.enteredOn ? 1 : -1))[0]
  const lastLeg = raw.legs.find(l => l.currency)
  const currency = lastLine?.currency ?? lastLeg?.currency ?? null

  // ---- what the last contact was
  const events: { on: string; parts: LastContactPart[] }[] = []
  for (const i of raw.inquiries) {
    if (i.sentOn) {
      const replied = (linesByInquiry.get(i.id)?.length ?? 0) > 0 || Boolean(i.noOfferOn)
      const tail =
        i.chaseCount > 0 && i.lastChasedOn
          ? ` Chased ${i.chaseCount === 1 ? 'once' : i.chaseCount === 2 ? 'twice' : `${i.chaseCount} times`} on ${formatShortDate(i.lastChasedOn, today)}.`
          : replied
            ? ''
            : ' No reply yet.'
      events.push({ on: i.lastChasedOn && i.lastChasedOn > i.sentOn ? i.lastChasedOn : i.sentOn, parts: ['Enquiry asked for ', { rfqId: i.rfqId, ref: ref(i.rfqId) }, `.${tail}`] })
    }
  }
  for (const l of raw.legs) {
    if (l.po) events.push({ on: l.po.issuedOn, parts: [`${poRef(l.po.number, l.po.issuedOn)} issued for ${orderRef(l.orderNumber)}.`] })
    else if (l.placedOn ?? l.expectedOn) events.push({ on: (l.placedOn ?? l.expectedOn) as string, parts: [`Supplier order for ${orderRef(l.orderNumber)}.${l.legacy ? ' Imported.' : ''}`] })
  }
  events.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0))

  // ---- delivery squares and the span of what we hold
  const units = { ontime: 0, late: 0, estimatedOntime: 0 }
  for (const leg of raw.legs) {
    if (leg.cancelled || !leg.expectedOn || !leg.receivedOn) continue
    if (daysBetween(leg.expectedOn, leg.receivedOn) > 0) units.late += 1
    else if (leg.legacy) units.estimatedOntime += 1
    else units.ontime += 1
  }
  const allDates = [
    ...raw.inquiries.map(i => i.sentOn),
    ...raw.legs.flatMap(l => [l.placedOn, l.expectedOn, l.receivedOn]),
  ].filter((d): d is string => Boolean(d))
  allDates.sort()

  return {
    quotes: rows.slice(0, QUOTE_ROWS_SHOWN),
    allQuotes: rows,
    quoteCount: rows.length,
    deliveries: legRows.slice(0, DELIVERY_ROWS_SHOWN).map(x => x.row),
    deliveryCount: legRows.length,
    open: { enquiries: waiting, legs: openLegs, currency },
    lastContact: events[0]?.parts ?? null,
    deliveryUnits: units,
    span: allDates.length > 0 ? { from: allDates[0], to: allDates[allDates.length - 1] } : null,
  }
}

/** The earliest year we dealt with this supplier: its first enquiry or leg, else the year the company was added. */
export function earliestYear(raw: SupplierRecordRaw | undefined, createdAt: string): number | null {
  if (!raw) return null
  const years = [
    ...raw.inquiries.map(i => i.sentOn),
    ...raw.legs.map(l => l.placedOn ?? l.expectedOn ?? l.receivedOn),
  ]
    .filter((d): d is string => Boolean(d))
    .map(d => Number(d.slice(0, 4)))
  years.push(Number(createdAt.slice(0, 4)))
  return Math.min(...years)
}
