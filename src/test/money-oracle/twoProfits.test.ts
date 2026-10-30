import { describe, expect, it } from 'vitest'
import { monthPnlLive, profitMonth, cashMonth, type Books } from '@/test/money-oracle/oracle'
import { cashTotals, profitTotals, reconcile, type FlowRow, type ProfitRow } from '@/features/money/inOut/model'

/*
 * Round 3, money correctness (b): the old Reports hub printed "In vs out … profit (invoiced) 827,800" beside "Profit and loss:
 * Result 98,800". Both are right, on different bases, and the screens now label them "Profit on invoices" and "Profit on money
 * received". This pins the two bases on one tiny month, every figure worked out by hand:
 *
 *   order: 1 line, 1 x 1,000,000.00 at 18% GST          net 1,000,000   GST 180,000   gross 1,180,000
 *   invoice dated 10 Sep for the whole order
 *   the customer pays 118,000 on 20 Sep (a tenth)       split: net 100,000, GST 18,000
 *   rent (an overhead) 20,000 paid 5 Sep, no input tax
 *
 *   Profit on money received (P&L)  = net received 100,000 - overheads 20,000                    =  80,000
 *   Profit on invoices (In and out) = sales invoiced 1,000,000 - overheads 20,000                 = 980,000
 *   Cash in minus cash out          = 118,000 - 20,000                                            =  98,000
 *   why profit on invoices and cash differ: customers owe more (1,180,000 - 118,000 = 1,062,000) less the GST in the invoice
 *   (180,000) = 882,000 = 980,000 - 98,000.
 */
const SEP = '2026-09'
const P = (rupees: number) => BigInt(rupees) * 100n
const books: Books = {
  orders: [{ id: 'o1', number: 1, companyId: 'c1', ownerId: null, lines: [{ qty: '1', price: '1000000.00', rate: '18' }], terms: 30, cancelledOn: null, basisUnknown: false, costsComplete: false, expectedCost: null }],
  invoices: [{ id: 'i1', orderId: 'o1', number: 'INV-1', date: '2026-09-10', net: P(1_000_000), gst: P(180_000) }],
  payments: [{ id: 'p1', orderId: 'o1', date: '2026-09-20', amount: P(118_000), credited: null }],
  expenses: [{ id: 'e1', date: '2026-09-05', amount: P(20_000), inputTax: 0n, grp: 'overhead', categoryId: 'rent', orderId: null, legId: null, supplierPayment: false }],
  defaultTerms: 30,
}

describe('two profits, two bases, both right (round 3, money correctness b)', () => {
  it('profit on money received is 80,000; profit on invoices is 980,000 (worked by hand)', () => {
    const pnl = monthPnlLive(SEP, books)
    expect(pnl.netIn).toBe(P(100_000))
    expect(pnl.gstIn).toBe(P(18_000))
    expect(pnl.result).toBe(P(80_000))
    const inv = profitMonth(SEP, books)
    expect(inv.sales).toBe(P(1_000_000))
    expect(inv.profit).toBe(P(980_000))
  })

  it('In and out arranges the same books into cash 98,000 and explains the 882,000 gap to the paisa', () => {
    const cash = cashMonth(SEP, books)
    const inv = profitMonth(SEP, books)
    const rs = (p: bigint) => (Number(p) / 100).toFixed(2)
    const flows: FlowRow[] = [{ month: SEP, moneyIn: rs(cash.in), payments: 1, moneyOut: rs(cash.out), expenses: 1, frozen: false }]
    const profits: ProfitRow[] = [
      { month: SEP, salesNet: rs(inv.sales), salesGst: rs(inv.salesGst), invoices: inv.invoices, orderCostsMatched: rs(inv.orderCosts), overheads: rs(inv.overheads), profit: rs(inv.profit), orderCostsPaid: rs(inv.orderCostsPaid), nonPnlPaid: rs(inv.nonPnlPaid), inputTaxPaid: rs(inv.inputTaxPaid) },
    ]
    const c = cashTotals({ kind: 'month', key: SEP }, flows)
    const p = profitTotals({ kind: 'month', key: SEP }, profits)
    expect(c.net).toBe('98000.00')
    expect(p.profit).toBe('980000.00')
    expect(reconcile(c, p)).toEqual({ gap: '882000.00', owedMore: '1062000.00', gst: '180000.00', costsAhead: '0.00', drawingsAndTax: '0.00', refunds: '0.00', other: '0.00' })
  })
})
