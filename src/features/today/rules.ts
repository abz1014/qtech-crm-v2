// Today (R11, R16): the work-list rules as pure functions over view rows. No clock, no database: "today" comes in.
//
// Source of the rules: DATA_MODEL section 5 (Work-list rules that use the stamps; Work-list routing), Amendment A2b
// (the Waiting group), Amendment A6.4 (the close-month item) and DECISIONS. Thresholds are constants here. All day counts
// are business days (Saturday and Sunday do not count), except the "N days late" shown to the person, which are calendar days.
//
// Each rule returns entries; a chase rule returns an entry that is either active or carries `waiting` (chased, cooling
// down). An item that has never been chased and is not due yet is not returned at all. Snoozes are subtracted after the
// rules (applySnoozes), so a snoozed item is gone entirely: Waiting is the system's cooldown, a snooze is the person's choice.

import { addBusinessDays, businessDaysBetween, daysBetween, longDay, parseDay } from '@/features/rfqs/lib/dateText'
import { isBidClose } from '@/features/rfqs/lib/customerChase'
import { timeText } from '@/features/rfqs/lib/chaseCommon'
import { supplierReplyBy } from '@/features/rfqs/lib/supplierChase'
import { orderRef, rfqRef } from '@/lib/refs'
import {
  SNOOZE_RULE,
  type ClarificationFact,
  type RuleKey,
  type SnoozeFact,
  type TodayGroup,
  type TodayInputs,
  type TodayItem,
  type TodayTab,
  type TodayView,
  type Tone,
} from './types'

// ---------------------------------------------------------------- thresholds (business days unless stated)

export const THRESHOLDS = {
  /** A customer chase is due when the last ask is this old. */
  customerChaseDays: 3,
  /** A supplier chase is due this long after the last contact, or the supplier's median reply plus one when it has 3 or more replies. */
  supplierChaseMinDays: 2,
  /** Replies needed before the supplier's own median is trusted. */
  supplierMedianMinReplies: 3,
  /** Goods chase cooldown. */
  goodsChaseDays: 3,
  /** Payment reminder cooldown (DATA_MODEL: overdue and not reminded in the last 7 days). */
  paymentReminderDays: 7,
  /** A bid due within this many working days shortens the wait between chases. */
  bidCloseDays: 3,
  /** The wait between chases when the bid is close. */
  bidCloseWaitDays: 1,
  /** The "bid due" rule shows RFQs whose bid is due within this many calendar days (and every one that is overdue). */
  bidDueHorizonDays: 5,
  /** Bid sent and no decision after this many working days. */
  decisionOverdueDays: 10,
  /** "Due in the next 5 days" group. */
  soonDays: 5,
  /** Escalation: asks with no answer. */
  customerEscalationAsks: 3,
  /** Escalation: supplier chases with no price. */
  supplierEscalationChases: 2,
  /** An order delivered (goods and commissioning) is due an invoice this many working days after the delivery. */
  invoiceAfterDeliveryDays: 1,
  /** The close-month item shows on these days of the month. */
  closeMonthFromDay: 1,
  closeMonthToDay: 10,
} as const

// ---------------------------------------------------------------- helpers

export type Entry = TodayItem

const RFQ_HREF = (id: string) => `/rfqs/${id}`

export function routesToUser(ownerId: string | null, ctx: TodayInputs): boolean {
  if (ownerId === null) return ctx.user.role === 'admin' // ownerless legacy rows: admin picks them up
  return ownerId === ctx.user.id
}

/** "12d late", "today", "3d". Danger when late or today, warning within three days, neutral beyond. */
export function dueBadge(dueOn: string, today: string): { text: string; tone: Tone } {
  const d = daysBetween(today, dueOn)
  if (d < 0) return { text: `${-d}d late`, tone: 'danger' }
  if (d === 0) return { text: 'today', tone: 'danger' }
  return { text: `in ${d}d`, tone: d <= 3 ? 'warning' : 'neutral' }
}

