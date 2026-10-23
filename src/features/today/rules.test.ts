import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { businessToday } from '@/lib/dates'
import {
  applySnoozes,
  buildToday,
  chaseState,
  closeMonthSubjectId,
  cooldownDays,
  dueBadge,
  groupFor,
  groupItems,
  NAV_SECTION,
  navSectionOf,
  previousMonthStart,
  ruleBidDue,
  ruleChaseCustomer,
  ruleChaseSupplier,
  ruleCloseMonth,
  ruleDecisionOverdue,
  ruleDeliveredNotInvoiced,
  ruleGoodsLate,
  ruleNotFloated,
  rulePaymentOverdue,
  rulePlanCommissioning,
  rulePlacePo,
  ruleRelayAnswers,
  ruleToSource,
  RULES,
  THRESHOLDS,
} from './rules'
import type { ClarificationFact, InquiryFact, LegFact, OrderFact, ReceivableFact, RfqFact, Role, TodayInputs } from './types'

// 2026-11-27 is a Friday.
const TODAY = '2026-11-27'
const ME = 'u-me'
const OTHER = 'u-other'

const rfq = (o: Partial<RfqFact> = {}): RfqFact => ({
  id: 'r1',
  number: 177,
  ownerId: ME,
  companyName: 'Indus Textile Mills',
  customerRef: '74037',
  receivedOn: '2026-11-17',
  dueOn: '2026-12-11',
  dueTime: null,
  quotedOn: null,
  isPriority: false,
  bidState: 'to_bid',
  sourcingState: 'floated_awaiting',
  quotationValidUntil: null,
  ...o,
})
const clar = (o: Partial<ClarificationFact> = {}): ClarificationFact => ({
  id: 'c1',
  rfqId: 'r1',
  question: 'Line size?',
  rfqItemId: null,
  firstAskedOn: '2026-11-20',
  lastAskedOn: '2026-11-20',
  lastAskedAt: '2026-11-20T09:00:00+05:00',
  lastAskedBy: null,
  askCount: 1,
  ...o,
})
const inq = (o: Partial<InquiryFact> = {}): InquiryFact => ({
  id: 'i1',
  rfqId: 'r1',
  supplierId: 's1',
  supplierName: 'Metro Process Controls',
  sentOn: '2026-11-23',
  lastChasedOn: null,
  chaseCount: 0,
  responseState: 'awaiting',
  answersToRelay: 0,
  answeredOn: null,
  replied: 0,
  medianReplyDays: null,
  ...o,
})
const leg = (o: Partial<LegFact> = {}): LegFact => ({
  id: 'l1',
  orderId: 'o1',
  orderNumber: 38,
  ownerId: ME,
  customerName: 'Punjab Cement Ltd',
  supplierName: 'Hengxin',
  reference: '253102',
  orderedOn: '2026-11-10',
  placedOn: '2026-11-12',
  expectedOn: '2026-11-22',
  receivedOn: null,
  deliveredOn: null,
  lastChasedOn: null,
  chaseCount: 0,
  ...o,
})
const ord = (o: Partial<OrderFact> = {}): OrderFact => ({
  id: 'ord1',
  number: 38,
  ownerId: ME,
  customerName: 'Karachi Glassworks',
  orderedOn: '2026-11-10',
  goodsState: 'delivered',
  commissioningState: 'n_a',
  invoicingState: 'not_invoiced',
  unsourced: 0,
  toInvoice: null,
  lastInvoicedOn: null,
  deliveredOn: '2026-11-20',
  ...o,
})
const rec = (o: Partial<ReceivableFact> = {}): ReceivableFact => ({
  orderId: 'o1',
  orderNumber: 31,
  ownerId: ME,
  customerName: 'Karachi Glassworks',
  balance: 1_244_310,
  settled: 0,
  dueOn: '2026-11-15',
  isOverdue: true,
  lastRemindedOn: null,
  reminderCount: 0,
  ...o,
})

const roles: Record<string, Role> = { [ME]: 'sales', [OTHER]: 'sales', 'u-admin': 'admin', 'u-eng': 'engineer' }
const ctx = (o: Partial<TodayInputs> = {}, role: Role = 'sales'): TodayInputs => ({
  today: TODAY,
  user: { id: ME, role },
  roleOf: id => (id ? (roles[id] ?? null) : null),
  rfqs: [],
  clarifications: [],
  inquiries: [],
  legs: [],
  orders: [],
  receivables: [],
  monthEnd: null,
  snoozes: [],
  ...o,
})

