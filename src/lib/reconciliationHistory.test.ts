import { describe, expect, it } from 'vitest'
import { computeReconciliationExceptions, type RcInvoice, type RcMoney, type RcOrder, type ReconciliationInput } from './reconciliation'

// Redesign phase 0 (plan D10): "Mistakes to fix" lists real mistakes in live data only. An imported order or invoice is history:
// no finding is raised about it. The same mistakes on a v2 record are still found. Fictional data.
const order = (o: Partial<RcOrder> = {}): RcOrder => ({ id: 'o1', number: 38, orderedOn: '2026-07-01', cancelled: false, basisUnknown: false, ...o })
const money = (m: Partial<RcMoney> = {}): RcMoney => ({
  orderId: 'o1', grossTarget: 1000, settled: 1200, itemsNet: 100000, itemsGross: 118000, invoiceCount: 0, invoiceGross: 0, expectedCost: null, actualCost: 0, costsComplete: true, ...m,
})
const invoice = (g: Partial<RcInvoice> = {}): RcInvoice => ({
  id: 'g1', number: '101', orderId: null, invoiceDate: '2026-07-01', net: 100000, gst: 9000, copyReceivedOn: null, tcsSentOn: null, clientReceivedOn: null, taxDepositedOn: '2026-06-01', legacy: false, ...g,
})
const run = (o: Partial<ReconciliationInput>) =>
  computeReconciliationExceptions({ orders: [], money: [], payments: [], expenses: [], invoices: [], legs: [], pos: [], ...o })

describe('Mistakes to fix skips imported records (D10)', () => {
  it('an overpaid imported order raises nothing; the same v2 order is still critical', () => {
    expect(run({ orders: [order({ legacy: true })], money: [money()] })).toEqual([])
    expect(run({ orders: [order()], money: [money()] }).map(e => e.category)).toContain('Payments exceed total')
  })

  it('an imported invoice with an odd GST rate and a deposit before its date raises nothing; a v2 one still does', () => {
    expect(run({ invoices: [invoice({ legacy: true })] })).toEqual([])
    expect(run({ invoices: [invoice()] }).length).toBeGreaterThan(0)
  })
})