function ageBadge(since: string | null, today: string): { text: string; tone: Tone } {
  const d = since ? Math.max(0, daysBetween(since, today)) : 0
  return { text: since ? `${d}d old` : 'new', tone: 'neutral' }
}

/** The collision line (O-3): somebody else made the last chase. Nothing when it was you or nobody is on record. */
export function collisionOf(by: string | null | undefined, at: string | null | undefined, ctx: TodayInputs): { by: string; at: string } | undefined {
  return by && at && by !== ctx.user.id ? { by, at } : undefined
}

/** Where an item sits in the list, from the date it is sorted by. */
export function groupFor(actionDueOn: string | null, today: string): TodayGroup {
  if (!actionDueOn) return 'ready'
  if (actionDueOn <= today) return 'now'
  if (businessDaysBetween(today, actionDueOn) <= THRESHOLDS.soonDays) return 'soon'
  return 'ready'
}

/** The wait between chases: shorter when the bid is due within three working days. */
export function cooldownDays(baseDays: number, dueOn: string | null, today: string): number {
  return isBidClose(dueOn, today) ? Math.min(baseDays, THRESHOLDS.bidCloseWaitDays) : baseDays
}

export type ChaseState = 'active' | 'waiting' | 'hidden'

/**
 * The state of a chasable thing: `lastTouchOn` is the last ask, chase or send, `waitDays` the cooldown, `chased` whether
 * anyone has chased it yet. On the return date it is active again (the threshold date). Before it, a chased item waits and
 * an unchased one is simply not due yet.
 */
export function chaseState(input: { lastTouchOn: string; waitDays: number; chased: boolean; today: string }): { state: ChaseState; nextNudgeOn: string } {
  const nextNudgeOn = addBusinessDays(input.lastTouchOn, input.waitDays)
  if (input.today >= nextNudgeOn) return { state: 'active', nextNudgeOn }
  return { state: input.chased ? 'waiting' : 'hidden', nextNudgeOn }
}

function build(partial: Omit<TodayItem, 'key' | 'group'> & { group?: TodayGroup }, today: string): TodayItem {
  return { ...partial, key: `${partial.rule}:${partial.subjectId}`, group: partial.group ?? groupFor(partial.actionDueOn, today) }
}

function withWaiting(item: TodayItem, w: { state: ChaseState; nextNudgeOn: string }, chasedOn: string): TodayItem | null {
  if (w.state === 'hidden') return null
  return w.state === 'waiting' ? { ...item, waiting: { chasedOn, nextNudgeOn: w.nextNudgeOn } } : item
}

const maxDate = (dates: readonly string[]) => dates.reduce((a, b) => (a > b ? a : b))

function tabFor(rule: RuleKey): TodayTab {
  switch (rule) {
    case 'chase_customer':
    case 'bid_due':
    case 'decision_overdue':
      return 'bids'
    case 'payment_overdue':
    case 'delivered_not_invoiced':
    case 'close_month':
      return 'money'
    default:
      return 'sourcing'
  }
}

// ---------------------------------------------------------------- the rules