describe('helpers', () => {
  it('dueBadge words the distance, and is red only for late money or a slipped promise to a customer (redesign phase 0)', () => {
    expect(dueBadge('2026-11-15', TODAY, 'bid_due')).toEqual({ text: '12 days overdue', tone: 'danger' })
    expect(dueBadge('2026-11-15', TODAY, 'payment_overdue')).toEqual({ text: '12 days overdue', tone: 'danger' })
    expect(dueBadge('2026-11-15', TODAY, 'chase_supplier')).toEqual({ text: '12 days overdue', tone: 'warning' })
    expect(dueBadge(TODAY, TODAY, 'bid_due')).toEqual({ text: 'Due today', tone: 'warning' })
    expect(dueBadge('2026-11-28', TODAY, 'bid_due')).toEqual({ text: 'Due tomorrow', tone: 'warning' })
    expect(dueBadge('2026-12-01', TODAY, 'bid_due')).toEqual({ text: 'Due in 4 days', tone: 'neutral' })
    // past 30 days: a date, not a count, and no colour; a late payment stays red
    expect(dueBadge('2024-03-07', TODAY, 'bid_due')).toEqual({ text: 'since 7 Mar 2024', tone: 'neutral' })
    expect(dueBadge('2026-06-01', TODAY, 'payment_overdue')).toEqual({ text: 'since 1 Jun 2026', tone: 'danger' })
  })
  it('groups by the date', () => {
    expect(groupFor('2026-11-26', TODAY)).toBe('now')
    expect(groupFor(TODAY, TODAY)).toBe('now')
    expect(groupFor('2026-11-28', TODAY)).toBe('soon')
    expect(groupFor('2026-12-04', TODAY)).toBe('soon') // 5 working days: Mon to Fri
    expect(groupFor('2026-12-07', TODAY)).toBe('ready') // 6 working days
    expect(groupFor(null, TODAY)).toBe('ready')
  })
  it('shortens the wait when the bid is due within three working days, and only then', () => {
    expect(cooldownDays(3, '2026-12-01', TODAY)).toBe(1)
    expect(cooldownDays(3, '2026-12-11', TODAY)).toBe(3)
    expect(cooldownDays(3, null, TODAY)).toBe(3)
    expect(cooldownDays(2, '2026-12-01', TODAY)).toBe(1)
  })
  it('chaseState: active on the threshold date, waiting before it if chased, hidden if never chased', () => {
    const base = { lastTouchOn: '2026-11-25', waitDays: 3 } // Wed + 3 working days = Mon 30
    expect(chaseState({ ...base, chased: true, today: '2026-11-27' })).toEqual({ state: 'waiting', nextNudgeOn: '2026-11-30' })
    expect(chaseState({ ...base, chased: false, today: '2026-11-27' }).state).toBe('hidden')
    expect(chaseState({ ...base, chased: true, today: '2026-11-30' }).state).toBe('active')
    expect(chaseState({ ...base, chased: true, today: '2026-12-02' }).state).toBe('active')
  })
  it('the close-month subject id is stable and a uuid', () => {
    expect(closeMonthSubjectId('2026-10-01')).toBe('00000000-0000-4000-8000-000000202610')
    expect(closeMonthSubjectId('2026-10-01')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(previousMonthStart('2026-11-05')).toBe('2026-10-01')
    expect(previousMonthStart('2027-01-03')).toBe('2026-12-01')
  })
})

describe('rule: chase customer', () => {
  it('is due 3 working days after the last ask and says which RFQ', () => {
    const c = ctx({ rfqs: [rfq()], clarifications: [clar({ lastAskedOn: '2026-11-24' })] }) // Tue + 3 = Fri 27
    const [e] = ruleChaseCustomer(c)
    expect(e).toMatchObject({ rule: 'chase_customer', key: 'chase_customer:r1', title: 'Chase customer for clarifications', ref: 'RFQ-0177', party: 'Indus Textile Mills', rfqId: 'r1' })
    expect(e.waiting).toBeUndefined()
  })
  it('waits (shown in Waiting with its return date) when asked more recently', () => {
    const [e] = ruleChaseCustomer(ctx({ rfqs: [rfq()], clarifications: [clar({ lastAskedOn: '2026-11-26' })] }))
    expect(e.waiting).toEqual({ chasedOn: '2026-11-26', nextNudgeOn: '2026-12-01' })
    expect(e.waitingTitle).toBe('Customer chased')
  })
  it('is due after one working day when the bid is within three working days', () => {
    const [e] = ruleChaseCustomer(ctx({ rfqs: [rfq({ dueOn: '2026-12-01' })], clarifications: [clar({ lastAskedOn: '2026-11-26' })] }))
    expect(e.waiting).toBeUndefined()
    const [w] = ruleChaseCustomer(ctx({ rfqs: [rfq({ dueOn: '2026-12-01' })], clarifications: [clar({ lastAskedOn: '2026-11-27' })] }))
    expect(w.waiting?.nextNudgeOn).toBe('2026-11-30')
  })
  it('uses the latest ask across the questions and the highest count', () => {
    const [e] = ruleChaseCustomer(
      ctx({ rfqs: [rfq()], clarifications: [clar({ lastAskedOn: '2026-11-20', askCount: 1 }), clar({ id: 'c2', lastAskedOn: '2026-11-26', askCount: 3 })] }),
    )
    expect(e.waiting?.chasedOn).toBe('2026-11-26')
    expect(e.escalation).toBe('close_no_reply')
  })
  it('suggests closing only from the third ask (never closes by itself)', () => {
    const at = (n: number) => ruleChaseCustomer(ctx({ rfqs: [rfq()], clarifications: [clar({ askCount: n })] }))[0]
    expect(at(2).escalation).toBeUndefined()
    expect(at(THRESHOLDS.customerEscalationAsks).escalation).toBe('close_no_reply')
  })
  it('is not raised without open asked questions, after the bid went out, or for another owner', () => {
    expect(ruleChaseCustomer(ctx({ rfqs: [rfq()] }))).toEqual([])
    expect(ruleChaseCustomer(ctx({ rfqs: [rfq({ bidState: 'bid_sent' })], clarifications: [clar()] }))).toEqual([])
    expect(ruleChaseCustomer(ctx({ rfqs: [rfq({ ownerId: OTHER })], clarifications: [clar()] }))).toEqual([])
  })
  it('routes an ownerless RFQ to admin only', () => {
    const inputs = { rfqs: [rfq({ ownerId: null })], clarifications: [clar()] }
    expect(ruleChaseCustomer(ctx(inputs, 'admin'))).toHaveLength(1)
    expect(ruleChaseCustomer(ctx(inputs, 'sales'))).toHaveLength(0)
  })
})

describe('collision line (O-3)', () => {
  it('a customer chase made by a colleague carries who and when; one made by you carries nothing', () => {
    const theirs = ruleChaseCustomer(ctx({ rfqs: [rfq()], clarifications: [clar({ lastAskedOn: '2026-11-26', lastAskedAt: '2026-11-26T09:00:00+05:00', lastAskedBy: OTHER, askCount: 2 })] }))[0]
    expect(theirs.collision).toEqual({ by: OTHER, at: '2026-11-26T09:00:00+05:00' })
    const mine = ruleChaseCustomer(ctx({ rfqs: [rfq()], clarifications: [clar({ lastAskedOn: '2026-11-26', lastAskedBy: ME })] }))[0]
    expect(mine.collision).toBeUndefined()
    const none = ruleChaseCustomer(ctx({ rfqs: [rfq()], clarifications: [clar({ lastAskedOn: '2026-11-26' })] }))[0]
    expect(none.collision).toBeUndefined()
  })
  it('a supplier chase and a goods chase carry it too', () => {
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-10', lastChasedOn: '2026-11-26', chaseCount: 1, lastChasedBy: OTHER })] }))[0].collision).toEqual({ by: OTHER, at: '2026-11-26' })
    expect(ruleGoodsLate(ctx({ legs: [leg({ lastChasedOn: '2026-11-26', chaseCount: 1, lastChasedBy: OTHER })] }))[0].collision).toEqual({ by: OTHER, at: '2026-11-26' })
  })
})

describe('rule: relay answers', () => {
  it('names the count and the supplier', () => {
    const [e] = ruleRelayAnswers(ctx({ rfqs: [rfq()], inquiries: [inq({ answersToRelay: 3, supplierName: 'Beli Valves' })] }))
    expect(e).toMatchObject({ rule: 'relay_answers', title: 'Answer received on 3 questions: send it to Beli Valves', subjectId: 'i1', inquiryId: 'i1' })
    expect(ruleRelayAnswers(ctx({ rfqs: [rfq()], inquiries: [inq({ answersToRelay: 1 })] }))[0].title).toContain('1 question:')
  })
  it('is not raised with nothing to relay or for another owner', () => {
    expect(ruleRelayAnswers(ctx({ rfqs: [rfq()], inquiries: [inq()] }))).toEqual([])
    expect(ruleRelayAnswers(ctx({ rfqs: [rfq({ ownerId: OTHER })], inquiries: [inq({ answersToRelay: 2 })] }))).toEqual([])
  })
})

describe('rule: not floated', () => {
  it('is raised for an open RFQ nobody has been asked about', () => {
    const [e] = ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'not_floated' })] }))
    expect(e).toMatchObject({ rule: 'not_floated', title: 'Needs suppliers', ref: 'RFQ-0177' })
  })
  it('is not raised once floated, or once the bid is out', () => {
    expect(ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'floated_awaiting' })] }))).toEqual([])
    expect(ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'not_floated', bidState: 'bid_sent' })] }))).toEqual([])
  })
  it('without a bid date shows its age instead', () => {
    const [e] = ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'not_floated', dueOn: null })] }))
    expect(e.actionDueOn).toBe('2026-11-17') // due the day it arrived
    expect(e.badge).toEqual({ text: '10 days overdue', tone: 'warning' }) // our own pace: amber, never red
    expect(e.group).toBe('now')
  })
})

