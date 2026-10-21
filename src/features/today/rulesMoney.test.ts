import { describe, expect, it } from 'vitest'
import {
  applySnoozes,
  buildToday,
  recurringSubjectId,
  ROLLUP_SUBJECT,
  ruleCostsIncomplete,
  ruleFbrAttention,
  rulePaymentOverdue,
  ruleRecurringDue,
  ruleTcsNotSent,
} from './rules'
import { SNOOZE_RULE, type CostFact, type InvoiceFact, type ReceivableFact, type RecurringFact, type Role, type TodayInputs } from './types'

// M08: Today v3 money rules. 2026-11-27 is a Friday.
const TODAY = '2026-11-27'
const ME = 'u-me'
const roles: Record<string, Role> = { [ME]: 'sales', 'u-sales2': 'sales', 'u-admin': 'admin', 'u-eng': 'engineer' }

const ctx = (o: Partial<TodayInputs> = {}, role: Role = 'admin'): TodayInputs => ({
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

const cost = (o: Partial<CostFact> = {}): CostFact => ({
  orderId: 'o1',
  orderNumber: 27,
  expectedCost: 900_000,
  actualCost: 850_000,
  paymentState: 'settled',
  costsState: 'provisional',
  basisUnknown: false,
  cancelled: false,
  ...o,
})
const inv = (o: Partial<InvoiceFact> = {}): InvoiceFact => ({
  id: 'i1',
  number: 'INV-2256',
  orderId: 'o1',
  invoiceDate: '2026-11-20',
  courierState: 'not_started',
  fbrState: 'pending',
  fbrException: false,
  needsFbrAttention: false,
  ...o,
})
const tpl = (o: Partial<RecurringFact> = {}): RecurringFact => ({ id: 't1', label: 'Rent', dayOfMonth: 5, active: true, startMonth: null, recorded: false, ...o })
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

describe('M08 payment overdue: routing per role', () => {
  const sales = rec({ ownerId: ME })
  const otherSales = rec({ orderId: 'o2', ownerId: 'u-sales2' })
  const admin = rec({ orderId: 'o3', ownerId: 'u-admin' })
  const engineer = rec({ orderId: 'o4', ownerId: 'u-eng' })
  const ownerless = rec({ orderId: 'o5', ownerId: null })
  const all = [sales, otherSales, admin, engineer, ownerless]
  it('a sales order goes to its sales owner, and not to admin or to another sales person', () => {
    expect(rulePaymentOverdue(ctx({ receivables: all }, 'sales')).map(e => e.subjectId)).toEqual(['o1'])
    expect(rulePaymentOverdue(ctx({ receivables: all }, 'admin')).map(e => e.subjectId)).not.toContain('o1')
    expect(rulePaymentOverdue(ctx({ receivables: all }, 'admin')).map(e => e.subjectId)).not.toContain('o2')
  })
  it('an admin-, engineer- or un-owned order goes to admin', () => {
    expect(rulePaymentOverdue(ctx({ receivables: all }, 'admin')).map(e => e.subjectId).sort()).toEqual(['o3', 'o4', 'o5'])
  })
  it('an engineer gets none, whatever the facts', () => {
    expect(rulePaymentOverdue(ctx({ receivables: all }, 'engineer'))).toEqual([])
  })
})

describe('M08 costs incomplete (admin only)', () => {
  it('is one item for paid orders whose costs are provisional', () => {
    const e = ruleCostsIncomplete(ctx({ costs: [cost(), cost({ orderId: 'o2', orderNumber: 30 })] }))
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ rule: 'costs_incomplete', tab: 'money', title: 'Margin not final on 2 paid orders', group: 'ready', href: '/money/margins?filter=paid-provisional' })
    expect(e[0].subjectId).toBe(ROLLUP_SUBJECT.costs_incomplete)
  })
  it('says how many have no expected cost', () => {
    expect(ruleCostsIncomplete(ctx({ costs: [cost({ expectedCost: null }), cost({ orderId: 'o2' })] }))[0].party).toBe('1 with no expected cost')
    expect(ruleCostsIncomplete(ctx({ costs: [cost()] }))[0].party).toBe('Oldest ORD-0027')
    expect(ruleCostsIncomplete(ctx({ costs: [cost()] }))[0].title).toBe('Margin not final on 1 paid order')
  })
  it('skips orders that are not paid, already complete, cancelled, or whose basis is unknown', () => {
    const skipped = [cost({ paymentState: 'part' }), cost({ paymentState: 'overdue' }), cost({ costsState: 'complete' }), cost({ cancelled: true }), cost({ basisUnknown: true })]
    expect(ruleCostsIncomplete(ctx({ costs: skipped }))).toEqual([])
  })
  it('is never produced for sales or an engineer', () => {
    expect(ruleCostsIncomplete(ctx({ costs: [cost()] }, 'sales'))).toEqual([])
    expect(ruleCostsIncomplete(ctx({ costs: [cost()] }, 'engineer'))).toEqual([])
  })
})