/** Customer clarification chase: open asked questions and the last ask is 3 working days old (1 if the bid is due within 3). */
export function ruleChaseCustomer(ctx: TodayInputs): Entry[] {
  const byRfq = new Map<string, ClarificationFact[]>()
  for (const c of ctx.clarifications) byRfq.set(c.rfqId, [...(byRfq.get(c.rfqId) ?? []), c])
  const out: Entry[] = []
  for (const r of ctx.rfqs) {
    const qs = byRfq.get(r.id)
    if (!qs || qs.length === 0 || r.bidState !== 'to_bid' || !routesToUser(r.ownerId, ctx)) continue
    const lastAskedOn = maxDate(qs.map(q => q.lastAskedOn))
    const askCount = Math.max(...qs.map(q => q.askCount))
    const w = chaseState({ lastTouchOn: lastAskedOn, waitDays: cooldownDays(THRESHOLDS.customerChaseDays, r.dueOn, ctx.today), chased: true, today: ctx.today })
    const lastAsk = [...qs].sort((a, b) => a.lastAskedAt.localeCompare(b.lastAskedAt)).at(-1)
    const item = build(
      {
        rule: 'chase_customer',
        subjectId: r.id,
        tab: tabFor('chase_customer'),
        title: 'Chase customer for clarifications',
        waitingTitle: 'Customer chased',
        ref: rfqRef(r.number),
        party: r.companyName,
        actionDueOn: w.nextNudgeOn, // last ask + the wait
        badge: dueBadge(w.nextNudgeOn, ctx.today),
        isPriority: r.isPriority,
        rfqId: r.id,
        href: RFQ_HREF(r.id),
        escalation: askCount >= THRESHOLDS.customerEscalationAsks ? 'close_no_reply' : undefined,
        collision: collisionOf(lastAsk?.lastAskedBy, lastAsk?.lastAskedAt, ctx),
        number: r.number,
      },
      ctx.today,
    )
    const e = withWaiting(item, w, lastAskedOn)
    if (e) out.push(e)
  }
  return out
}

/** Relay answers: a supplier raised questions, the customer answered, and the answers have not gone back to that supplier. */
export function ruleRelayAnswers(ctx: TodayInputs): Entry[] {
  const rfqs = new Map(ctx.rfqs.map(r => [r.id, r]))
  const out: Entry[] = []
  for (const i of ctx.inquiries) {
    const r = rfqs.get(i.rfqId)
    if (!r || i.answersToRelay <= 0 || !routesToUser(r.ownerId, ctx)) continue
    const n = i.answersToRelay
    out.push(
      build(
        {
          rule: 'relay_answers',
          subjectId: i.id,
          tab: tabFor('relay_answers'),
          title: `Answer received on ${n} ${n === 1 ? 'question' : 'questions'}: relay to ${i.supplierName}`,
          ref: rfqRef(r.number),
          party: r.companyName,
          actionDueOn: i.answeredOn ?? ctx.today, // the day the customer answered
          badge: dueBadge(i.answeredOn ?? ctx.today, ctx.today),
          isPriority: r.isPriority,
          rfqId: r.id,
          inquiryId: i.id,
          href: RFQ_HREF(r.id),
          number: r.number,
        },
        ctx.today,
      ),
    )
  }
  return out
}

/** Not floated: an open RFQ with nobody asked for a price yet. */
export function ruleNotFloated(ctx: TodayInputs): Entry[] {
  const out: Entry[] = []
  for (const r of ctx.rfqs) {
    if (r.sourcingState !== 'not_floated' || r.bidState !== 'to_bid' || !routesToUser(r.ownerId, ctx)) continue
    out.push(
      build(
        {
          rule: 'not_floated',
          subjectId: r.id,
          tab: tabFor('not_floated'),
          title: 'Not floated to suppliers yet',
          ref: rfqRef(r.number),
          party: r.companyName,
          actionDueOn: r.receivedOn, // due the day it arrived (+0): floating is the first thing to do
          badge: dueBadge(r.receivedOn, ctx.today),
          isPriority: r.isPriority,
          rfqId: r.id,
          href: RFQ_HREF(r.id),
          number: r.number,
        },
        ctx.today,
      ),
    )
  }
  return out
}

/**
 * Supplier quote chase: sent, no quote and no "cannot offer", and the time since the last contact (the last chase, else the
 * send) is at least max(2, the supplier's median reply days + 1 when it has 3 or more replies); or the reply-by date has
 * passed without a chase since. A bid due within 3 working days shortens the wait to 1.
 */