describe('rule: chase supplier', () => {
  it('is due 2 working days after the send when the supplier has no reply history', () => {
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-25' })] }))[0]?.waiting).toBeUndefined() // Wed + 2 = Fri
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-26' })] }))).toEqual([]) // not due, never chased: nothing shown
  })
  it('uses the supplier\'s own median plus one once it has 3 replies', () => {
    const slow = { replied: 3, medianReplyDays: 4 } // wait 5 working days
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-23', ...slow })] }))).toEqual([]) // Mon + 5 = Mon 30
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-20', ...slow })] }))).toHaveLength(1) // Fri + 5 = Fri 27
    // two replies are too few to trust the median
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-23', replied: 2, medianReplyDays: 9 })] }))).toHaveLength(1)
  })
  it('measures from the last chase, and a chased supplier waits with its return date', () => {
    const [e] = ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-16', lastChasedOn: '2026-11-26', chaseCount: 1 })] }))
    expect(e.waiting).toEqual({ chasedOn: '2026-11-26', nextNudgeOn: '2026-11-30' }) // 2 working days: Fri, Mon
    expect(e.waitingTitle).toBe('Supplier chased')
  })
  it('names the supplier, not the customer', () => {
    const [e] = ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-20' })] }))
    expect(e.party).toBe('Metro Process Controls')
  })
  it('is due again at once when the reply-by date has passed without a chase since', () => {
    // bid due Tue 1 Dec: reply-by = Fri 27 Nov (2 working days before = Thu 26? computed by supplierReplyBy), sent Mon 23.
    const r = rfq({ dueOn: '2026-11-30' })
    const quiet = inq({ sentOn: '2026-11-25', lastChasedOn: '2026-11-26', chaseCount: 1 })
    // chased yesterday, bid within 3 days: wait 1 working day, so due today anyway
    expect(ruleChaseSupplier(ctx({ rfqs: [r], inquiries: [quiet] }))[0].waiting).toBeUndefined()
  })
  it('the reply-by date alone makes it due, even while the (slow supplier\'s) cooldown has not passed', () => {
    // Sent Thu 19 Nov, bid due Wed 25 Nov: reply-by = Mon 23 Nov. A supplier with a 9-day median waits 10 working days
    // (Thu 3 Dec), so only the passed reply-by date can raise it today (Fri 27).
    const r = rfq({ dueOn: '2026-11-25' })
    const slow = inq({ sentOn: '2026-11-19', replied: 3, medianReplyDays: 9 })
    const [e] = ruleChaseSupplier(ctx({ rfqs: [r], inquiries: [slow] }))
    expect(e?.waiting).toBeUndefined()
    expect(e?.actionDueOn).toBe('2026-11-23')
    // chased after the reply-by date: back to the cooldown, so it waits
    const [w] = ruleChaseSupplier(ctx({ rfqs: [r], inquiries: [{ ...slow, lastChasedOn: '2026-11-24', chaseCount: 1 }] }))
    expect(w?.waiting).toBeDefined()
  })
  it('suggests floating elsewhere from the second chase', () => {
    const at = (n: number) => ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-10', lastChasedOn: '2026-11-18', chaseCount: n })] }))[0]
    expect(at(1).escalation).toBeUndefined()
    expect(at(THRESHOLDS.supplierEscalationChases).escalation).toBe('float_elsewhere')
  })
  it('is not raised for a supplier that quoted, declined, or was never sent', () => {
    for (const o of [{ responseState: 'quoted' }, { responseState: 'no_offer' }, { sentOn: null }]) {
      expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-10', ...o })] }))).toEqual([])
    }
  })
})

describe('rule: bid due', () => {
  it('shows a bid due within 5 days and every one that is late', () => {
    const rows = ruleBidDue(
      ctx({ rfqs: [rfq({ id: 'a', number: 1, dueOn: '2026-11-27' }), rfq({ id: 'b', number: 2, dueOn: '2026-11-25' }), rfq({ id: 'c', number: 3, dueOn: '2026-12-02' }), rfq({ id: 'd', number: 4, dueOn: '2026-12-03' })] }),
    )
    expect(rows.map(r => r.subjectId)).toEqual(['a', 'b', 'c'])
    expect(rows.map(r => r.title)).toEqual(['Quotation due today', 'Quotation 2 days overdue', 'Quotation due Wednesday 2 December'])
    expect(rows[0].badge).toEqual({ text: 'Due today', tone: 'warning' })
    expect(rows[1].badge).toEqual({ text: '2 days overdue', tone: 'danger' }) // a promise to the customer that slipped
  })
  it('names the bid time when the RFQ has one (rfqs.due_time)', () => {
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: TODAY, dueTime: '17:00:00' })] }))[0].title).toBe('Quotation due today, 17:00')
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28', dueTime: '12:00:00' })] }))[0].title).toBe('Quotation due tomorrow, 12:00')
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-12-02', dueTime: '09:30:00' })] }))[0].title).toBe('Quotation due Wednesday 2 December, 09:30')
  })
  it('words tomorrow, and skips RFQs already bid, without a date or owned by someone else', () => {
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28' })] }))[0].title).toBe('Quotation due tomorrow')
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28', bidState: 'bid_sent' })] }))).toEqual([])
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: null })] }))).toEqual([])
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28', ownerId: OTHER })] }))).toEqual([])
  })
})

describe('rule: decision overdue', () => {
  it('is raised 10 working days after the bid went out', () => {
    // Fri 13 Nov + 10 working days = Fri 27 Nov
    const [e] = ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'bid_sent', quotedOn: '2026-11-13' })] }))
    expect(e).toMatchObject({ rule: 'decision_overdue', title: 'No decision yet: quotation sent 14 days ago', group: 'now' })
    expect(ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'bid_sent', quotedOn: '2026-11-16' })] }))).toEqual([])
  })
  it('is raised when the quotation expired', () => {
    const [e] = ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'quotation_expired', quotedOn: '2026-10-01', quotationValidUntil: '2026-11-20' })] }))
    expect(e.title).toBe('Quotation expired: check prices before you revise it')
    expect(e.badge.text).toBe('7 days overdue')
  })
  it('is not raised for a bid still to send', () => {
    expect(ruleDecisionOverdue(ctx({ rfqs: [rfq()] }))).toEqual([])
  })
})