describe('M08 FBR attention (admin and sales)', () => {
  const attn = inv({ needsFbrAttention: true, invoiceDate: '2026-09-18' })
  it('is one item for invoices not deposited after their month, or with a step out of order', () => {
    const e = ruleFbrAttention(ctx({ invoices: [attn, inv({ id: 'i2', fbrException: true, invoiceDate: '2026-10-02' }), inv({ id: 'i3' })] }))
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ rule: 'fbr_attention', title: 'FBR: 2 invoices need attention', party: '1 step recorded out of order', href: '/money/gst-register?attention=1' })
  })
  it('names the oldest month when nothing is out of order', () => {
    expect(ruleFbrAttention(ctx({ invoices: [attn] }))[0]).toMatchObject({ title: 'FBR: 1 invoice needs attention', party: 'Oldest September 2026' })
  })
  it('is nothing when every invoice is fine', () => {
    expect(ruleFbrAttention(ctx({ invoices: [inv(), inv({ id: 'i2', fbrState: 'deposited' })] }))).toEqual([])
  })
  it('goes to sales as well as admin, and never to an engineer', () => {
    expect(ruleFbrAttention(ctx({ invoices: [attn] }, 'sales'))).toHaveLength(1)
    expect(ruleFbrAttention(ctx({ invoices: [attn] }, 'admin'))).toHaveLength(1)
    expect(ruleFbrAttention(ctx({ invoices: [attn] }, 'engineer'))).toEqual([])
  })
})

describe('M08 TCS not sent (admin and sales)', () => {
  it('is raised three working days after the invoice date, not before', () => {
    // Invoice Fri 2026-11-20 + 3 working days = Wed 2026-11-25: due by Fri 27.
    expect(ruleTcsNotSent(ctx({ invoices: [inv({ invoiceDate: '2026-11-20' })] }))).toHaveLength(1)
    expect(ruleTcsNotSent(ctx({ invoices: [inv({ invoiceDate: '2026-11-25' })] }))).toEqual([]) // Wed + 3 = Mon 30
    expect(ruleTcsNotSent(ctx({ invoices: [inv({ invoiceDate: '2026-11-24' })] }))).toHaveLength(1) // Tue + 3 = Fri 27
  })
  it('is one item with a count and the age of the oldest', () => {
    const e = ruleTcsNotSent(ctx({ invoices: [inv(), inv({ id: 'i2', invoiceDate: '2026-11-10', courierState: 'copy_received' })] }))
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ rule: 'tcs_not_sent', title: '2 invoices not sent by TCS', party: 'Oldest invoice 17 days ago', group: 'ready' })
  })
  it('ignores invoices already sent, delivered, undated, or older than 60 days', () => {
    expect(ruleTcsNotSent(ctx({ invoices: [inv({ courierState: 'sent' }), inv({ id: 'a', courierState: 'delivered_to_client' }), inv({ id: 'b', invoiceDate: null }), inv({ id: 'c', invoiceDate: '2026-09-01' })] }))).toEqual([])
  })
  it('goes to sales as well as admin, and never to an engineer', () => {
    expect(ruleTcsNotSent(ctx({ invoices: [inv()] }, 'sales'))).toHaveLength(1)
    expect(ruleTcsNotSent(ctx({ invoices: [inv()] }, 'engineer'))).toEqual([])
  })
})

