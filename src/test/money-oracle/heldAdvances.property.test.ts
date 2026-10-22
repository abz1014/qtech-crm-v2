import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { filterReceivables, type ReceivableRow } from '@/features/money/payments/model'
import { agingAsOf, dec, heldAdvances, receivableOf, rs, sumP, type Books, type Order, type Payment } from '@/test/money-oracle/oracle'
import { RUNS, booksArb, dateArb } from '@/test/money-oracle/arbitraries'

/*
 * Owner decision 2026-10-22 (money-verify owner question): an advance on a CANCELLED order is never owed and never overdue. It is
 * held, to refund or keep, and listed apart. Checked over random books against the oracle, and against the app's own list rules
 * (filterReceivables, which Who owes us and Today's reminders use over the rows receivables lists).
 */

const toRow = (o: Order, books: Books, today: string): ReceivableRow => {
  const r = receivableOf(o, books, today)
  return {
    orderId: o.id,
    orderNumber: o.number,
    companyId: o.companyId,
    companyName: o.companyId,
    ownerId: o.ownerId,
    invoiceNumbers: books.invoices.filter(i => i.orderId === o.id).map(i => i.number),
    gross: Number(rs(r.gross)),
    settled: Number(rs(r.settled)),
    balance: Number(rs(r.balance)),
    overpaidBy: Number(rs(r.overpaid)),
    dueOn: r.dueOn,
    isOverdue: r.overdue,
    state: r.state,
    lastRemindedOn: null,
    reminderCount: 0,
  }
}

describe('advances held on cancelled orders (owner decision 2026-10-22)', () => {
  it('a cancelled, never-invoiced order is never on Who owes us, never overdue, and its money is held in full', () => {
    fc.assert(
      fc.property(booksArb, dateArb, (books, today) => {
        const held = heldAdvances(books)
        // what receivables lists (D-MR3), as Who owes us and Today's "payment overdue" see it
        const listed = books.orders.filter(o => receivableOf(o, books, today).listed).map(o => toRow(o, books, today))
        const open = new Set(filterReceivables(listed, 'open').map(r => r.orderId))
        const overdue = new Set(filterReceivables(listed, 'overdue').map(r => r.orderId))
        for (const h of held) {
          expect(listed.some(r => r.orderId === h.orderId)).toBe(false)
          expect(open.has(h.orderId)).toBe(false)
          expect(overdue.has(h.orderId)).toBe(false)
          expect(h.held).toBe(sumP(books.payments.filter(p => p.orderId === h.orderId).map(p => p.amount)))
          expect(h.held > 0n).toBe(true)
        }
        // and every order it leaves out is cancelled, never invoiced, or holds nothing
        for (const o of books.orders) {
          const paid = sumP(books.payments.filter(p => p.orderId === o.id).map(p => p.amount))
          const expectHeld = o.cancelledOn !== null && !books.invoices.some(i => i.orderId === o.id) && paid > 0n
          expect(held.some(h => h.orderId === o.id)).toBe(expectHeld)
        }
      }),
      RUNS,
    )
  })

  it('on the aging, the held money is an advance marked cancelled (from the cancel date), never negative aging', () => {
    fc.assert(
      fc.property(booksArb, fc.constant('2099-12-31'), (books, asOf) => {
        const a = agingAsOf(asOf, books)
        for (const h of heldAdvances(books)) {
          const adv = a.advances.find(x => x.orderId === h.orderId)
          expect(adv).toEqual({ orderId: h.orderId, held: h.held, cancelled: true })
          expect(a.invoices.some(i => i.orderId === h.orderId)).toBe(false)
        }
        for (const adv of a.advances) {
          const o = books.orders.find(x => x.id === adv.orderId) as Order
          expect(adv.cancelled).toBe(o.cancelledOn !== null)
        }
      }),
      RUNS,
    )
  })

  it('a voided payment is not held; before the cancel date the advance is an ordinary one', () => {
    const o: Order = { id: 'h1', number: 1, companyId: 'c', ownerId: null, lines: [{ qty: '1.000', price: '1000.00', rate: '18' }], terms: 30, cancelledOn: '2025-03-20', basisUnknown: false, costsComplete: false, expectedCost: null }
    const payments: Payment[] = [
      { id: 'p1', orderId: 'h1', date: '2025-03-10', amount: dec('700.00', 2), credited: 'u' },
      { id: 'p2', orderId: 'h1', date: '2025-03-12', amount: dec('100.00', 2), credited: 'u', voided: true },
    ]
    expect(heldAdvances({ orders: [o], invoices: [], payments })).toEqual([{ orderId: 'h1', held: 70000n }])
    const before = agingAsOf('2025-03-15', { orders: [o], invoices: [], payments: payments.filter(p => !p.voided) })
    expect(before.advances).toEqual([{ orderId: 'h1', held: 70000n, cancelled: false }])
  })
})