describe('rule: payment overdue (admin and sales only)', () => {
  it('is raised for an overdue order that was never reminded, with the days late', () => {
    const [e] = rulePaymentOverdue(ctx({ receivables: [rec()] }))
    expect(e).toMatchObject({ rule: 'payment_overdue', title: 'Payment 12 days overdue', ref: 'ORD-0031', party: 'Karachi Glassworks', orderId: 'o1', group: 'now' })
    expect(e.badge).toEqual({ text: '12 days overdue', tone: 'danger' })
  })
  it('is never produced for an engineer', () => {
    expect(rulePaymentOverdue(ctx({ receivables: [rec()] }, 'engineer'))).toEqual([])
  })
  it('is not raised when the order is not overdue or owes nothing', () => {
    expect(rulePaymentOverdue(ctx({ receivables: [rec({ isOverdue: false })] }))).toEqual([])
    expect(rulePaymentOverdue(ctx({ receivables: [rec({ balance: 0 })] }))).toEqual([])
  })
  it('after a reminder waits 7 working days and then returns', () => {
    const waiting = rulePaymentOverdue(ctx({ receivables: [rec({ lastRemindedOn: '2026-11-25', reminderCount: 1 })] }))[0]
    expect(waiting.waiting).toEqual({ chasedOn: '2026-11-25', nextNudgeOn: '2026-12-04' })
    const back = rulePaymentOverdue(ctx({ today: '2026-12-04', receivables: [rec({ lastRemindedOn: '2026-11-25', reminderCount: 1 })] }))[0]
    expect(back.waiting).toBeUndefined()
  })
  it('routes to the sales owner, and to admin only when the owner is not sales', () => {
    const mine = rec({ ownerId: ME })
    const theirs = rec({ ownerId: OTHER })
    const engineers = rec({ ownerId: 'u-eng' })
    const adminOwned = rec({ ownerId: 'u-admin' })
    expect(rulePaymentOverdue(ctx({ receivables: [mine, theirs, engineers] }, 'sales'))).toHaveLength(1)
    expect(rulePaymentOverdue(ctx({ receivables: [mine, theirs, engineers, adminOwned, rec({ ownerId: null })] }, 'admin')).map(e => e.subjectId)).toHaveLength(3)
  })
})

describe('rule: goods late', () => {
  it('is raised when the expected date passed and nothing arrived, and says "PO <reference>"', () => {
    const [e] = ruleGoodsLate(ctx({ legs: [leg()] }))
    expect(e).toMatchObject({ rule: 'goods_late', title: 'Goods 5 days late from supplier', ref: 'PO 253102', party: 'Hengxin', legId: 'l1' })
    expect(ruleGoodsLate(ctx({ legs: [leg({ reference: null })] }))[0].ref).toBe('ORD-0038')
    expect(ruleGoodsLate(ctx({ legs: [leg({ reference: 'PO 253102' })] }))[0].ref).toBe('PO 253102')
    expect(ruleGoodsLate(ctx({ legs: [leg({ reference: 'POLEQWPA' })] }))[0].ref).toBe('PO POLEQWPA') // a reference that merely starts with PO keeps it
  })
  it('is not raised for goods delivered, on time, or not yet placed (delivered is the only end state; received_on follows it)', () => {
    expect(ruleGoodsLate(ctx({ legs: [leg({ deliveredOn: '2026-11-25' })] }))).toEqual([])
    expect(ruleGoodsLate(ctx({ legs: [leg({ expectedOn: '2026-11-27' })] }))).toEqual([])
    expect(ruleGoodsLate(ctx({ legs: [leg({ placedOn: null })] }))).toEqual([])
  })
  it('is available to engineers (goods are not money) and routes to the order owner', () => {
    expect(ruleGoodsLate(ctx({ legs: [leg({ ownerId: ME })] }, 'engineer'))).toHaveLength(1)
    expect(ruleGoodsLate(ctx({ legs: [leg({ ownerId: OTHER })] }))).toEqual([])
  })
  it('waits 3 working days after a chase', () => {
    const [e] = ruleGoodsLate(ctx({ legs: [leg({ lastChasedOn: '2026-11-26', chaseCount: 1 })] }))
    expect(e.waiting).toEqual({ chasedOn: '2026-11-26', nextNudgeOn: '2026-12-01' })
    expect(e.waitingTitle).toBe('Supplier chased for goods')
  })
})

describe('rule: place PO', () => {
  it('is raised for a leg with no placed date, as ready to move, with its age', () => {
    const [e] = rulePlacePo(ctx({ legs: [leg({ placedOn: null, expectedOn: null })] }))
    expect(e).toMatchObject({ rule: 'place_po', title: 'Place PO with Hengxin', ref: 'ORD-0038', group: 'ready' })
    expect(e.badge.text).toBe('17 days old')
  })
  it('is not raised once placed or for another owner; engineers do see it', () => {
    expect(rulePlacePo(ctx({ legs: [leg()] }))).toEqual([])
    expect(rulePlacePo(ctx({ legs: [leg({ placedOn: null, ownerId: OTHER })] }))).toEqual([])
    expect(rulePlacePo(ctx({ legs: [leg({ placedOn: null })] }, 'engineer'))).toHaveLength(1)
  })
})

describe('rule: to source (a won order with items that have no supplier)', () => {
  const toSource = (o: Partial<OrderFact> = {}) => ord({ goodsState: 'to_source', unsourced: 3, invoicingState: null, ...o })
  it('says how many items still need a supplier, as ready to move with the order age', () => {
    const [e] = ruleToSource(ctx({ orders: [toSource()] }))
    expect(e).toMatchObject({ rule: 'to_source', title: '3 items still need a supplier', ref: 'ORD-0038', party: 'Karachi Glassworks', group: 'ready', tab: 'sourcing', orderId: 'ord1', href: '/orders/ord1' })
    expect(e.badge.text).toBe('17 days old')
    expect(ruleToSource(ctx({ orders: [toSource({ unsourced: 1 })] }))[0].title).toBe('1 item still needs a supplier')
  })
  it('is not raised once every item has a leg, for services-only orders, or when the count is zero', () => {
    for (const goodsState of ['to_place', 'on_order', 'delivered', 'n_a']) expect(ruleToSource(ctx({ orders: [toSource({ goodsState })] }))).toEqual([])
    expect(ruleToSource(ctx({ orders: [toSource({ unsourced: 0 })] }))).toEqual([])
  })
  it('sales: only their own orders', () => {
    expect(ruleToSource(ctx({ orders: [toSource()] }, 'sales'))).toHaveLength(1)
    expect(ruleToSource(ctx({ orders: [toSource({ ownerId: OTHER })] }, 'sales'))).toEqual([])
    expect(ruleToSource(ctx({ orders: [toSource({ ownerId: null })] }, 'sales'))).toEqual([])
  })
  it('admin: ownerless orders and their own; not orders owned by others', () => {
    expect(ruleToSource(ctx({ orders: [toSource({ ownerId: null })] }, 'admin'))).toHaveLength(1)
    expect(ruleToSource(ctx({ orders: [toSource({ ownerId: OTHER })] }, 'admin'))).toEqual([])
  })
  it('engineer: sees the orders they own, never orders owned by others', () => {
    const eng = (o: Partial<OrderFact>) => ({ ...ctx({ orders: [toSource(o)] }, 'engineer'), user: { id: 'u-eng', role: 'engineer' as Role } })
    expect(ruleToSource(eng({ ownerId: 'u-eng' }))).toHaveLength(1)
    expect(ruleToSource(eng({ ownerId: ME }))).toEqual([])
  })
  it('can be snoozed, and never raises the money rules', () => {
    const v = buildToday(ctx({ orders: [toSource()], snoozes: [{ rule: 'to_source', subjectId: 'ord1', untilOn: '2026-12-01' }] }))
    expect(v.active).toEqual([])
    expect(buildToday(ctx({ orders: [toSource()] })).active.map(i => i.rule)).toEqual(['to_source'])
  })
})