export function ruleChaseSupplier(ctx: TodayInputs): Entry[] {
  const rfqs = new Map(ctx.rfqs.map(r => [r.id, r]))
  const out: Entry[] = []
  for (const i of ctx.inquiries) {
    const r = rfqs.get(i.rfqId)
    if (!r || !i.sentOn || i.responseState !== 'awaiting' || r.bidState !== 'to_bid' || !routesToUser(r.ownerId, ctx)) continue
    const median = i.replied >= THRESHOLDS.supplierMedianMinReplies && i.medianReplyDays !== null ? Math.ceil(i.medianReplyDays) + 1 : 0
    const base = Math.max(THRESHOLDS.supplierChaseMinDays, median)
    const lastTouchOn = i.lastChasedOn ?? i.sentOn
    let w = chaseState({ lastTouchOn, waitDays: cooldownDays(base, r.dueOn, ctx.today), chased: i.chaseCount > 0, today: ctx.today })
    let replyByHit: string | null = null
    if (w.state !== 'active') {
      const replyBy = supplierReplyBy(r.dueOn, i.sentOn)
      if (replyBy && ctx.today > replyBy && (i.lastChasedOn === null || i.lastChasedOn <= replyBy)) {
        replyByHit = replyBy
        w = { state: 'active', nextNudgeOn: ctx.today }
      }
    }
    const actionOn = replyByHit ?? w.nextNudgeOn // last contact + the wait, or the reply-by date once it has passed
    const item = build(
      {
        rule: 'chase_supplier',
        subjectId: i.id,
        tab: tabFor('chase_supplier'),
        title: 'Chase supplier for a quote',
        waitingTitle: 'Supplier chased',
        ref: rfqRef(r.number),
        party: i.supplierName,
        actionDueOn: actionOn,
        badge: dueBadge(actionOn, ctx.today),
        isPriority: r.isPriority,
        rfqId: r.id,
        inquiryId: i.id,
        href: RFQ_HREF(r.id),
        escalation: i.chaseCount >= THRESHOLDS.supplierEscalationChases ? 'float_elsewhere' : undefined,
        collision: collisionOf(i.lastChasedBy, i.lastChasedOn, ctx),
        number: r.number,
      },
      ctx.today,
    )
    const e = withWaiting(item, w, i.lastChasedOn ?? i.sentOn)
    if (e) out.push(e)
  }
  return out
}

function dueWords(dueOn: string, today: string, dueTime?: string | null): string {
  const d = daysBetween(today, dueOn)
  const at = timeText(dueTime)
  if (d < 0) return `Bid ${-d} ${-d === 1 ? 'day' : 'days'} overdue`
  if (d === 0) return `Bid due today${at ? `, ${at}` : ''}`
  if (d === 1) return `Bid due tomorrow${at ? `, ${at}` : ''}`
  return `Bid due ${longDay(dueOn)}${at ? `, ${at}` : ''}`
}

/** Bid due: still to bid, and due within 5 days (or already late). */
export function ruleBidDue(ctx: TodayInputs): Entry[] {
  const out: Entry[] = []
  for (const r of ctx.rfqs) {
    if (r.bidState !== 'to_bid' || !r.dueOn || !routesToUser(r.ownerId, ctx)) continue
    if (daysBetween(ctx.today, r.dueOn) > THRESHOLDS.bidDueHorizonDays) continue
    out.push(
      build(
        {
          rule: 'bid_due',
          subjectId: r.id,
          tab: tabFor('bid_due'),
          title: dueWords(r.dueOn, ctx.today, r.dueTime),
          ref: rfqRef(r.number),
          party: r.companyName,
          actionDueOn: r.dueOn,
          badge: dueBadge(r.dueOn, ctx.today),
          isPriority: r.isPriority,
          rfqId: r.id,
          href: RFQ_HREF(r.id),
          number: r.number,
        },
        ctx.today,
      ),
    )
  }
  return out
}