describe('M08 recurring due (admin only)', () => {
  it('is raised once a template day has come and nothing is recorded for the month', () => {
    const e = ruleRecurringDue(ctx({ recurring: [tpl(), tpl({ id: 't2', label: 'Salaries', dayOfMonth: 25 })] }))
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ rule: 'recurring_due', title: '2 recurring expenses to record', party: 'Rent, Salaries', actionDueOn: '2026-11-05', group: 'now', href: '/money/expenses' })
    expect(e[0].subjectId).toBe(recurringSubjectId(TODAY))
  })
  it('waits for the day: a template for the 28th is not due on the 27th', () => {
    expect(ruleRecurringDue(ctx({ recurring: [tpl({ dayOfMonth: 28 })] }))).toEqual([])
    expect(ruleRecurringDue(ctx({ today: '2026-11-28', recurring: [tpl({ dayOfMonth: 28 })] }))[0]).toMatchObject({ group: 'now', badge: { text: 'Due today' } })
  })
  it('a template with no day is due from the 1st', () => {
    expect(ruleRecurringDue(ctx({ today: '2026-11-01', recurring: [tpl({ dayOfMonth: null })] }))).toHaveLength(1)
  })
  it('skips recorded, inactive and not-yet-started templates', () => {
    expect(ruleRecurringDue(ctx({ recurring: [tpl({ recorded: true }), tpl({ id: 'b', active: false }), tpl({ id: 'c', startMonth: '2026-12' })] }))).toEqual([])
  })
  it('lists at most three names', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((l, i) => tpl({ id: `t${i}`, label: l, dayOfMonth: 1 }))
    expect(ruleRecurringDue(ctx({ recurring: many }))[0].party).toBe('A, B, C and 2 more')
  })
  it('is never produced for sales or an engineer', () => {
    expect(ruleRecurringDue(ctx({ recurring: [tpl()] }, 'sales'))).toEqual([])
    expect(ruleRecurringDue(ctx({ recurring: [tpl()] }, 'engineer'))).toEqual([])
  })
})

describe('M08 in the whole list', () => {
  const facts = { costs: [cost()], invoices: [inv({ needsFbrAttention: true, invoiceDate: '2026-09-18' }), inv({ id: 'i9' })], recurring: [tpl()], receivables: [rec({ ownerId: 'u-admin' })] }
  it('admin gets all four plus the payment; sales gets FBR and TCS only; an engineer gets nothing', () => {
    expect(buildToday(ctx(facts, 'admin')).active.map(i => i.rule).sort()).toEqual(['costs_incomplete', 'fbr_attention', 'payment_overdue', 'recurring_due', 'tcs_not_sent'])
    expect(buildToday(ctx(facts, 'sales')).active.map(i => i.rule).sort()).toEqual(['fbr_attention', 'tcs_not_sent'].sort())
    expect(buildToday(ctx(facts, 'engineer')).active).toEqual([])
  })
  it('every item is on the Money tab and can be snoozed as a whole', () => {
    const v = buildToday(ctx(facts, 'admin'))
    expect(v.active.every(i => i.tab === 'money')).toBe(true)
    const f = v.active.find(i => i.rule === 'fbr_attention')!
    const hidden = applySnoozes(v.active, [{ rule: SNOOZE_RULE.fbr_attention, subjectId: f.subjectId, untilOn: '2026-11-30' }], TODAY)
    expect(hidden.map(i => i.rule)).not.toContain('fbr_attention')
    expect(hidden).toHaveLength(v.active.length - 1)
  })
  it('the subject ids are valid uuids', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
    for (const id of [...Object.values(ROLLUP_SUBJECT), recurringSubjectId(TODAY)]) expect(id).toMatch(uuid)
  })
})