describe('rule: close month (admin only, 1st to 10th)', () => {
  const me = { month: '2026-10-01', checks: 4, closed: false }
  it('says how many checks and is one item', () => {
    const [e, ...rest] = ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: me }, 'admin'))
    expect(rest).toEqual([])
    expect(e).toMatchObject({ rule: 'close_month', title: 'Close October: 4 checks', group: 'ready', subjectId: '00000000-0000-4000-8000-000000202610' })
    expect(ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: { ...me, checks: 1 } }, 'admin'))[0].title).toBe('Close October: 1 check')
  })
  it('shows on the 1st through the 10th and not on the 11th, or before', () => {
    expect(ruleCloseMonth(ctx({ today: '2026-11-01', monthEnd: me }, 'admin'))).toHaveLength(1)
    expect(ruleCloseMonth(ctx({ today: '2026-11-10', monthEnd: me }, 'admin'))).toHaveLength(1)
    expect(ruleCloseMonth(ctx({ today: '2026-11-11', monthEnd: me }, 'admin'))).toEqual([])
    expect(ruleCloseMonth(ctx({ today: '2026-10-31', monthEnd: { ...me, month: '2026-09-01' } }, 'admin'))).toEqual([])
  })
  it('is admin only, and gone once the month is closed', () => {
    expect(ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: me }, 'sales'))).toEqual([])
    expect(ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: me }, 'engineer'))).toEqual([])
    expect(ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: { ...me, closed: true } }, 'admin'))).toEqual([])
  })
  it('is for the previous month only', () => {
    expect(ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: { ...me, month: '2026-09-01' } }, 'admin'))).toEqual([])
  })
  it('opens the month-end checklist for that month, not the Money landing (audit A5)', () => {
    expect(ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: me }, 'admin'))[0].href).toBe('/money/month-end?month=2026-10')
  })
})

describe('snoozes', () => {
  const items = ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28' })] }))
  it('hide an item until their date and bring it back on that date', () => {
    const snooze = { rule: 'bid_due', subjectId: 'r1', untilOn: '2026-11-30' }
    expect(applySnoozes(items, [snooze], '2026-11-27')).toEqual([])
    expect(applySnoozes(items, [snooze], '2026-11-29')).toEqual([])
    expect(applySnoozes(items, [snooze], '2026-11-30')).toHaveLength(1)
  })
  it('are per rule and per subject, so another rule on the same RFQ stays', () => {
    expect(applySnoozes(items, [{ rule: 'chase_supplier_quote', subjectId: 'r1', untilOn: '2026-12-31' }], TODAY)).toHaveLength(1)
    expect(applySnoozes(items, [{ rule: 'bid_due', subjectId: 'r2', untilOn: '2026-12-31' }], TODAY)).toHaveLength(1)
  })
  it('also hide a Waiting item entirely', () => {
    const [w] = ruleChaseCustomer(ctx({ rfqs: [rfq()], clarifications: [clar({ lastAskedOn: '2026-11-26' })] }))
    expect(w.waiting).toBeDefined()
    expect(applySnoozes([w], [{ rule: 'chase_customer_clarification', subjectId: 'r1', untilOn: '2026-12-31' }], TODAY)).toEqual([])
  })
})

describe('the whole list', () => {
  it('groups overdue/today, next 5 days, ready to move and Waiting, in order', () => {
    const v = buildToday(
      ctx(
        {
          rfqs: [
            rfq({ id: 'a', number: 1, dueOn: '2026-11-26' }),
            rfq({ id: 'b', number: 2, dueOn: '2026-11-30' }),
            rfq({ id: 'c', number: 3, dueOn: '2026-12-20', sourcingState: 'not_floated' }),
          ],
          clarifications: [clar({ rfqId: 'b', lastAskedOn: TODAY })],
          legs: [leg({ placedOn: null })],
        },
        'sales',
      ),
    )
    expect(v.now.map(i => i.key)).toEqual(['not_floated:c', 'bid_due:a']) // c arrived 17 Nov and is not floated: due since then
    expect(v.soon.map(i => i.key)).toEqual(['bid_due:b'])
    expect(v.ready.map(i => i.key)).toEqual(['place_po:l1'])
    expect(v.waiting.map(i => i.key)).toEqual(['chase_customer:b'])
    expect(v.active).toHaveLength(4)
  })
  it('sorts by date, then top priority, and puts an undated item last', () => {
    const items = ruleBidDue(
      ctx({ rfqs: [rfq({ id: 'a', number: 1, dueOn: '2026-11-28' }), rfq({ id: 'b', number: 2, dueOn: '2026-11-28', isPriority: true }), rfq({ id: 'c', number: 3, dueOn: '2026-11-27' })] }),
    )
    expect(groupItems(items).active.map(i => i.subjectId)).toEqual(['c', 'b', 'a'])
  })
  it('orders Waiting by return date', () => {
    const w = ruleChaseSupplier(
      ctx({
        rfqs: [rfq({ id: 'a', number: 1 }), rfq({ id: 'b', number: 2 })],
        inquiries: [inq({ id: 'ia', rfqId: 'a', sentOn: '2026-11-20', lastChasedOn: '2026-11-27', chaseCount: 1 }), inq({ id: 'ib', rfqId: 'b', sentOn: '2026-11-20', lastChasedOn: '2026-11-26', chaseCount: 1 })],
      }),
    )
    expect(groupItems(w).waiting.map(i => i.subjectId)).toEqual(['ib', 'ia'])
  })
  it('an engineer never gets a money item, and the empty list is empty', () => {
    const v = buildToday(ctx({ receivables: [rec()], monthEnd: { month: '2026-10-01', checks: 3, closed: false }, today: '2026-11-03' }, 'engineer'))
    expect(v.active).toEqual([])
    expect(v.waiting).toEqual([])
    const a = buildToday(ctx({ receivables: [rec({ ownerId: 'u-eng' })], monthEnd: { month: '2026-10-01', checks: 3, closed: false }, today: '2026-11-03' }, 'admin'))
    expect(a.active.map(i => i.rule).sort()).toEqual(['close_month', 'payment_overdue'])
  })
})