/** Decision overdue: the bid went out 10 working days ago and nobody has won or closed it; or the quotation has expired. */
export function ruleDecisionOverdue(ctx: TodayInputs): Entry[] {
  const out: Entry[] = []
  for (const r of ctx.rfqs) {
    if (!routesToUser(r.ownerId, ctx)) continue
    if (r.bidState === 'quotation_expired' && r.quotationValidUntil) {
      out.push(
        build(
          {
            rule: 'decision_overdue',
            subjectId: r.id,
            tab: tabFor('decision_overdue'),
            title: 'Quotation expired: re-confirm prices before re-issuing',
            ref: rfqRef(r.number),
            party: r.companyName,
            actionDueOn: r.quotationValidUntil,
            badge: dueBadge(r.quotationValidUntil, ctx.today),
            isPriority: r.isPriority,
            rfqId: r.id,
            href: RFQ_HREF(r.id),
            number: r.number,
          },
          ctx.today,
        ),
      )
      continue
    }
    if (r.bidState !== 'bid_sent' || !r.quotedOn) continue
    const decisionDue = addBusinessDays(r.quotedOn, THRESHOLDS.decisionOverdueDays)
    if (ctx.today < decisionDue) continue
    const since = daysBetween(r.quotedOn, ctx.today)
    out.push(
      build(
        {
          rule: 'decision_overdue',
          subjectId: r.id,
          tab: tabFor('decision_overdue'),
          title: `No decision yet: bid sent ${since} days ago`,
          ref: rfqRef(r.number),
          party: r.companyName,
          actionDueOn: decisionDue,
          badge: dueBadge(decisionDue, ctx.today),
          isPriority: r.isPriority,
          rfqId: r.id,
          href: RFQ_HREF(r.id),
          number: r.number,
        },
        ctx.today,
      ),
    )
  }
  return out
}

/**
 * Payment overdue (admin and sales only): the order is overdue and was not reminded within the last 7 working days.
 * Routed to the order owner when the owner is sales, otherwise to admin (engineers cannot see money).
 */
export function rulePaymentOverdue(ctx: TodayInputs): Entry[] {
  if (ctx.user.role === 'engineer') return []
  const out: Entry[] = []
  for (const p of ctx.receivables) {
    if (!p.isOverdue || !p.dueOn || p.balance <= 0) continue
    const ownerRole = ctx.roleOf(p.ownerId)
    const mine = ctx.user.role === 'sales' ? p.ownerId === ctx.user.id : ownerRole !== 'sales'
    if (!mine) continue
    const late = daysBetween(p.dueOn, ctx.today)
    const w = chaseState({
      lastTouchOn: p.lastRemindedOn ?? p.dueOn,
      waitDays: THRESHOLDS.paymentReminderDays,
      chased: p.reminderCount > 0 && p.lastRemindedOn !== null,
      today: ctx.today,
    })
    // An order never reminded is due at once (it is already overdue); the cooldown only applies after a reminder.
    const state = p.lastRemindedOn === null ? { state: 'active' as ChaseState, nextNudgeOn: ctx.today } : w
    const actionOn = p.lastRemindedOn === null ? p.dueOn : w.nextNudgeOn
    const item = build(
      {
        rule: 'payment_overdue',
        subjectId: p.orderId,
        tab: tabFor('payment_overdue'),
        title: `Payment ${late} ${late === 1 ? 'day' : 'days'} overdue`,
        waitingTitle: 'Payment reminded',
        ref: orderRef(p.orderNumber),
        party: p.customerName,
        actionDueOn: actionOn, // the due date for the first reminder; the last reminder plus the cooldown after that
        badge: dueBadge(actionOn, ctx.today),
        isPriority: false,
        orderId: p.orderId,
        href: `/orders/${p.orderId}`,
        number: p.orderNumber,
      },
      ctx.today,
    )
    const e = withWaiting(item, state, p.lastRemindedOn ?? ctx.today)
    if (e) out.push(e)
  }
  return out
}

