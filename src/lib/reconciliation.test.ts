// Adapted from src/lib/finance/reconciliation.test.ts @ 7a29f3a (Q-Tech CRM v1). Each old case is kept with the same intent, rewritten
// for the v2 rows (v_order_money, invoices, payments_in, expenses, legs, POs); the v2-only checks have their own cases at the end.
import { describe, expect, it } from 'vitest'
import {
  computeReconciliationExceptions,
  countBySeverity,
  type RcExpense,
  type RcInvoice,
  type RcLeg,
  type RcMoney,
  type RcOrder,
  type RcPayment,
  type RcPo,
  type ReconciliationInput,
} from './reconciliation'

const order = (o: Partial<RcOrder> = {}): RcOrder => ({ id: 'o1', number: 38, orderedOn: '2026-07-01', cancelled: false, basisUnknown: false, ...o })
const moneyRow = (m: Partial<RcMoney> = {}): RcMoney => ({
  orderId: 'o1',
  grossTarget: 118000,
  settled: 0,
  itemsNet: 100000,
  itemsGross: 118000,
  invoiceCount: 0,
  invoiceGross: 0,
  expectedCost: null,
  actualCost: 0,
  costsComplete: true,
  ...m,
})
const invoice = (g: Partial<RcInvoice> = {}): RcInvoice => ({
  id: 'g1',
  number: 'INV-1',
  orderId: 'o1',
  invoiceDate: '2026-07-01',
  net: 100000,
  gst: 18000,
  copyReceivedOn: '2026-07-01',
  tcsSentOn: '2026-07-02',
  clientReceivedOn: '2026-07-04',
  taxDepositedOn: null,
  legacy: false,
  ...g,
})
const payment = (p: Partial<RcPayment> = {}): RcPayment => ({ id: 'p1', orderId: 'o1', amount: 100, receivedOn: '2026-07-05', ...p })
const leg = (l: Partial<RcLeg> = {}): RcLeg => ({ id: 'l1', orderId: 'o1', label: 'leg A', placedOn: '2026-07-02', expectedOn: '2026-07-20', receivedOn: null, deliveredOn: null, currency: 'PKR', ...l })

function run(over: Partial<ReconciliationInput> = {}) {
  return computeReconciliationExceptions({ orders: [order()], money: [moneyRow()], payments: [], expenses: [], invoices: [], legs: [], pos: [], ...over })
}

describe('computeReconciliationExceptions (ported cases)', () => {
  it('finds nothing wrong with clean data', () => {
    expect(run({ invoices: [invoice()] })).toEqual([])
  })

  it('flags customer payments exceeding the order total', () => {
    const e = run({ money: [moneyRow({ grossTarget: 1000, settled: 1200 })] })
    expect(e.some(x => x.category === 'Payments exceed total' && x.orderId === 'o1' && x.severity === 'critical')).toBe(true)
  })

  it('flags supplier payments exceeding a leg\'s PO total', () => {
    const pos: RcPo[] = [{ legId: 'l1', total: 1000, currency: 'PKR' }]
    const expenses: RcExpense[] = [{ id: 'x1', orderId: 'o1', legId: 'l1', cost: 1500, paidOn: '2026-07-05' }]
    const e = run({ legs: [leg()], pos, expenses })
    expect(e.some(x => x.category === 'Payments exceed total' && x.message.includes('Supplier payments'))).toBe(true)
  })

  it('does not compare supplier payments with a PO in another currency (no rate is guessed)', () => {
    const e = run({ legs: [leg({ currency: 'USD' })], pos: [{ legId: 'l1', total: 10, currency: 'USD' }], expenses: [{ id: 'x1', orderId: 'o1', legId: 'l1', cost: 5000, paidOn: '2026-07-05' }] })
    expect(e.some(x => x.message.includes('Supplier payments'))).toBe(false)
  })

  it('does not flag payments within tolerance of the total', () => {
    expect(run({ money: [moneyRow({ grossTarget: 1000, settled: 1000.5 })] })).toEqual([])
  })

  it('flags a negative amount as an impossible value', () => {
    const e = run({ invoices: [invoice({ net: -500, gst: -90 })] })
    expect(e.some(x => x.severity === 'critical' && x.message.includes('negative'))).toBe(true)
  })

  it('flags a GST portion exceeding the invoice net', () => {
    const e = run({ invoices: [invoice({ net: 1000, gst: 1500 })] })
    expect(e.some(x => x.category === 'Impossible value' && x.message.includes('exceeds its net'))).toBe(true)
  })

  it('flags a payment recorded before the order was placed', () => {
    const e = run({ orders: [order({ orderedOn: '2026-07-10' })], payments: [payment({ receivedOn: '2026-07-01' })] })
    expect(e.some(x => x.category === 'Dates out of sequence' && x.message.includes('recorded before'))).toBe(true)
  })

  it('flags an invoice dated before the order was placed', () => {
    const e = run({ orders: [order({ orderedOn: '2026-07-10' })], invoices: [invoice({ invoiceDate: '2026-07-01' })] })
    expect(e.some(x => x.category === 'Dates out of sequence' && x.message.includes('before ORD-0038 was placed'))).toBe(true)
  })

  it('flags a leg expected before it was placed', () => {
    const e = run({ legs: [leg({ placedOn: '2026-07-10', expectedOn: '2026-07-01' })] })
    expect(e.some(x => x.category === 'Dates out of sequence' && x.message.includes('expected date'))).toBe(true)
  })

  it('flags a non-positive payment amount', () => {
    const e = run({ payments: [payment({ amount: 0 })] })
    expect(e.some(x => x.message.includes('not positive'))).toBe(true)
  })

  it('flags a GST amount that is not about 18% of net', () => {
    const e = run({ money: [moneyRow({ itemsNet: 0, itemsGross: 0 })], invoices: [invoice({ net: 100000, gst: 30000 })] }) // no item lines: falls back to 18%
    expect(e.some(x => x.category === 'GST ≠ 18% of net')).toBe(true)
  })

  it('does not flag a GST amount within tolerance of the rate', () => {
    expect(run({ invoices: [invoice({ net: 100000, gst: 18000 })] }).some(x => x.category.startsWith('GST'))).toBe(false)
  })

  it('reads the order\'s own rate, so a zero-rated order is not a false alarm', () => {
    const money = moneyRow({ itemsNet: 100000, itemsGross: 100000, grossTarget: 100000 })
    expect(run({ money: [money], invoices: [invoice({ net: 100000, gst: 0 })] }).some(x => x.category.startsWith('GST'))).toBe(false)
    expect(run({ money: [money], invoices: [invoice({ net: 100000, gst: 18000 })] }).some(x => x.category === "GST does not match the order's rate")).toBe(true)
  })

  it('flags an invoice that points at an order that no longer exists', () => {
    expect(run({ invoices: [invoice({ orderId: 'missing-order' })] }).some(x => x.category === 'No matching order')).toBe(true)
  })

  it('does not flag an imported invoice that is not linked to any order', () => {
    expect(run({ invoices: [invoice({ orderId: null, legacy: true })] }).some(x => x.category === 'No matching order')).toBe(false)
  })

  it('flags the TCS courier trail moving backwards in time', () => {
    const e = run({ invoices: [invoice({ tcsSentOn: '2026-07-10', clientReceivedOn: '2026-07-05' })] })
    expect(e.some(x => x.category === 'Dates out of sequence' && x.invoiceId === 'g1')).toBe(true)
  })

  it('flags a tax deposit dated before the invoice itself', () => {
    const e = run({ invoices: [invoice({ invoiceDate: '2026-07-10', taxDepositedOn: '2026-07-01' })] })
    expect(e.some(x => x.message.includes('tax deposit date'))).toBe(true)
  })
})