describe('nav partition (consistency spec 2.3)', () => {
  it('every rule maps to exactly one section, and money is the money tab', () => {
    const keys = Object.keys(RULES) as (keyof typeof RULES)[]
    expect(Object.keys(NAV_SECTION).sort()).toEqual([...keys].sort())
    for (const k of keys) expect(['rfqs', 'orders', 'money']).toContain(NAV_SECTION[k])
  })
  it('the section counts add up to the whole active list', () => {
    const v = buildToday(
      ctx(
        {
          rfqs: [rfq({ id: 'a', number: 1, dueOn: '2026-11-26' }), rfq({ id: 'c', number: 3, dueOn: '2026-12-20', sourcingState: 'not_floated' })],
          legs: [leg({ placedOn: null })],
          receivables: [rec()],
          monthEnd: { month: '2026-10-01', checks: 3, closed: false },
          today: '2026-11-03',
        },
        'admin',
      ),
    )
    const by = (s: string) => v.active.filter(i => navSectionOf(i) === s).length
    expect(by('rfqs')).toBeGreaterThan(0)
    expect(by('orders')).toBeGreaterThan(0)
    expect(by('money')).toBeGreaterThan(0)
    expect(by('rfqs') + by('orders') + by('money')).toBe(v.active.length)
    for (const i of v.active) expect(navSectionOf(i) === 'money').toBe(i.tab === 'money')
  })
})

// ------------------------------------------------------------------ the fake clock
// R16 acceptance: "With a fake clock, a chased item -> Waiting -> back on the active list on the threshold date.
// Bid due within 3 days shortens the wait."

