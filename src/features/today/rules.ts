// Today (R11, R16): the work-list rules as pure functions over view rows. No clock, no database: "today" comes in.
//
// Source of the rules: DATA_MODEL section 5 (Work-list rules that use the stamps; Work-list routing), Amendment A2b
// (the Waiting group), Amendment A6.4 (the close-month item) and DECISIONS. Thresholds are constants here. All day counts
// are business days (Saturday and Sunday do not count), except the "N days late" shown to the person, which are calendar days.
//
// Each rule returns entries; a chase rule returns an entry that is either active or carries `waiting` (chased, cooling
// down). An item that has never been chased and is not due yet is not returned at all. Snoozes are subtracted after the
// rules (applySnoozes), so a snoozed item is gone entirely: Waiting is the system's cooldown, a snooze is the person's choice.

import { addBusinessDays, addDays, businessDaysBetween, daysBetween, longDay, parseDay } from '@/features/rfqs/lib/dateText'
import { isBidClose } from '@/features/rfqs/lib/customerChase'
import { timeText } from '@/features/rfqs/lib/chaseCommon'
import { supplierReplyBy } from '@/features/rfqs/lib/supplierChase'
import { formatShortDate } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { orderRef, rfqRef } from '@/lib/refs'
import { ageOrSince, dateWords, dueWord, sinceWords } from '@/lib/timeWords'
import { isStale, STALE_AFTER_DAYS, toneFor } from './needsYou'
import { buildReview, isMonday, reviewCount } from './weeklyReview'
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
  /** Goods delivered but commissioning not marked done: the invoice is still due, after this many working days. */
  invoiceDespiteCommissioningDays: 5,
  /** A part-invoiced, delivered order is reminded this many working days after its last invoice. */
  invoicePartDays: 3,
  /** The close-month item shows on these days of the month. */
  closeMonthFromDay: 1,
  closeMonthToDay: 10,
  /** TCS not sent: an invoice with no courier date this many working days after its invoice date. */
  tcsSendDays: 3,
  /** TCS not sent only looks at invoices this recent (calendar days), so old register rows never raise it. */
  tcsWindowDays: 60,
  /** An engineer's planned commissioning shows from this many working days before the date (the "next 5 days" group). */
  jobAheadDays: 5,
  /** An engineer's job older than this many calendar days (planned, or delivered to site) is stale, not today's work: it is left out. */
  jobStaleDays: 30,
} as const

// ---------------------------------------------------------------- helpers

export type Entry = TodayItem

const RFQ_HREF = (id: string) => `/rfqs/${id}`

export function routesToUser(ownerId: string | null, ctx: TodayInputs): boolean {
  if (ownerId === null) return ctx.user.role === 'admin' // ownerless legacy rows: admin picks them up
  return ownerId === ctx.user.id
}

/**
 * Time words from src/lib/timeWords (R2-08): "12 days overdue", "Due today", "Due tomorrow", "Due in 4 days"; past 30 days
 * "since 31 Jan 2025" (never "995 days overdue"). The tone is the one colour rule (needsYou.ts toneFor): red only for late
 * money and a slipped promise to a customer, amber for due today or tomorrow and for our own pace, grey beyond.
 */
export function dueBadge(dueOn: string, today: string, rule: RuleKey): { text: string; tone: Tone } {
  const d = daysBetween(today, dueOn)
  return { text: d < -STALE_AFTER_DAYS ? sinceWords(dueOn) : dueWord(d), tone: toneFor(rule, d) }
}

/** "5 days old", "New" (ageWords); past 30 days "since 31 Jan 2025". */
function ageBadge(since: string | null, today: string): { text: string; tone: Tone } {
  return { text: since ? ageOrSince(daysBetween(since, today), since) : 'New', tone: 'neutral' }
}