/** Goods late: the order was placed, the expected date has passed and the leg is not delivered (there is no separate "received" step: received follows delivered). Cooldown 3 working days after a chase. */
export function ruleGoodsLate(ctx: TodayInputs): Entry[] {
  const out: Entry[] = []
  for (const l of ctx.legs) {
    if (!l.placedOn || !l.expectedOn || l.deliveredOn || l.expectedOn >= ctx.today || !routesToUser(l.ownerId, ctx)) continue
    const late = daysBetween(l.expectedOn, ctx.today)
    const w = chaseState({
      lastTouchOn: l.lastChasedOn ?? l.expectedOn,
      waitDays: THRESHOLDS.goodsChaseDays,
      chased: l.chaseCount > 0 && l.lastChasedOn !== null,
      today: ctx.today,
    })
    const state = l.lastChasedOn === null ? { state: 'active' as ChaseState, nextNudgeOn: ctx.today } : w
    const actionOn = l.lastChasedOn === null ? l.expectedOn : w.nextNudgeOn
    const item = build(
      {
        rule: 'goods_late',
        subjectId: l.id,
        tab: tabFor('goods_late'),
        title: `Goods ${late} ${late === 1 ? 'day' : 'days'} late from supplier`,
        waitingTitle: 'Supplier chased for goods',
        ref: l.reference ? `PO ${l.reference.replace(/^PO\s+/i, '')}` : orderRef(l.orderNumber),
        party: l.supplierName,
        actionDueOn: actionOn, // the expected date for the first chase; the last chase plus the cooldown after that
        badge: dueBadge(actionOn, ctx.today),
        isPriority: false,
        orderId: l.orderId,
        legId: l.id,
        href: `/orders/${l.orderId}`,
        collision: collisionOf(l.lastChasedBy, l.lastChasedOn, ctx),
        number: l.orderNumber,
      },
      ctx.today,
    )
    const e = withWaiting(item, state, l.lastChasedOn ?? ctx.today)
    if (e) out.push(e)
  }
  return out
}

/** Place PO: a supplier leg of a live order has no placed date. Always "ready to move". */
export function rulePlacePo(ctx: TodayInputs): Entry[] {
  const out: Entry[] = []
  for (const l of ctx.legs) {
    if (l.placedOn || !routesToUser(l.ownerId, ctx)) continue
    out.push(
      build(
        {
          rule: 'place_po',
          subjectId: l.id,
          tab: tabFor('place_po'),
          title: `Place PO with ${l.supplierName}`,
          ref: orderRef(l.orderNumber),
          party: l.customerName,
          actionDueOn: l.orderedOn, // placeable from the day the order was confirmed; always shown as ready to move
          group: 'ready',
          badge: ageBadge(l.orderedOn, ctx.today),
          isPriority: false,
          orderId: l.orderId,
          legId: l.id,
          href: `/orders/${l.orderId}`,
          number: l.orderNumber,
        },
        ctx.today,
      ),
    )
  }
  return out
}

/**
 * Plan commissioning (O05): the order needs commissioning and no date is planned yet. Goes to the order owner, like the rest
 * of the goods and commissioning side; engineers see it for orders they own. One item per order, always ready to move: it
 * never turns red by itself (no date is promised), and it leaves the moment a planned or done date is set.
 */
export function rulePlanCommissioning(ctx: TodayInputs): Entry[] {
  const out: Entry[] = []
  for (const o of ctx.orders) {
    if (o.commissioningState !== 'to_plan' || !routesToUser(o.ownerId, ctx)) continue
    out.push(
      build(
        {
          rule: 'plan_commissioning',
          subjectId: o.id,
          tab: tabFor('plan_commissioning'),
          title: 'Plan commissioning',
          ref: orderRef(o.number),
          party: o.customerName,
          actionDueOn: o.orderedOn,
          group: 'ready',
          badge: ageBadge(o.orderedOn, ctx.today),
          isPriority: false,
          orderId: o.id,
          href: `/orders/${o.id}`,
          number: o.number,
        },
        ctx.today,
      ),
    )
  }
  return out
}