describe('fake clock: chase, wait, return', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A tiny database: one RFQ with one asked question, and the stamp the "Copy and mark chased" tap makes. */
  function world(dueOn: string | null) {
    const db = { lastAskedOn: '2026-11-18', askCount: 1 }
    const view = () => {
      const today = businessToday() // the real clock helper, driven by the fake timers
      const all = buildToday(ctx({ today, rfqs: [rfq({ dueOn })], clarifications: [clar({ lastAskedOn: db.lastAskedOn, askCount: db.askCount })] }, 'sales'))
      return groupItems([...all.active, ...all.waiting].filter(i => i.rule === 'chase_customer')) // the bid-due item is a different rule
    }
    const stampChase = () => {
      db.lastAskedOn = businessToday()
      db.askCount += 1
    }
    return { view, stampChase }
  }
  const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T10:00:00+05:00`))

  it('a chased item leaves the active list for Waiting and comes back on the threshold date', () => {
    const w = world('2026-12-31') // bid far away: 3 working days
    at('2026-11-27') // Friday
    expect(w.view().active.map(i => i.key)).toEqual(['chase_customer:r1'])

    w.stampChase() // the tap
    const after = w.view()
    expect(after.active).toEqual([])
    expect(after.waiting).toHaveLength(1)
    expect(after.waiting[0].waiting).toEqual({ chasedOn: '2026-11-27', nextNudgeOn: '2026-12-02' }) // Fri + 3 working days = Wed

    for (const day of ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']) {
      at(day)
      expect(w.view().active, day).toEqual([])
      expect(w.view().waiting, day).toHaveLength(1)
    }
    at('2026-12-02') // the threshold date
    const back = w.view()
    expect(back.waiting).toEqual([])
    expect(back.active.map(i => i.key)).toEqual(['chase_customer:r1'])
  })

  it('a bid due within 3 working days shortens the wait to one working day', () => {
    const w = world('2026-12-01') // Tuesday
    at('2026-11-27')
    w.stampChase()
    expect(w.view().waiting[0].waiting?.nextNudgeOn).toBe('2026-11-30') // Monday
    at('2026-11-29')
    expect(w.view().active).toEqual([])
    at('2026-11-30')
    expect(w.view().active.map(i => i.key)).toEqual(['chase_customer:r1'])
  })

  it('the wait shortens by itself as the bid comes close', () => {
    const w = world('2026-12-04') // Friday
    at('2026-11-27') // Fri: bid is 5 working days away, wait 3 -> returns Wed 2 Dec
    w.stampChase()
    expect(w.view().waiting[0].waiting?.nextNudgeOn).toBe('2026-12-02')
    at('2026-12-01') // Tue: bid is 3 working days away, wait 1 -> returns Mon 30 Nov, which has passed
    expect(w.view().active.map(i => i.key)).toEqual(['chase_customer:r1'])
  })

  it('a snooze set today hides the item until its date, then it returns', () => {
    at('2026-11-27')
    const snooze = { rule: 'bid_due', subjectId: 'r1', untilOn: '2026-11-30' }
    const day = () => buildToday(ctx({ today: businessToday(), rfqs: [rfq({ dueOn: '2026-12-01' })], snoozes: [snooze] }, 'sales')).active.filter(i => i.rule === 'bid_due')
    expect(day()).toEqual([])
    at('2026-11-29')
    expect(day()).toEqual([])
    at('2026-11-30')
    expect(day()).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ actionDueOn: the day each rule fired

describe('actionDueOn per rule', () => {
  it('chase customer: the last ask plus the wait (so a 9-day-old ask is long overdue, whatever the bid date)', () => {
    const [e] = ruleChaseCustomer(ctx({ rfqs: [rfq({ dueOn: '2026-12-11' })], clarifications: [clar({ lastAskedOn: '2026-11-18' })] }))
    expect(e.actionDueOn).toBe('2026-11-23') // Wed 18 + 3 working days = Mon 23
    expect(e.group).toBe('now')
    expect(e.badge).toEqual({ text: '4 days overdue', tone: 'warning' })
    // with the bid close the wait is 1 working day
    expect(ruleChaseCustomer(ctx({ rfqs: [rfq({ dueOn: '2026-12-01' })], clarifications: [clar({ lastAskedOn: '2026-11-25' })] }))[0].actionDueOn).toBe('2026-11-26')
  })
  it('chase supplier: the last contact plus the wait, or the send plus the wait when never chased', () => {
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-20' })] }))[0].actionDueOn).toBe('2026-11-24') // Fri + 2
    expect(ruleChaseSupplier(ctx({ rfqs: [rfq()], inquiries: [inq({ sentOn: '2026-11-10', lastChasedOn: '2026-11-20', chaseCount: 1 })] }))[0].actionDueOn).toBe('2026-11-24')
  })
  it('relay answers: the day the customer answered', () => {
    const [e] = ruleRelayAnswers(ctx({ rfqs: [rfq()], inquiries: [inq({ answersToRelay: 2, answeredOn: '2026-11-25' })] }))
    expect(e.actionDueOn).toBe('2026-11-25')
    expect(e.badge).toEqual({ text: '2 days overdue', tone: 'warning' })
  })
  it('not floated: the day the RFQ was received', () => {
    expect(ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'not_floated', receivedOn: '2026-11-27' })] }))[0]).toMatchObject({ actionDueOn: '2026-11-27', group: 'now', badge: { text: 'Due today' } })
  })
  it('bid due: the bid date, in the next 5 working days when ahead', () => {
    const [e] = ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-12-02' })] }))
    expect(e.actionDueOn).toBe('2026-12-02')
    expect(e.group).toBe('soon')
    expect(e.badge.text).toBe('Due in 5 days')
  })
  it('decision overdue: ten working days after the bid; for an expired quotation, the valid-until date', () => {
    expect(ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'bid_sent', quotedOn: '2026-11-13' })] }))[0].actionDueOn).toBe('2026-11-27')
    expect(ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'quotation_expired', quotedOn: '2026-10-01', quotationValidUntil: '2026-11-20' })] }))[0].actionDueOn).toBe('2026-11-20')
  })
  it('payment overdue: the due date for the first reminder, the last reminder plus the cooldown after that', () => {
    expect(rulePaymentOverdue(ctx({ receivables: [rec()] }))[0].actionDueOn).toBe('2026-11-15')
    expect(rulePaymentOverdue(ctx({ receivables: [rec({ lastRemindedOn: '2026-11-10', reminderCount: 1 })] }))[0].actionDueOn).toBe('2026-11-19') // Tue 10 + 7 working days
  })
  it('goods late: the expected date for the first chase, the last chase plus the cooldown after that', () => {
    expect(ruleGoodsLate(ctx({ legs: [leg()] }))[0]).toMatchObject({ actionDueOn: '2026-11-22', badge: { text: '5 days overdue' } })
    expect(ruleGoodsLate(ctx({ legs: [leg({ lastChasedOn: '2026-11-20', chaseCount: 1 })] }))[0].actionDueOn).toBe('2026-11-25')
  })
  it('place PO: the day the order was confirmed, and always ready to move', () => {
    const [e] = rulePlacePo(ctx({ legs: [leg({ placedOn: null, orderedOn: '2026-11-10' })] }))
    expect(e.actionDueOn).toBe('2026-11-10')
    expect(e.group).toBe('ready')
  })
  it('close month: the 1st of the month it is shown in, and always ready to move', () => {
    const [e] = ruleCloseMonth(ctx({ today: '2026-11-05', monthEnd: { month: '2026-10-01', checks: 2, closed: false } }, 'admin'))
    expect(e.actionDueOn).toBe('2026-11-01')
    expect(e.group).toBe('ready')
  })
  it('an overdue chase lands in "overdue or due today" and is counted as due now', () => {
    const v = buildToday(ctx({ rfqs: [rfq({ dueOn: '2026-12-11' })], clarifications: [clar({ lastAskedOn: '2026-11-18' })] }))
    expect(v.now.map(i => i.key)).toEqual(['chase_customer:r1'])
    expect(v.ready).toEqual([])
  })
})

describe('rule: order rules (O05)', () => {
  it('plan commissioning: raised for a to-plan order, routed to its owner, ready to move', () => {
    const [e] = rulePlanCommissioning(ctx({ orders: [ord({ commissioningState: 'to_plan', invoicingState: null })] }))
    expect(e).toMatchObject({ rule: 'plan_commissioning', title: 'Plan commissioning', ref: 'ORD-0038', orderId: 'ord1', group: 'ready' })
    expect(rulePlanCommissioning(ctx({ orders: [ord({ commissioningState: 'planned' })] }))).toEqual([])
    expect(rulePlanCommissioning(ctx({ orders: [ord({ commissioningState: 'done' })] }))).toEqual([])
    expect(rulePlanCommissioning(ctx({ orders: [ord({ commissioningState: 'to_plan', ownerId: OTHER })] }, 'sales'))).toEqual([])
  })
  it('plan commissioning reaches an engineer for their own orders only', () => {
    const o = ord({ commissioningState: 'to_plan', invoicingState: null, ownerId: ME })
    expect(rulePlanCommissioning(ctx({ orders: [o] }, 'engineer'))).toHaveLength(1)
    expect(rulePlanCommissioning(ctx({ orders: [{ ...o, ownerId: OTHER }] }, 'engineer'))).toEqual([])
  })
  it('delivered, not invoiced: due a working day after the last delivery', () => {
    const [e] = ruleDeliveredNotInvoiced(ctx({ orders: [ord()] }))
    expect(e).toMatchObject({ rule: 'delivered_not_invoiced', tab: 'money', ref: 'ORD-0038', actionDueOn: '2026-11-23' })
  })
  it('delivered, not invoiced waits for the goods, skips fully invoiced, and orders with nothing to deliver', () => {
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ commissioningState: 'done' })] }))).toHaveLength(1)
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ goodsState: 'on_order' })] }))).toEqual([])
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ goodsState: 'partly_delivered' })] }))).toEqual([])
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ invoicingState: 'fully_invoiced' })] }))).toEqual([])
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ goodsState: 'n_a', commissioningState: 'n_a' })] }))).toEqual([])
  })
  describe('commissioning not marked done (a missing Mark done must not hide the invoice)', () => {
    const noMark = (o: Partial<OrderFact> = {}) => ord({ commissioningState: 'planned', deliveredOn: '2026-11-25', ...o })
    it('does not fire before the wait, and fires on the fifth working day after the delivery with a title that says so', () => {
      expect(THRESHOLDS.invoiceDespiteCommissioningDays).toBe(5)
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [noMark()] }))).toEqual([]) // delivered Wed 25: due Wed 2 Dec; Fri 27 is early
      const [e] = ruleDeliveredNotInvoiced(ctx({ orders: [noMark()], today: '2026-12-02' }))
      expect(e).toMatchObject({ rule: 'delivered_not_invoiced', title: 'Delivered, not invoiced (commissioning not marked done)', actionDueOn: '2026-12-02', group: 'now' })
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [noMark({ commissioningState: 'to_plan' })], today: '2026-12-03' }))).toHaveLength(1)
    })
    it('marking commissioning done brings back the one-day wait and the plain title', () => {
      const [e] = ruleDeliveredNotInvoiced(ctx({ orders: [noMark({ commissioningState: 'done' })] }))
      expect(e.title).toBe('Delivered, not invoiced')
    })
    it('a service-only order with commissioning not done has no delivery to count from and is not raised', () => {
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [noMark({ goodsState: 'n_a', commissioningState: 'planned', deliveredOn: null })], today: '2026-12-20' }))).toEqual([])
    })
    it('routes as before: the sales owner, else admin, never an engineer', () => {
      const o = noMark()
      const today = '2026-12-03'
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [o], today }, 'sales'))).toHaveLength(1)
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [{ ...o, ownerId: OTHER }], today }, 'sales'))).toEqual([])
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [{ ...o, ownerId: 'u-eng' }], today }, 'admin'))).toHaveLength(1)
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [{ ...o, ownerId: OTHER }], today }, 'admin'))).toEqual([])
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [o], today }, 'engineer'))).toEqual([])
    })
    it('can be snoozed', () => {
      const v = buildToday(ctx({ orders: [noMark()], today: '2026-12-03', snoozes: [{ rule: 'delivered_not_invoiced', subjectId: 'ord1', untilOn: '2026-12-08' }] }))
      expect(v.active).toEqual([])
    })
  })

  describe('part-invoiced orders (the rest is not forgotten)', () => {
    const part = (o: Partial<OrderFact> = {}) => ord({ invoicingState: 'part', toInvoice: 120_500, lastInvoicedOn: '2026-11-20', ...o })
    it('is raised three working days after the last invoice, with the amount still to invoice', () => {
      expect(THRESHOLDS.invoicePartDays).toBe(3)
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [part({ lastInvoicedOn: '2026-11-26' })] }))).toEqual([]) // Thu 26 + 3 = Tue 1 Dec
      const [e] = ruleDeliveredNotInvoiced(ctx({ orders: [part()] }))
      expect(e).toMatchObject({ rule: 'delivered_not_invoiced', title: 'Partly invoiced: PKR 120,500 still to invoice', actionDueOn: '2026-11-25', tab: 'money' })
    })
    it('waits for the goods; a fully invoiced order is never raised', () => {
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [part({ goodsState: 'on_order' })] }))).toEqual([])
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [part({ invoicingState: 'fully_invoiced', toInvoice: null })] }))).toEqual([])
    })
    it('falls back to the delivery date when the last invoice date is unknown, and to a plain line without an amount', () => {
      const [e] = ruleDeliveredNotInvoiced(ctx({ orders: [part({ lastInvoicedOn: null, toInvoice: null })] }))
      expect(e.title).toBe('Partly invoiced: the rest is still to invoice')
      expect(e.actionDueOn).toBe('2026-11-25') // delivered 20 Nov + 3 working days
    })
    it('goes to the sales owner, else admin, never an engineer, and can be snoozed', () => {
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [part()] }, 'sales'))).toHaveLength(1)
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [part({ ownerId: OTHER })] }, 'sales'))).toEqual([])
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [part({ ownerId: 'u-eng' })] }, 'admin'))).toHaveLength(1)
      expect(ruleDeliveredNotInvoiced(ctx({ orders: [part()] }, 'engineer'))).toEqual([])
      expect(buildToday(ctx({ orders: [part()], snoozes: [{ rule: 'delivered_not_invoiced', subjectId: 'ord1', untilOn: '2026-12-01' }] })).active).toEqual([])
    })
  })

  describe('stale legs and orders with no PO', () => {
    it('goods late fires for a leg whose expected date is months past and is not delivered', () => {
      const [e] = ruleGoodsLate(ctx({ legs: [leg({ expectedOn: '2026-08-27' })] }))
      // past 30 days the title names the date, and the badge is grey (buildToday then moves it to the "Older than 30 days" fold)
      expect(e).toMatchObject({ rule: 'goods_late', title: 'Goods late from supplier since 27 Aug 2026', group: 'now' })
      expect(e.badge).toEqual({ text: 'since 27 Aug 2026', tone: 'neutral' })
    })
    it('place PO fires for a won order whose leg has no PO, however old, and not once the PO is placed', () => {
      expect(rulePlacePo(ctx({ legs: [leg({ placedOn: null, orderedOn: '2026-08-01' })] }))[0]).toMatchObject({ rule: 'place_po', group: 'ready' })
      expect(rulePlacePo(ctx({ legs: [leg({ placedOn: '2026-08-02' })] }))).toEqual([])
    })
  })

  it('delivered, not invoiced is never given to an engineer, whoever owns the order or whatever the state says', () => {
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ ownerId: ME })] }, 'engineer'))).toEqual([])
    const v = buildToday(ctx({ orders: [ord({ ownerId: ME })] }, 'engineer'))
    expect([...v.now, ...v.soon, ...v.ready, ...v.waiting].some(i => i.rule === 'delivered_not_invoiced')).toBe(false)
  })
  it('delivered, not invoiced routes to the sales owner, and to admin when the owner is not sales', () => {
    const orders = [ord({ id: 'a', ownerId: ME }), ord({ id: 'b', ownerId: OTHER }), ord({ id: 'c', ownerId: 'u-eng' }), ord({ id: 'd', ownerId: 'u-admin' })]
    expect(ruleDeliveredNotInvoiced(ctx({ orders }, 'sales')).map(e => e.subjectId)).toEqual(['a'])
    expect(ruleDeliveredNotInvoiced(ctx({ orders }, 'admin')).map(e => e.subjectId).sort()).toEqual(['c', 'd'])
  })
  it('delivered, not invoiced does not nag on the delivery day, and can be snoozed', () => {
    const [e] = ruleDeliveredNotInvoiced(ctx({ orders: [ord({ deliveredOn: '2026-11-27' })] }))
    expect(e).toMatchObject({ actionDueOn: '2026-11-30', group: 'soon' }) // Friday plus one working day
    const snoozed = buildToday(ctx({ orders: [ord()], snoozes: [{ rule: 'delivered_not_invoiced', subjectId: 'ord1', untilOn: '2026-12-01' }] }))
    expect(snoozed.active).toEqual([])
  })
  it('delivered, not invoiced: received goods count as delivered, a service-only order is delivered when commissioning is done, ownerless goes to admin', () => {
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ goodsState: 'received' })] }))).toHaveLength(1)
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ goodsState: 'n_a', commissioningState: 'done' })] }))).toHaveLength(1)
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ ownerId: null })] }, 'admin'))).toHaveLength(1)
    expect(ruleDeliveredNotInvoiced(ctx({ orders: [ord({ ownerId: null })] }, 'sales'))).toEqual([])
  })
  it('goods late has no Received step: it is judged on the expected date against delivered_on (which also fills received_on)', () => {
    expect(ruleGoodsLate(ctx({ legs: [leg({ expectedOn: '2026-11-26' })] }))).toHaveLength(1)
    expect(ruleGoodsLate(ctx({ legs: [leg({ expectedOn: '2026-11-26', deliveredOn: '2026-11-27', receivedOn: '2026-11-27' })] }))).toEqual([])
    expect(ruleGoodsLate(ctx({ legs: [leg({ expectedOn: '2026-11-27' })] }))).toEqual([])
  })
  it('place PO and goods late: a delivered leg is never late, and a leg with a PO is not "place PO"', () => {
    expect(ruleGoodsLate(ctx({ legs: [leg({ deliveredOn: '2026-11-25' })] }))).toEqual([])
    expect(rulePlacePo(ctx({ legs: [leg({ placedOn: '2026-11-10' })] }))).toEqual([])
    expect(rulePlacePo(ctx({ legs: [leg({ placedOn: null })] }, 'engineer'))).toHaveLength(1)
  })
})