/** More than 30 days ago: a title then names the date instead of a count nobody reads ("995 days"). */
const old = (since: string, today: string): boolean => daysBetween(since, today) > STALE_AFTER_DAYS

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
    case 'costs_incomplete':
    case 'fbr_attention':
    case 'tcs_not_sent':
    case 'recurring_due':
    case 'gst_fbr':
    case 'claims_to_approve':
    case 'weekly_review':
      return 'money'
    case 'job_commissioning':
    case 'job_on_site':
      return 'sourcing'
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
        badge: dueBadge(w.nextNudgeOn, ctx.today, 'chase_customer'),
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
          title: `Answer received on ${n} ${n === 1 ? 'question' : 'questions'}: send it to ${i.supplierName}`,
          ref: rfqRef(r.number),
          party: r.companyName,
          actionDueOn: i.answeredOn ?? ctx.today, // the day the customer answered
          badge: dueBadge(i.answeredOn ?? ctx.today, ctx.today, 'relay_answers'),
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
          title: 'Needs suppliers',
          ref: rfqRef(r.number),
          party: r.companyName,
          actionDueOn: r.receivedOn, // due the day it arrived (+0): floating is the first thing to do
          badge: dueBadge(r.receivedOn, ctx.today, 'not_floated'),
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
/** The base wait after a supplier chase: max(2, the supplier's median reply days + 1 when it has 3 or more replies). */
export function supplierChaseBaseDays(i: { replied: number; medianReplyDays: number | null }): number {
  const median = i.replied >= THRESHOLDS.supplierMedianMinReplies && i.medianReplyDays !== null ? Math.ceil(i.medianReplyDays) + 1 : 0
  return Math.max(THRESHOLDS.supplierChaseMinDays, median)
}

