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
  previousMonthStart,
  ruleBidDue,
  ruleChaseCustomer,
  ruleChaseSupplier,
  ruleCloseMonth,
  ruleDecisionOverdue,
  ruleGoodsLate,
  ruleNotFloated,
  rulePaymentOverdue,
  rulePlacePo,
  ruleRelayAnswers,
  THRESHOLDS,
} from './rules'
import type { ClarificationFact, InquiryFact, LegFact, ReceivableFact, RfqFact, Role, TodayInputs } from './types'

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
  receivables: [],
  monthEnd: null,
  snoozes: [],
  ...o,
})

describe('helpers', () => {
  it('dueBadge words the distance', () => {
    expect(dueBadge('2026-11-15', TODAY)).toEqual({ text: '12d late', tone: 'danger' })
    expect(dueBadge(TODAY, TODAY)).toEqual({ text: 'today', tone: 'danger' })
    expect(dueBadge('2026-11-28', TODAY)).toEqual({ text: 'in 1d', tone: 'warning' })
    expect(dueBadge('2026-12-01', TODAY)).toEqual({ text: 'in 4d', tone: 'neutral' })
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

describe('rule: relay answers', () => {
  it('names the count and the supplier', () => {
    const [e] = ruleRelayAnswers(ctx({ rfqs: [rfq()], inquiries: [inq({ answersToRelay: 3, supplierName: 'Beli Valves' })] }))
    expect(e).toMatchObject({ rule: 'relay_answers', title: 'Answer received on 3 questions: relay to Beli Valves', subjectId: 'i1', inquiryId: 'i1' })
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
    expect(e).toMatchObject({ rule: 'not_floated', title: 'Not floated to suppliers yet', ref: 'RFQ-0177' })
  })
  it('is not raised once floated, or once the bid is out', () => {
    expect(ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'floated_awaiting' })] }))).toEqual([])
    expect(ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'not_floated', bidState: 'bid_sent' })] }))).toEqual([])
  })
  it('without a bid date shows its age instead', () => {
    const [e] = ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'not_floated', dueOn: null })] }))
    expect(e.actionDueOn).toBe('2026-11-17') // due the day it arrived
    expect(e.badge).toEqual({ text: '10d late', tone: 'danger' })
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
    expect(rows.map(r => r.title)).toEqual(['Bid due today', 'Bid 2 days overdue', 'Bid due Wednesday 2 December'])
    expect(rows[0].badge).toEqual({ text: 'today', tone: 'danger' })
  })
  it('names the bid time when the RFQ has one (rfqs.due_time)', () => {
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: TODAY, dueTime: '17:00:00' })] }))[0].title).toBe('Bid due today, 17:00')
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28', dueTime: '12:00:00' })] }))[0].title).toBe('Bid due tomorrow, 12:00')
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-12-02', dueTime: '09:30:00' })] }))[0].title).toBe('Bid due Wednesday 2 December, 09:30')
  })
  it('words tomorrow, and skips RFQs already bid, without a date or owned by someone else', () => {
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28' })] }))[0].title).toBe('Bid due tomorrow')
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28', bidState: 'bid_sent' })] }))).toEqual([])
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: null })] }))).toEqual([])
    expect(ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-11-28', ownerId: OTHER })] }))).toEqual([])
  })
})

describe('rule: decision overdue', () => {
  it('is raised 10 working days after the bid went out', () => {
    // Fri 13 Nov + 10 working days = Fri 27 Nov
    const [e] = ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'bid_sent', quotedOn: '2026-11-13' })] }))
    expect(e).toMatchObject({ rule: 'decision_overdue', title: 'No decision yet: bid sent 14 days ago', group: 'now' })
    expect(ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'bid_sent', quotedOn: '2026-11-16' })] }))).toEqual([])
  })
  it('is raised when the quotation expired', () => {
    const [e] = ruleDecisionOverdue(ctx({ rfqs: [rfq({ bidState: 'quotation_expired', quotedOn: '2026-10-01', quotationValidUntil: '2026-11-20' })] }))
    expect(e.title).toBe('Quotation expired: re-confirm prices before re-issuing')
    expect(e.badge.text).toBe('7d late')
  })
  it('is not raised for a bid still to send', () => {
    expect(ruleDecisionOverdue(ctx({ rfqs: [rfq()] }))).toEqual([])
  })
})

describe('rule: payment overdue (admin and sales only)', () => {
  it('is raised for an overdue order that was never reminded, with the days late', () => {
    const [e] = rulePaymentOverdue(ctx({ receivables: [rec()] }))
    expect(e).toMatchObject({ rule: 'payment_overdue', title: 'Payment 12 days overdue', ref: 'ORD-0031', party: 'Karachi Glassworks', orderId: 'o1', group: 'now' })
    expect(e.badge).toEqual({ text: '12d late', tone: 'danger' })
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
    expect(e.badge.text).toBe('17d old')
  })
  it('is not raised once placed or for another owner; engineers do see it', () => {
    expect(rulePlacePo(ctx({ legs: [leg()] }))).toEqual([])
    expect(rulePlacePo(ctx({ legs: [leg({ placedOn: null, ownerId: OTHER })] }))).toEqual([])
    expect(rulePlacePo(ctx({ legs: [leg({ placedOn: null })] }, 'engineer'))).toHaveLength(1)
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
    expect(e.badge).toEqual({ text: '4d late', tone: 'danger' })
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
    expect(e.badge).toEqual({ text: '2d late', tone: 'danger' })
  })
  it('not floated: the day the RFQ was received', () => {
    expect(ruleNotFloated(ctx({ rfqs: [rfq({ sourcingState: 'not_floated', receivedOn: '2026-11-27' })] }))[0]).toMatchObject({ actionDueOn: '2026-11-27', group: 'now', badge: { text: 'today' } })
  })
  it('bid due: the bid date, in the next 5 working days when ahead', () => {
    const [e] = ruleBidDue(ctx({ rfqs: [rfq({ dueOn: '2026-12-02' })] }))
    expect(e.actionDueOn).toBe('2026-12-02')
    expect(e.group).toBe('soon')
    expect(e.badge.text).toBe('in 5d')
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
    expect(ruleGoodsLate(ctx({ legs: [leg()] }))[0]).toMatchObject({ actionDueOn: '2026-11-22', badge: { text: '5d late' } })
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