describe('v2 checks', () => {
  it('flags an order whose price basis is unknown, and says what that leaves out', () => {
    const e = run({ orders: [order({ basisUnknown: true })] })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ category: 'Is GST included?', severity: 'warning', orderId: 'o1' })
    expect(e[0].message).toContain('margin, GST totals and net cash')
  })

  it('flags invoiced gross above the order\'s gross from its items', () => {
    const e = run({ money: [moneyRow({ invoiceCount: 1, invoiceGross: 130000, itemsGross: 118000, grossTarget: 130000 })] })
    expect(e.some(x => x.category === 'Invoiced exceeds order' && x.severity === 'critical')).toBe(true)
  })

  it('flags costs paid above the expected cost, only when one was set', () => {
    expect(run({ money: [moneyRow({ expectedCost: 1000, actualCost: 1200 })] }).some(x => x.category === 'Costs exceed expected')).toBe(true)
    expect(run({ money: [moneyRow({ expectedCost: null, actualCost: 1200 })] }).some(x => x.category === 'Costs exceed expected')).toBe(false)
    expect(run({ money: [moneyRow({ expectedCost: 1000, actualCost: 1000.5 })] }).some(x => x.category === 'Costs exceed expected')).toBe(false)
  })

  it('nudges to mark costs complete once an order is paid in full', () => {
    const e = run({ money: [moneyRow({ settled: 118000, costsComplete: false })] })
    expect(e.some(x => x.category === 'Costs not marked complete')).toBe(true)
    expect(run({ money: [moneyRow({ settled: 118000, costsComplete: true })] }).some(x => x.category === 'Costs not marked complete')).toBe(false)
    expect(run({ money: [moneyRow({ settled: 5000, costsComplete: false })] }).some(x => x.category === 'Costs not marked complete')).toBe(false)
  })

  it('flags a payment on a cancelled order, and checks nothing else about that order\'s totals', () => {
    const e = run({ orders: [order({ cancelled: true })], payments: [payment()], money: [moneyRow({ grossTarget: 100, settled: 5000 })] })
    expect(e.map(x => x.category)).toEqual(['Payment on a cancelled order'])
  })

  it('uses legPaid (summed in the database) instead of summing the expense rows it was given', () => {
    const pos: RcPo[] = [{ legId: 'l1', total: 1000, currency: 'PKR' }]
    const over = run({ legs: [leg()], pos, legPaid: [{ legId: 'l1', paid: 1500 }] })
    expect(over.some(x => x.message.includes('Supplier payments (1,500) are more than the PO total (1,000)'))).toBe(true)
    const within = run({ legs: [leg()], pos, legPaid: [{ legId: 'l1', paid: 900 }], expenses: [{ id: 'x1', orderId: 'o1', legId: 'l1', cost: 5000, paidOn: '2026-07-05' }] })
    expect(within.some(x => x.message.includes('Supplier payments'))).toBe(false)
  })

  it('lists critical items first, in a stable order', () => {
    const e = run({
      orders: [order({ basisUnknown: true })],
      money: [moneyRow({ grossTarget: 100, settled: 500 })],
    })
    expect(e.map(x => x.severity)).toEqual(['critical', 'warning'])
    expect(countBySeverity(e)).toEqual({ critical: 1, warning: 1 })
  })

  it('never produces a score or a percentage of exceptions', () => {
    expect(JSON.stringify(run({ money: [moneyRow({ grossTarget: 100, settled: 500 })] }))).not.toMatch(/score|rating/i)
  })
})