export function ruleChaseSupplier(ctx: TodayInputs): Entry[] {
  const rfqs = new Map(ctx.rfqs.map(r => [r.id, r]))
  const out: Entry[] = []
  for (const i of ctx.inquiries) {
    const r = rfqs.get(i.rfqId)
    if (!r || !i.sentOn || i.responseState !== 'awaiting' || r.bidState !== 'to_bid' || !routesToUser(r.ownerId, ctx)) continue
    const base = supplierChaseBaseDays(i)
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
        title: 'Chase supplier for a price',
        waitingTitle: 'Supplier chased',
        ref: rfqRef(r.number),
        party: i.supplierName,
        actionDueOn: actionOn,
        badge: dueBadge(actionOn, ctx.today, 'chase_supplier'),
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
  if (d < -STALE_AFTER_DAYS) return `Quotation was due ${dateWords(dueOn)}, not sent`
  if (d < 0) return `Quotation ${-d} ${-d === 1 ? 'day' : 'days'} overdue`
  if (d === 0) return `Quotation due today${at ? `, ${at}` : ''}`
  if (d === 1) return `Quotation due tomorrow${at ? `, ${at}` : ''}`
  return `Quotation due ${longDay(dueOn)}${at ? `, ${at}` : ''}`
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
          badge: dueBadge(r.dueOn, ctx.today, 'bid_due'),
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
            title: 'Quotation expired: check prices before you revise it',
            ref: rfqRef(r.number),
            party: r.companyName,
            actionDueOn: r.quotationValidUntil,
            badge: dueBadge(r.quotationValidUntil, ctx.today, 'decision_overdue'),
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
    out.push(
      build(
        {
          rule: 'decision_overdue',
          subjectId: r.id,
          tab: tabFor('decision_overdue'),
          title: old(r.quotedOn, ctx.today) ? `No decision yet: quotation sent ${dateWords(r.quotedOn)}` : `No decision yet: quotation sent ${daysBetween(r.quotedOn, ctx.today)} days ago`,
          ref: rfqRef(r.number),
          party: r.companyName,
          actionDueOn: decisionDue,
          badge: dueBadge(decisionDue, ctx.today, 'decision_overdue'),
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
        title: old(p.dueOn, ctx.today) ? `Payment late ${sinceWords(p.dueOn)}` : `Payment ${plural(daysBetween(p.dueOn, ctx.today), 'day', 'days')} overdue`,
        waitingTitle: 'Payment reminded',
        ref: orderRef(p.orderNumber),
        party: p.customerName,
        actionDueOn: actionOn, // the due date for the first reminder; the last reminder plus the cooldown after that
        badge: dueBadge(actionOn, ctx.today, 'payment_overdue'),
        isPriority: false,
        orderId: p.orderId,
        href: `/orders/${p.orderId}`,
        number: p.orderNumber,
        amount: p.balance,
        ...(p.legacy ? { imported: true } : {}),
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
        title: old(l.expectedOn, ctx.today) ? `Goods late from supplier ${sinceWords(l.expectedOn)}` : `Goods ${plural(daysBetween(l.expectedOn, ctx.today), 'day', 'days')} late from supplier`,
        waitingTitle: 'Supplier chased for goods',
        ref: l.reference ? `PO ${l.reference.replace(/^PO\s+/i, '')}` : orderRef(l.orderNumber),
        party: l.supplierName,
        actionDueOn: actionOn, // the expected date for the first chase; the last chase plus the cooldown after that
        badge: dueBadge(actionOn, ctx.today, 'goods_late'),
        isPriority: false,
        orderId: l.orderId,
        legId: l.id,
        ...(l.legacy ? { imported: true } : {}),
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
          ...(l.legacy ? { imported: true } : {}),
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
          ...(o.legacy ? { imported: true } : {}),
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
 * To source: a won order with goods lines that have no supplier leg yet. One item per order saying how many lines still
 * need a supplier. Routed like place PO and plan commissioning (the order owner; ownerless to admin; an engineer sees the
 * orders they own). Always "ready to move" with the order's age and snoozable, so it is a reminder, not an alarm. The count
 * comes from the lines themselves; an order whose state says to source but whose lines count 0 (read in between) is quiet.
 */
export function ruleToSource(ctx: TodayInputs): Entry[] {
  const out: Entry[] = []
  for (const o of ctx.orders) {
    if (o.goodsState !== 'to_source' || o.unsourced <= 0 || !routesToUser(o.ownerId, ctx)) continue
    out.push(
      build(
        {
          rule: 'to_source',
          subjectId: o.id,
          tab: tabFor('to_source'),
          title: o.unsourced === 1 ? '1 item still needs a supplier' : `${o.unsourced} items still need a supplier`,
          ref: orderRef(o.number),
          party: o.customerName,
          actionDueOn: o.orderedOn,
          group: 'ready',
          badge: ageBadge(o.orderedOn, ctx.today),
          isPriority: false,
          orderId: o.id,
          ...(o.legacy ? { imported: true } : {}),
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
 * Delivered but not invoiced (O05, admin and sales only). Three cases, one item per order (the snooze key is the order):
 *  - Goods delivered and any commissioning done, no invoice yet: due one working day after the last delivery.
 *  - Goods delivered but commissioning not marked done (an engineer who never taps "Mark done" must not stop the invoice):
 *    due `invoiceDespiteCommissioningDays` working days after the delivery, and the title says commissioning is not marked.
 *  - Part-invoiced (invoiced gross below the order gross) with the goods delivered: "Partly invoiced, PKR X still to
 *    invoice", due `invoicePartDays` working days after the last invoice, so the rest is not forgotten.
 * Routed like payment: the order owner when the owner is sales, otherwise admin. An engineer never gets it (the view hides
 * the invoicing state from them and the rule returns nothing for the role). Snooze applies as to every item.
 */
export function ruleDeliveredNotInvoiced(ctx: TodayInputs): Entry[] {
  if (ctx.user.role === 'engineer') return []
  const out: Entry[] = []
  for (const o of ctx.orders) {
    const part = o.invoicingState === 'part'
    if (o.invoicingState !== 'not_invoiced' && !part) continue
    const goodsDone = o.goodsState === 'delivered' || o.goodsState === 'received' || o.goodsState === 'n_a'
    const commissioningDone = o.commissioningState === 'done' || o.commissioningState === 'n_a'
    if (!goodsDone) continue
    // Nothing was ever delivered on an order with neither goods nor commissioning: there is no delivery to invoice.
    if (o.goodsState === 'n_a' && o.commissioningState === 'n_a') continue
    // A service-only order has no delivery date to count from until its commissioning is marked done.
    if (o.goodsState === 'n_a' && !commissioningDone) continue
    const ownerRole = ctx.roleOf(o.ownerId)
    const mine = ctx.user.role === 'sales' ? o.ownerId === ctx.user.id : ownerRole !== 'sales'
    if (!mine) continue
    const since = o.deliveredOn ?? o.orderedOn ?? ctx.today
    let dueOn: string
    let title: string
    if (part) {
      dueOn = addBusinessDays(o.lastInvoicedOn ?? since, THRESHOLDS.invoicePartDays)
      title = o.toInvoice && o.toInvoice > 0 ? `Partly invoiced: PKR ${formatAmount(o.toInvoice)} still to invoice` : 'Partly invoiced: the rest is still to invoice'
    } else if (commissioningDone) {
      dueOn = addBusinessDays(since, THRESHOLDS.invoiceAfterDeliveryDays)
      title = 'Delivered, not invoiced'
    } else {
      dueOn = addBusinessDays(since, THRESHOLDS.invoiceDespiteCommissioningDays)
      title = 'Delivered, not invoiced (commissioning not marked done)'
    }
    // The two fallbacks (commissioning not marked, part-invoiced) appear only once their wait is over: they exist to catch
    // what was forgotten, not to announce what is still in time.
    if ((part || !commissioningDone) && ctx.today < dueOn) continue
    out.push(
      build(
        {
          rule: 'delivered_not_invoiced',
          subjectId: o.id,
          tab: tabFor('delivered_not_invoiced'),
          title,
          ref: orderRef(o.number),
          party: o.customerName,
          actionDueOn: dueOn,
          badge: dueBadge(dueOn, ctx.today, 'delivered_not_invoiced'),
          isPriority: false,
          orderId: o.id,
          ...(o.legacy ? { imported: true } : {}),
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
        ref: 'Lock a month',
        party: `${name} ${ctx.monthEnd.month.slice(0, 4)}`,
        actionDueOn: `${today1(ctx.today)}`, // the 1st of the month it is shown in; always shown as ready to move
        group: 'ready',
        badge: { text: n > 0 ? `${n}` : 'ready', tone: 'neutral' },
        isPriority: false,
        // the month-end checklist for that month (it was /money, which opened the GST register: audit A5)
        href: `/money/month-end?month=${ctx.monthEnd.month.slice(0, 7)}`,
        number: 0,
      },
      ctx.today,
    ),
  ]
}

// ---------------------------------------------------------------- M08: the other money rules
//
// Each of these is ONE rolled-up item, never one per invoice or order: the work is a batch screen (the register, the
// margins list, the expenses list), the item says how many and opens it, and a snooze hides the whole thing. That keeps a
// cutover with a pile of old rows from filling the list (the old CRM was abandoned for nagging). Engineers never get any
// of them: the money facts are not even requested for an engineer, and each rule also refuses the role itself.

/** Stable uuids for the polymorphic snoozes.subject_id of a rolled-up rule (one subject per rule). */
export const ROLLUP_SUBJECT: Record<'costs_incomplete' | 'fbr_attention' | 'tcs_not_sent', string> = {
  costs_incomplete: '00000000-0000-4000-8000-00000000c057',
  fbr_attention: '00000000-0000-4000-8000-00000000fb21',
  tcs_not_sent: '00000000-0000-4000-8000-00000000ac50',
}

/** The recurring item is one per month, so a snooze or a change of month starts it afresh. */
export function recurringSubjectId(today: string): string {
  return `00000000-0000-4000-8000-${today.slice(0, 7).replace('-', '').padStart(12, 'e')}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Costs incomplete (admin only): orders that are paid in full but whose costs are still provisional, so their margin is a
 * guess. One item: "Costs not marked complete on n paid orders". Excluded: cancelled orders and orders whose basis is
 * unknown (their margin is excluded anyway).
 */
export function ruleCostsIncomplete(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'admin') return []
  // A settled imported order is history (redesign phase 0): its costs were kept in the old CRM, so it is never chased for them here.
  const rows = (ctx.costs ?? []).filter(c => c.paymentState === 'settled' && c.costsState === 'provisional' && !c.basisUnknown && !c.cancelled && !c.legacy)
  if (rows.length === 0) return []
  const noExpected = rows.filter(c => c.expectedCost === null).length
  const oldest = rows.reduce((a, b) => (a.orderNumber <= b.orderNumber ? a : b))
  return [
    build(
      {
        rule: 'costs_incomplete',
        subjectId: ROLLUP_SUBJECT.costs_incomplete,
        tab: tabFor('costs_incomplete'),
        title: `Margin not final on ${plural(rows.length, 'paid order', 'paid orders')}`,
        ref: 'Margins',
        party: noExpected > 0 ? `${noExpected} with no expected cost` : `Oldest ${orderRef(oldest.orderNumber)}`,
        actionDueOn: null,
        group: 'ready',
        badge: { text: String(rows.length), tone: 'neutral' },
        isPriority: false,
        href: '/money/margins?filter=paid-provisional',
        number: 0,
      },
      ctx.today,
    ),
  ]
}

/**
 * FBR attention (admin and sales): invoices whose tax is not deposited and whose month is over, or where a later FBR step
 * was recorded without the one before it (the register's "needs attention", ported from needsFbrAttention). One item.
 */
export function ruleFbrAttention(ctx: TodayInputs): Entry[] {
  if (ctx.user.role === 'engineer') return []
  const rows = (ctx.invoices ?? []).filter(i => i.needsFbrAttention || i.fbrException)
  if (rows.length === 0) return []
  const exceptions = rows.filter(i => i.fbrException).length
  const dated = rows.map(i => i.invoiceDate).filter((d): d is string => Boolean(d)).sort()
  const oldest = dated[0] ?? null
  return [
    build(
      {
        rule: 'fbr_attention',
        subjectId: ROLLUP_SUBJECT.fbr_attention,
        tab: tabFor('fbr_attention'),
        title: `FBR: ${plural(rows.length, 'invoice needs', 'invoices need')} attention`,
        ref: 'Invoices',
        party: exceptions > 0 ? `${plural(exceptions, 'step', 'steps')} recorded out of order` : oldest ? `Oldest ${MONTH_NAMES[Number(oldest.slice(5, 7)) - 1]} ${oldest.slice(0, 4)}` : 'Tax not deposited',
        actionDueOn: null,
        group: 'ready',
        badge: { text: String(rows.length), tone: 'warning' },
        isPriority: false,
        href: '/money/gst-register?attention=1',
        number: 0,
      },
      ctx.today,
    ),
  ]
}

/**
 * TCS not sent (admin and sales): invoices from the last 60 days with no courier date, three working days after the
 * invoice date. The courier steps "copy received" and "delivered" are optional (A3), so only "sent" is read. One item.
 */
export function ruleTcsNotSent(ctx: TodayInputs): Entry[] {
  if (ctx.user.role === 'engineer') return []
  const earliest = addDays(ctx.today, -THRESHOLDS.tcsWindowDays) ?? ctx.today
  const rows = (ctx.invoices ?? []).filter(i => {
    if (!i.invoiceDate || (i.courierState !== 'not_started' && i.courierState !== 'copy_received')) return false
    return i.invoiceDate >= earliest && ctx.today >= addBusinessDays(i.invoiceDate, THRESHOLDS.tcsSendDays)
  })
  if (rows.length === 0) return []
  const oldest = rows.map(i => i.invoiceDate as string).sort()[0]
  const late = Math.max(0, daysBetween(oldest, ctx.today))
  return [
    build(
      {
        rule: 'tcs_not_sent',
        subjectId: ROLLUP_SUBJECT.tcs_not_sent,
        tab: tabFor('tcs_not_sent'),
        title: `${plural(rows.length, 'invoice', 'invoices')} not posted`,
        ref: 'Invoices',
        party: `Oldest invoice ${late} ${late === 1 ? 'day' : 'days'} ago`,
        actionDueOn: null,
        group: 'ready',
        badge: { text: String(rows.length), tone: 'neutral' },
        isPriority: false,
        href: '/money/gst-register?tcs=1',
        number: 0,
      },
      ctx.today,
    ),
  ]
}

/**
 * Recurring due (admin only): active templates, started, with no expense yet for this month, whose day of the month has
 * come (a template with no day is due from the 1st). One item per month; it is dated the earliest of those days, so it
 * turns "overdue or due today" once a day has passed. Recording them is one tap each on the Expenses screen.
 */
export function ruleRecurringDue(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'admin') return []
  const period = ctx.today.slice(0, 7)
  const day = parseDay(ctx.today)?.d ?? 0
  const due = (ctx.recurring ?? []).filter(t => t.active && !t.recorded && (!t.startMonth || t.startMonth <= (t.period ?? period)) && (t.dayOfMonth ?? 1) <= day)
  if (due.length === 0) return []
  const firstDay = Math.min(...due.map(t => t.dayOfMonth ?? 1))
  const actionOn = `${period}-${String(firstDay).padStart(2, '0')}`
  const labels = due.map(t => t.label).sort()
  return [
    build(
      {
        rule: 'recurring_due',
        subjectId: recurringSubjectId(ctx.today),
        tab: tabFor('recurring_due'),
        title: `${plural(due.length, 'recurring expense', 'recurring expenses')} to record`,
        ref: 'Expenses',
        party: labels.length > 3 ? `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more` : labels.join(', '),
        actionDueOn: actionOn,
        badge: dueBadge(actionOn, ctx.today, 'recurring_due'),
        isPriority: false,
        href: '/money/expenses',
        number: 0,
      },
      ctx.today,
    ),
  ]
}

// ---------------------------------------------------------------- an engineer's own jobs

/**
 * Commissioning soon (engineers): an order the engineer is ASSIGNED to (order_engineers, not ownership) has commissioning planned
 * within the next 5 working days, today, or on a day that has passed without "Mark done". One item per order, dated on the planned
 * day, so it turns red on the day and stays red until it is marked done or moved.
 * Not raised for an order imported from the old CRM or with estimated dates, nor for a planned day more than 30 days ago: the import
 * carries old start dates with no "done", and a cutover must not fill an engineer's list with years-old red items (as M08 avoids).
 */
const stale = (on: string | null, today: string): boolean => !!on && daysBetween(on, today) > THRESHOLDS.jobStaleDays

export function ruleJobCommissioning(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'engineer') return []
  const out: Entry[] = []
  for (const j of ctx.jobs ?? []) {
    if (j.legacy || j.commissioningState !== 'planned' || !j.plannedOn || stale(j.plannedOn, ctx.today)) continue
    if (j.plannedOn > ctx.today && businessDaysBetween(ctx.today, j.plannedOn) > THRESHOLDS.jobAheadDays) continue
    const d = daysBetween(ctx.today, j.plannedOn)
    const title =
      d < 0
        ? `Commissioning was planned for ${longDay(j.plannedOn)}: mark it done or move it`
        : d === 0
          ? 'Commissioning today'
          : d === 1
            ? 'Commissioning tomorrow'
            : `Commissioning on ${longDay(j.plannedOn)}`
    out.push(
      build(
        {
          rule: 'job_commissioning',
          subjectId: j.orderId,
          tab: tabFor('job_commissioning'),
          title,
          ref: orderRef(j.orderNumber),
          party: j.siteName ? `${j.customerName}, ${j.siteName}` : j.customerName,
          actionDueOn: j.plannedOn,
          badge: dueBadge(j.plannedOn, ctx.today, 'job_commissioning'),
          isPriority: false,
          orderId: j.orderId,
          href: `/orders/${j.orderId}`,
          number: j.orderNumber,
          visit: { time: j.visitTime ?? null, type: j.visitType ?? null, customer: j.customerName, site: j.siteName },
        },
        ctx.today,
      ),
    )
  }
  return out
}

/**
 * Goods on site (engineers): on an order the engineer is assigned to, the goods have reached the customer's site (all, or some)
 * and commissioning has no date yet. Always "ready to move", aged from the delivery. An order the engineer also owns already
 * shows "Plan commissioning", so it is not said twice. Imported orders and deliveries more than 30 days old are left out.
 */
export function ruleJobOnSite(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'engineer') return []
  const out: Entry[] = []
  for (const j of ctx.jobs ?? []) {
    if (j.legacy || j.commissioningState !== 'to_plan' || stale(j.deliveredOn, ctx.today)) continue
    if (j.goodsState !== 'delivered' && j.goodsState !== 'partly_delivered') continue
    if (j.ownerId === ctx.user.id) continue
    out.push(
      build(
        {
          rule: 'job_on_site',
          subjectId: j.orderId,
          tab: tabFor('job_on_site'),
          title: j.goodsState === 'delivered' ? 'Goods delivered to site: set the commissioning date' : 'Some goods delivered to site: set the commissioning date',
          ref: orderRef(j.orderNumber),
          party: j.siteName ? `${j.customerName}, ${j.siteName}` : j.customerName,
          actionDueOn: j.deliveredOn,
          group: 'ready',
          badge: ageBadge(j.deliveredOn, ctx.today),
          isPriority: false,
          orderId: j.orderId,
          href: `/orders/${j.orderId}`,
          number: j.orderNumber,
        },
        ctx.today,
      ),
    )
  }
  return out
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

/**
 * Split into the three active groups and the Waiting group, each in list order. Order tasks on an imported order (owner
 * decision 2026-10-22, 1b) go to `imported` instead: out of every group and every count, oldest first, grey, the date in words
 * ("since 3 Jun 2024"), never "757 days overdue". They come back to the list once Review imported (phase 2) marks the order live.
 */
export function groupItems(all: readonly Entry[]): TodayView {
  const imported = all
    .filter(i => i.imported)
    .sort(byDate)
    .map(i => ({ ...i, waiting: undefined, badge: { text: i.actionDueOn ? `since ${formatShortDate(i.actionDueOn, undefined, true)}` : 'Imported', tone: 'neutral' as Tone } }))
  const items = all.filter(i => !i.imported)
  const active = items.filter(i => !i.waiting)
  const sorted = (g: TodayGroup) => active.filter(i => i.group === g).sort(byDate)
  const now = sorted('now')
  const soon = sorted('soon')
  const ready = sorted('ready')
  const waiting = items
    .filter(i => i.waiting)
    .sort((a, b) => (a.waiting!.nextNudgeOn === b.waiting!.nextNudgeOn ? byAge(a, b) : a.waiting!.nextNudgeOn < b.waiting!.nextNudgeOn ? -1 : 1))
  return { now, soon, ready, waiting, active: [...now, ...soon, ...ready], stale: [], imported }
}

/**
 * GST to FBR (redesign phase 3, P3-D; owner default Q8: pay by the 15th, file the return by the 18th). Admin only. ONE chore row for
 * last month's GST, from the 1st until every one of that month's invoices has its tax deposit recorded:
 *   1st to 12th   grey, "Pay by 15 Oct" (in This week, not counted: nothing is due yet)
 *   13th to 15th  amber, the days to the 15th (due today on the 15th, which counts)
 *   after the 15th red, "N days overdue" (the payment day has gone), and it still says return by the 18th
 * The amount is not worked out here (GST charged less GST paid on purchases is the Money screen's); the row says how many invoices.
 */
export const GST_DAYS = { amberAfter: 12, payBy: 15, returnBy: 18 } as const

export function ruleGstFbr(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'admin' || !ctx.gst || ctx.gst.undeposited === 0) return []
  const day = parseDay(ctx.today)?.d ?? 1
  const month = ctx.today.slice(0, 7)
  const payOn = `${month}-${GST_DAYS.payBy}`
  const returnOn = `${month}-${GST_DAYS.returnBy}`
  const early = day <= GST_DAYS.amberAfter
  const name = MONTH_NAMES[Number(ctx.gst.month.slice(5, 7)) - 1]
  const n = ctx.gst.undeposited
  const due = dueBadge(payOn, ctx.today, 'gst_fbr')
  return [
    build(
      {
        rule: 'gst_fbr',
        subjectId: `00000000-0000-4000-8002-${ctx.gst.month.slice(0, 7).replace('-', '').padStart(12, '0')}`,
        tab: tabFor('gst_fbr'),
        title: `GST to FBR: ${name}, ${n} ${n === 1 ? 'invoice' : 'invoices'} to pay`,
        ref: 'GST to FBR',
        party: `Pay by ${formatShortDate(payOn)} · return by ${formatShortDate(returnOn)}`,
        // grey and ready from the 1st; from the 13th the 15th is its date, so it is due soon, then due, then late
        actionDueOn: early ? today1(ctx.today) : payOn,
        group: early ? 'ready' : groupFor(payOn, ctx.today),
        badge: early ? { text: `Pay by ${formatShortDate(payOn)}`, tone: 'neutral' } : { text: due.text, tone: day > GST_DAYS.payBy ? 'danger' : 'warning' },
        isPriority: false,
        href: '/money/gst-register',
        number: 0,
      },
      ctx.today,
    ),
  ]
}

/** "I paid: N to approve" (0087): engineers' claims waiting for the admin, one weekly-ish row. Admin only. */
export function ruleClaimsToApprove(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'admin' || !ctx.claims || ctx.claims.pending === 0) return []
  const n = ctx.claims.pending
  const since = ctx.claims.oldestOn ?? ctx.today
  return [
    build(
      {
        rule: 'claims_to_approve',
        subjectId: '00000000-0000-4000-8003-000000000001',
        tab: tabFor('claims_to_approve'),
        title: `I paid: ${n} to approve`,
        ref: 'Expense claims',
        party: n === 1 ? 'From an engineer' : 'From engineers',
        actionDueOn: since,
        group: 'now',
        badge: ageBadge(since, ctx.today),
        isPriority: false,
        href: '/money/expenses',
        number: 0,
      },
      ctx.today,
    ),
  ]
}

/**
 * The weekly owner review (redesign phase 3, P3-C1): one row for the admin every Monday, "Weekly review: 7 to decide", that opens
 * /todo/review. Only when there is something to decide. Never for sales or an engineer: the owner decides what is closed as lost.
 */
export function ruleWeeklyReview(ctx: TodayInputs): Entry[] {
  if (ctx.user.role !== 'admin' || !isMonday(ctx.today)) return []
  const n = reviewCount(buildReview(ctx))
  if (n === 0) return []
  return [
    build(
      {
        rule: 'weekly_review',
        subjectId: `00000000-0000-4000-8001-${ctx.today.replace(/-/g, '').padStart(12, '0')}`, // one stable id per Monday, for a snooze
        tab: tabFor('weekly_review'),
        title: `Weekly review: ${n} to decide`,
        ref: 'Weekly review',
        party: 'About 10 minutes',
        actionDueOn: ctx.today,
        group: 'now',
        badge: dueBadge(ctx.today, ctx.today, 'weekly_review'),
        isPriority: false,
        href: '/todo/review',
        number: 0,
      },
      ctx.today,
    ),
  ]
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
  to_source: ruleToSource,
  delivered_not_invoiced: ruleDeliveredNotInvoiced,
  close_month: ruleCloseMonth,
  costs_incomplete: ruleCostsIncomplete,
  fbr_attention: ruleFbrAttention,
  tcs_not_sent: ruleTcsNotSent,
  recurring_due: ruleRecurringDue,
  job_commissioning: ruleJobCommissioning,
  job_on_site: ruleJobOnSite,
  weekly_review: ruleWeeklyReview,
  gst_fbr: ruleGstFbr,
  claims_to_approve: ruleClaimsToApprove,
}

/**
 * The whole Today list for one person on one day: every rule, snoozes subtracted, grouped. Engineers never get a money rule.
 * An item older than 30 days (needsYou.ts isStale; never a late payment) leaves the groups for the grey "Older than 30 days"
 * fold, oldest last, its date in words ("since 31 Jan 2025") and no colour. A Waiting item stays in Waiting: someone chased it.
 */
/**
 * An engineer's list is their jobs and nothing else (redesign phase 7): the two job rules. No sales rule (a supplier chase, "Needs
 * suppliers", a quotation) and no money rule reaches an engineer, even for a record they happen to own. needsYou.ts counts what this
 * view holds, so the engineer's badge says the same.
 */
export const ENGINEER_RULES: readonly RuleKey[] = ['job_commissioning', 'job_on_site']

export function buildToday(ctx: TodayInputs): TodayView {
  const keys = ctx.user.role === 'engineer' ? ENGINEER_RULES : (Object.keys(RULES) as RuleKey[])
  const all = applySnoozes(keys.flatMap(k => RULES[k](ctx)), ctx.snoozes, ctx.today)
  const stale = (i: Entry) => !i.waiting && !i.imported && isStale(i, ctx.today)
  const view = groupItems(all.filter(i => !stale(i)))
  view.stale = all
    .filter(stale)
    .sort((a, b) => ((a.actionDueOn ?? '') === (b.actionDueOn ?? '') ? byAge(a, b) : (a.actionDueOn ?? '') > (b.actionDueOn ?? '') ? -1 : 1))
    .map(i => ({ ...i, badge: { text: sinceWords(i.actionDueOn as string), tone: 'neutral' } }))
  return view
}

/** Which top-bar destination counts an item: every Today item belongs to exactly one, so the nav numbers add up to Today's. */
export type NavSection = 'rfqs' | 'orders' | 'money'

/**
 * The nav partition (consistency spec 2.3), by rule so it never depends on which ids an item happens to carry:
 *   money   the money tab (payment overdue, delivered not invoiced, close month, costs, FBR, TCS, recurring);
 *   orders  the order rules (goods late, place PO, plan commissioning, to source, the engineer's job rules);
 *   rfqs    the rest (chase customer, relay answers, not floated, chase supplier, quotation due, decision overdue).
 */
export const NAV_SECTION: Record<RuleKey, NavSection> = {
  chase_customer: 'rfqs',
  relay_answers: 'rfqs',
  not_floated: 'rfqs',
  chase_supplier: 'rfqs',
  bid_due: 'rfqs',
  decision_overdue: 'rfqs',
  payment_overdue: 'money',
  goods_late: 'orders',
  place_po: 'orders',
  plan_commissioning: 'orders',
  to_source: 'orders',
  delivered_not_invoiced: 'money',
  close_month: 'money',
  costs_incomplete: 'money',
  fbr_attention: 'money',
  tcs_not_sent: 'money',
  recurring_due: 'money',
  job_commissioning: 'orders',
  job_on_site: 'orders',
  weekly_review: 'money', // an admin chore
  gst_fbr: 'money',
  claims_to_approve: 'money',
}

export const navSectionOf = (item: Pick<TodayItem, 'rule'>): NavSection => NAV_SECTION[item.rule]

/** The nudge date of a Waiting row, or null. */
export const returnsOn = (i: Entry): string | null => i.waiting?.nextNudgeOn ?? null

/** Calendar days from a past date to today, for "chased 2 days ago". */
export const daysAgo = (on: string, today: string): number => Math.max(0, daysBetween(on, today))

