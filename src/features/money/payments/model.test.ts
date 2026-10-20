import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  defaultPaymentAmount,
  filterReceivables,
  paymentNote,
  receivableTotals,
  reminderDue,
  reminderPhrase,
  sortReceivables,
  type PaymentFacts,
  type ReceivableRow,
} from '@/features/money/payments/model'

const row = (over: Partial<ReceivableRow>): ReceivableRow => ({
  orderId: 'o',
  orderNumber: 1,
  companyId: 'c',
  companyName: 'Customer',
  ownerId: null,
  invoiceNumbers: ['INV-1'],
  gross: 1000,
  settled: 0,
  balance: 1000,
  overpaidBy: 0,
  dueOn: '2026-12-01',
  isOverdue: false,
  state: 'unpaid',
  lastRemindedOn: null,
  reminderCount: 0,
  ...over,
})

const TODAY = '2026-11-27'
const MOCKUP: ReceivableRow[] = [
  row({ orderId: '27', orderNumber: 27, gross: 1911600, settled: 800000, balance: 1111600, dueOn: '2026-10-20', state: 'overdue', lastRemindedOn: '2026-11-14', reminderCount: 2 }),
  row({ orderId: '31', orderNumber: 31, gross: 1244310, balance: 1244310, dueOn: '2026-11-15', state: 'overdue', lastRemindedOn: '2026-11-19', reminderCount: 1 }),
  row({ orderId: '33', orderNumber: 33, gross: 879100, settled: 250000, balance: 629100, dueOn: '2026-12-06', state: 'part' }),
  row({ orderId: '35', orderNumber: 35, gross: 552240, settled: 300000, balance: 252240, dueOn: '2026-12-14', state: 'part' }),
  row({ orderId: '41', orderNumber: 41, gross: 1014800, balance: 1014800, dueOn: '2026-12-25', state: 'unpaid' }),
  row({ orderId: '38', orderNumber: 38, invoiceNumbers: [], gross: 2300764, settled: 700000, balance: 1600764, dueOn: null, state: 'part' }),
  row({ orderId: '20', orderNumber: 20, gross: 100, settled: 100, balance: 0, state: 'settled' }),
]

describe('receivables, the mockup figures', () => {
  it('splits the outstanding balance by status', () => {
    expect(receivableTotals(MOCKUP, TODAY)).toMatchObject({
      openCount: 6,
      outstanding: 5852814,
      overdueCount: 2,
      overdue: 2355910,
      notYetDueCount: 3,
      notYetDue: 1896140,
      notInvoicedCount: 1,
      notInvoiced: 1600764,
      gross: 7902814,
      settled: 2050000,
    })
  })

  it('a reminder is due when overdue and not reminded in the last 7 working days (as Today)', () => {
    expect(reminderDue(MOCKUP[0], TODAY)).toBe(true) // reminded 13 days ago
    expect(reminderDue(MOCKUP[1], TODAY)).toBe(false) // 8 calendar days but 6 working days ago: due Mon 30 Nov
    expect(reminderDue(MOCKUP[1], '2026-11-30')).toBe(true)
    expect(reminderDue(row({ state: 'overdue', lastRemindedOn: '2026-11-21' }), TODAY)).toBe(false) // 6 days ago
    expect(reminderDue(row({ state: 'part' }), TODAY)).toBe(false)
    expect(reminderPhrase(2, 2)).toBe('both due a reminder')
    expect(reminderPhrase(2, 1)).toBe('1 due a reminder')
    expect(reminderPhrase(1, 0)).toBe('none due a reminder')
  })

  it('filters open, overdue and settled, and puts open orders in due order with the uninvoiced one last', () => {
    expect(filterReceivables(MOCKUP, 'open')).toHaveLength(6)
    expect(filterReceivables(MOCKUP, 'overdue').map(r => r.orderNumber)).toEqual([27, 31])
    expect(filterReceivables(MOCKUP, 'settled').map(r => r.orderNumber)).toEqual([20])
    expect(sortReceivables(MOCKUP).map(r => r.orderNumber)).toEqual([27, 31, 33, 35, 41, 38, 20])
  })

  it('counts whole days', () => {
    expect(daysBetween('2026-10-20', '2026-11-27')).toBe(38)
    expect(daysBetween('2026-11-27', '2026-12-06')).toBe(9)
  })
})

describe('record payment: amount = balance due, date = today', () => {
  const facts: PaymentFacts = { gross: 2300764, settled: 700000, balance: 1600764, invoiced: false, prior: [{ receivedOn: '2026-11-09', amount: 700000 }] }

  it('opens with the balance due, or empty when nothing is due', () => {
    expect(defaultPaymentAmount(facts)).toBe(1600764)
    expect(defaultPaymentAmount({ ...facts, balance: 0 })).toBeNull()
  })

  it('says what saving does', () => {
    expect(paymentNote(facts, 1600764)).toEqual({
      kind: 'settles',
      text: 'This settles the order: PKR 1,600,764 of 2,300,764 gross, after the advance of 700,000 on 9 Nov. Type a smaller amount to record a part payment.',
    })
    expect(paymentNote(facts, 600000)).toMatchObject({ kind: 'part' })
    expect(paymentNote(facts, 600000).text).toContain('PKR 1,000,764 will still be due')
    expect(paymentNote(facts, 1700000)).toMatchObject({ kind: 'over' })
    expect(paymentNote(facts, null).kind).toBe('none')
  })

  it('within Rs 1 of the balance still settles it, as the database does', () => {
    expect(paymentNote(facts, 1600763.5).kind).toBe('settles')
  })

  it('says "payment" rather than "advance" once the order is invoiced', () => {
    expect(paymentNote({ ...facts, invoiced: true }, 1600764).text).toContain('after the payment of 700,000')
  })
})
