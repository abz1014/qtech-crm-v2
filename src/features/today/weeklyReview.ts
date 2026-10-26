// The weekly owner review (redesign phase 3, P3-C1, plan section (e)): where old and stuck work goes instead of turning red on
// everybody's list. Pure functions over the same facts To do reads; admin only (the page and the Monday row refuse everyone else).
//
//   quotation  a quotation sent 10 working days ago or more, no decision (still open)
//   enquiry    an enquiry received 10 days ago or more with no supplier asked
//   goods      goods more than 14 days past their expected date, not delivered
//   payment    a payment more than 30 days past its due date (it also stays at the top of To do: late money never times out)
//
// "Still live" is a snooze under a review rule key (REVIEW_RULE), so the row stays out of the next two reviews and nothing else
// changes. "Close as lost" closes the RFQ (reopened by Undo). Chase and Record payment go to the record.
import { addBusinessDays, businessDaysBetween, daysBetween } from '@/features/rfqs/lib/dateText'
import { formatDay } from '@/lib/formatDay'
import { orderRef, rfqRef } from '@/lib/refs'
import type { LegFact, ReceivableFact, RfqFact, SnoozeFact } from '@/features/today/types'

export type ReviewKind = 'quotation' | 'enquiry' | 'goods' | 'payment'

/** The words each kind of "Still live" is saved under (snoozes.rule). They are not Today rules, so a review snooze never hides a To do row. */
export const REVIEW_RULE: Record<ReviewKind, string> = {
  quotation: 'review_quotation',
  enquiry: 'review_enquiry',
  goods: 'review_goods',
  payment: 'review_payment',
}

/** "Still live" keeps a row out of the review for this many days (two reviews). */
export const STILL_LIVE_DAYS = 14

export const REVIEW_LIMITS = {
  /** A quotation with no decision after this many working days. */
  quotationDays: 10,
  /** An enquiry with no supplier asked after this many calendar days. */
  enquiryDays: 10,
  /** Goods this many days past their expected date. */
  goodsDays: 14,
  /** A payment this many days past its due date. */
  paymentDays: 30,
} as const

export interface ReviewRow {
  /** `${kind}:${subjectId}` */
  key: string
  kind: ReviewKind
  /** The id "Still live" is saved against: the RFQ, the supplier order or the order. */
  subjectId: string
  rfqId?: string
  orderId?: string
  ownerId: string | null
  /** "RFQ-0147 · Olympia Chemicals" */
  title: string
  /** "Quotation sent Fri 9 Oct · 12 working days ago" */
  detailOn: string
  detail: string
  href: string
  tone: 'danger' | 'warning' | 'neutral'
  /** Payments: what is still owed, shown to admin only (the page is admin only). */
  amount?: number
}

export interface ReviewInputs {
  today: string
  rfqs: readonly RfqFact[]
  legs: readonly LegFact[]
  receivables: readonly ReceivableFact[]
  snoozes: readonly SnoozeFact[]
}

const kept = (snoozes: readonly SnoozeFact[], kind: ReviewKind, id: string, today: string) =>
  snoozes.some(s => s.rule === REVIEW_RULE[kind] && s.subjectId === id && s.untilOn > today)

export function buildReview(i: ReviewInputs): Record<ReviewKind, ReviewRow[]> {
  const { today } = i
  const quotation: ReviewRow[] = []
  const enquiry: ReviewRow[] = []
  for (const r of i.rfqs) {
    // an open RFQ whose quotation went out and nobody decided
    if (r.bidState === 'bid_sent' && r.quotedOn && today >= addBusinessDays(r.quotedOn, REVIEW_LIMITS.quotationDays) && !kept(i.snoozes, 'quotation', r.id, today)) {
      quotation.push({
        key: `quotation:${r.id}`,
        kind: 'quotation',
        subjectId: r.id,
        rfqId: r.id,
        ownerId: r.ownerId,
        title: `${rfqRef(r.number)} · ${r.companyName}`,
        detailOn: r.quotedOn,
        detail: `Quotation sent ${formatDay(r.quotedOn)}, ${businessDaysBetween(r.quotedOn, today)} working days ago`,
        href: `/rfqs/${r.id}`,
        tone: 'neutral',
      })
    }
    // an enquiry nobody has asked suppliers about
    if (r.bidState === 'to_bid' && r.sourcingState === 'not_floated' && daysBetween(r.receivedOn, today) >= REVIEW_LIMITS.enquiryDays && !kept(i.snoozes, 'enquiry', r.id, today)) {
      enquiry.push({
        key: `enquiry:${r.id}`,
        kind: 'enquiry',
        subjectId: r.id,
        rfqId: r.id,
        ownerId: r.ownerId,
        title: `${rfqRef(r.number)} · ${r.companyName}`,
        detailOn: r.receivedOn,
        detail: `Received ${formatDay(r.receivedOn)}, ${daysBetween(r.receivedOn, today)} days ago, no supplier asked`,
        href: `/rfqs/${r.id}`,
        tone: 'neutral',
      })
    }
  }
  const goods: ReviewRow[] = i.legs
    .filter(l => !l.legacy && l.placedOn && l.expectedOn && !l.deliveredOn && daysBetween(l.expectedOn, today) > REVIEW_LIMITS.goodsDays && !kept(i.snoozes, 'goods', l.id, today))
    .map(l => ({
      key: `goods:${l.id}`,
      kind: 'goods' as const,
      subjectId: l.id,
      orderId: l.orderId,
      ownerId: l.ownerId,
      title: `${orderRef(l.orderNumber)} · ${l.customerName} · ${l.supplierName}`,
      detailOn: l.expectedOn as string,
      detail: `Expected ${formatDay(l.expectedOn as string)}, ${daysBetween(l.expectedOn as string, today)} days late`,
      href: `/orders/${l.orderId}`,
      tone: 'warning' as const,
    }))
  const payment: ReviewRow[] = i.receivables
    .filter(p => !p.legacy && p.isOverdue && p.dueOn && daysBetween(p.dueOn, today) > REVIEW_LIMITS.paymentDays && !kept(i.snoozes, 'payment', p.orderId, today))
    .map(p => ({
      key: `payment:${p.orderId}`,
      kind: 'payment' as const,
      subjectId: p.orderId,
      orderId: p.orderId,
      ownerId: p.ownerId,
      title: `${orderRef(p.orderNumber)} · ${p.customerName}`,
      detailOn: p.dueOn as string,
      detail: `Was due ${formatDay(p.dueOn as string)}, ${daysBetween(p.dueOn as string, today)} days late`,
      href: `/orders/${p.orderId}`,
      tone: 'danger' as const,
      amount: p.balance,
    }))
  const oldestFirst = (a: ReviewRow, b: ReviewRow) => (a.detailOn < b.detailOn ? -1 : a.detailOn > b.detailOn ? 1 : 0)
  return { quotation: quotation.sort(oldestFirst), enquiry: enquiry.sort(oldestFirst), goods: goods.sort(oldestFirst), payment: payment.sort(oldestFirst) }
}

export const reviewCount = (r: Record<ReviewKind, readonly ReviewRow[]>): number => r.quotation.length + r.enquiry.length + r.goods.length + r.payment.length

/** True on a Monday (the day the review row is on To do). */
export function isMonday(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1
}