/**
 * Delivered but not invoiced (O05, admin and sales only): every goods leg is delivered and any commissioning is done, yet no
 * invoice exists. Due one working day after the last delivery, so it does not nag on the day the goods arrive. Routed like
 * payment: to the order owner when the owner is sales, otherwise to admin. An engineer never gets it (the invoicing state is
 * hidden from them by the view and the rule returns nothing for the role). A part-invoiced order is not raised: someone is
 * already invoicing it.
 */
export function ruleDeliveredNotInvoiced(ctx: TodayInputs): Entry[] {
  if (ctx.user.role === 'engineer') return []
  const out: Entry[] = []
  for (const o of ctx.orders) {
    if (o.invoicingState !== 'not_invoiced') continue
    const goodsDone = o.goodsState === 'delivered' || o.goodsState === 'received' || o.goodsState === 'n_a'
    const commissioningDone = o.commissioningState === 'done' || o.commissioningState === 'n_a'
    // Nothing was ever delivered on an order with neither goods nor commissioning: there is no delivery to invoice.
    if (!goodsDone || !commissioningDone || (o.goodsState === 'n_a' && o.commissioningState === 'n_a')) continue
    const ownerRole = ctx.roleOf(o.ownerId)
    const mine = ctx.user.role === 'sales' ? o.ownerId === ctx.user.id : ownerRole !== 'sales'
    if (!mine) continue
    const since = o.deliveredOn ?? o.orderedOn ?? ctx.today
    const dueOn = addBusinessDays(since, THRESHOLDS.invoiceAfterDeliveryDays)
    out.push(
      build(
        {
          rule: 'delivered_not_invoiced',
          subjectId: o.id,
          tab: tabFor('delivered_not_invoiced'),
          title: 'Delivered, not invoiced',
          ref: orderRef(o.number),
          party: o.customerName,
          actionDueOn: dueOn,
          badge: dueBadge(dueOn, ctx.today),
          isPriority: false,
          orderId: o.id,
          href: `/orders/${o.id}`,
          number: o.number,
        },
        ctx.today,
      ),
    )
  }
  return out
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A uuid for the polymorphic snoozes.subject_id of the close-month item: the month's digits, so it is stable and unique. */
/** The first day of the month `today` is in. */
export const today1 = (today: string): string => `${today.slice(0, 7)}-01`

export function closeMonthSubjectId(month: string): string {
  const digits = month.slice(0, 7).replace('-', '')
  return `00000000-0000-4000-8000-${digits.padStart(12, '0')}`
}

/** The month the close-month item is about when today is `today`: the previous one. */
export function previousMonthStart(today: string): string {
  const p = parseDay(today)
  if (!p) return today
  const y = p.m === 1 ? p.y - 1 : p.y
  const m = p.m === 1 ? 12 : p.m - 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/** Close {month}: n checks. Admin only, from the 1st to the 10th while the previous month is open. Never more than one item. */
export function ruleCloseMonth(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'admin' || !ctx.monthEnd || ctx.monthEnd.closed) return []
  const day = parseDay(ctx.today)?.d ?? 0
  if (day < THRESHOLDS.closeMonthFromDay || day > THRESHOLDS.closeMonthToDay) return []
  if (ctx.monthEnd.month !== previousMonthStart(ctx.today)) return []
  const name = MONTH_NAMES[Number(ctx.monthEnd.month.slice(5, 7)) - 1]
  const n = ctx.monthEnd.checks
  return [
    build(
      {
        rule: 'close_month',
        subjectId: closeMonthSubjectId(ctx.monthEnd.month),
        tab: tabFor('close_month'),
        title: n > 0 ? `Close ${name}: ${n} ${n === 1 ? 'check' : 'checks'}` : `Close ${name}: no checks open`,
        ref: 'Month end',
        party: `${name} ${ctx.monthEnd.month.slice(0, 4)}`,
        actionDueOn: `${today1(ctx.today)}`, // the 1st of the month it is shown in; always shown as ready to move
        group: 'ready',
        badge: { text: n > 0 ? `${n}` : 'ready', tone: 'neutral' },
        isPriority: false,
        href: '/money',
        number: 0,
      },
      ctx.today,
    ),
  ]
}

// ---------------------------------------------------------------- snoozes, grouping, the whole list

/** Remove every item the person snoozed until a date that has not arrived. On the date itself the item is back. */
export function applySnoozes(items: readonly Entry[], snoozes: readonly SnoozeFact[], today: string): Entry[] {
  const hidden = new Set(snoozes.filter(s => s.untilOn > today).map(s => `${s.rule}:${s.subjectId}`))
  return items.filter(i => !hidden.has(`${SNOOZE_RULE[i.rule]}:${i.subjectId}`))
}

const byDate = (a: Entry, b: Entry) => {
  if (a.actionDueOn !== b.actionDueOn) {
    if (a.actionDueOn === null) return 1
    if (b.actionDueOn === null) return -1
    return a.actionDueOn < b.actionDueOn ? -1 : 1
  }
  if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1
  if ((a.rule === 'close_month') !== (b.rule === 'close_month')) return a.rule === 'close_month' ? 1 : -1 // the month-end chore goes last
  return a.number - b.number || (a.key < b.key ? -1 : 1)
}

const byAge = (a: Entry, b: Entry) => a.number - b.number || (a.key < b.key ? -1 : 1)

/** Split into the three active groups and the Waiting group, each in list order. */
export function groupItems(items: readonly Entry[]): TodayView {
  const active = items.filter(i => !i.waiting)
  const sorted = (g: TodayGroup) => active.filter(i => i.group === g).sort(byDate)
  const now = sorted('now')
  const soon = sorted('soon')
  const ready = sorted('ready')
  const waiting = items
    .filter(i => i.waiting)
    .sort((a, b) => (a.waiting!.nextNudgeOn === b.waiting!.nextNudgeOn ? byAge(a, b) : a.waiting!.nextNudgeOn < b.waiting!.nextNudgeOn ? -1 : 1))
  return { now, soon, ready, waiting, active: [...now, ...soon, ...ready] }
}

/** Every rule, in one place, so a test can name them. */
export const RULES: Record<RuleKey, (ctx: TodayInputs) => Entry[]> = {
  chase_customer: ruleChaseCustomer,
  relay_answers: ruleRelayAnswers,
  not_floated: ruleNotFloated,
  chase_supplier: ruleChaseSupplier,
  bid_due: ruleBidDue,
  decision_overdue: ruleDecisionOverdue,
  payment_overdue: rulePaymentOverdue,
  goods_late: ruleGoodsLate,
  place_po: rulePlacePo,
  plan_commissioning: rulePlanCommissioning,
  delivered_not_invoiced: ruleDeliveredNotInvoiced,
  close_month: ruleCloseMonth,
}

/** The whole Today list for one person on one day: every rule, snoozes subtracted, grouped. Engineers never get a money rule. */
export function buildToday(ctx: TodayInputs): TodayView {
  const all = (Object.keys(RULES) as RuleKey[]).flatMap(k => RULES[k](ctx))
  return groupItems(applySnoozes(all, ctx.snoozes, ctx.today))
}

/** The nudge date of a Waiting row, or null. */
export const returnsOn = (i: Entry): string | null => i.waiting?.nextNudgeOn ?? null

/** Calendar days from a past date to today, for "chased 2 days ago". */
export const daysAgo = (on: string, today: string): number => Math.max(0, daysBetween(on, today))

