import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toPaisa } from '@/lib/money'
import { businessToday } from '@/lib/dates'
import { getCompanyMoney } from '@/features/companies/api'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'
import { companyMoney, karachiDate, orderMoneyOf, rs, sumP, type Books, type Order } from '@/test/money-oracle/oracle'
import { booksArb, dateArb } from '@/test/money-oracle/arbitraries'

/*
 * The same figure in two places. The Company page's "Money with them" panel (admin) against what the Receivables page and the
 * order pages say each order owes, and the Karachi "today" every money date defaults to.
 */

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => {
  fake?.uninstall()
  fake = null
  vi.useRealTimers()
})

/** Serve v_order_money rows (receivable = max(G - paid, 0), settled = paid) for every order of the company, as the view does. */
function serveOrderMoney(books: Books, today: string) {
  fake = installFakeDb(call => {
    if (call.target !== 'v_order_money') return { data: [] }
    const company = opArgs(call, 'eq')?.[1]
    const rows = books.orders
      .filter((o: Order) => o.companyId === company)
      .map(o => {
        const m = orderMoneyOf(o, books, today)
        return { receivable: Number(rs(m.balance)), settled: Number(rs(m.settled)) }
      })
    return { data: rows }
  })
}

describe('Company page "Money with them" (companies/api getCompanyMoney) against the receivables', () => {
  // BUG-M1: getCompanyMoney adds up v_order_money.receivable (already the OUTSTANDING balance, max(G - paid, 0)) and labels it
  // "Receivable (gross)", then shows Balance = receivable - received, so every payment is subtracted twice. A customer who paid
  // half shows a balance of zero; a customer who paid everything shows a NEGATIVE balance equal to all they ever paid.
  // It also reads v_order_money, which keeps cancelled orders that were never invoiced (D-MR3 leaves them out of receivables).
  it.fails('BUG-M1: Receivable (gross), Received and Balance equal the sums over the customer\'s orders', async () => {
    await fc.assert(
      fc.asyncProperty(booksArb, dateArb, async (books, today) => {
        serveOrderMoney(books, today)
        const got = await getCompanyMoney('c1')
        const want = companyMoney('c1', books, today)
        expect(toPaisa(got.receivable)).toBe(want.gross)
        expect(toPaisa(got.settled)).toBe(want.received)
        expect(toPaisa(got.balance)).toBe(want.balance)
        fake?.uninstall()
      }),
      { numRuns: 300, seed: 20261020 },
    )
  })

  it('BUG-M1 minimal repro (documents the wrong values)', async () => {
    // One order, one 18% line of 1,000: gross 1,180. Paid 500, then paid in full.
    const order: Order = { id: 'o1', number: 1, companyId: 'c1', ownerId: null, lines: [{ qty: '1.000', price: '1000.00', rate: '18' }], terms: 30, cancelledOn: null, basisUnknown: false, costsComplete: false, expectedCost: null }
    const part: Books = { orders: [order], invoices: [], payments: [{ id: 'p1', orderId: 'o1', date: '2026-01-10', amount: 50000n, credited: null }], expenses: [], defaultTerms: 30 }
    serveOrderMoney(part, '2026-10-20')
    const a = await getCompanyMoney('c1')
    expect([a.receivable, a.settled, a.balance]).toEqual([680, 500, 180]) // the screen: 680 / 500 / 180
    expect(companyMoney('c1', part, '2026-10-20')).toEqual({ gross: 118000n, received: 50000n, balance: 68000n, overpaid: 0n }) // right: 1,180 / 500 / 680
    fake?.uninstall()

    const full: Books = { ...part, payments: [{ id: 'p1', orderId: 'o1', date: '2026-01-10', amount: 118000n, credited: null }] }
    serveOrderMoney(full, '2026-10-20')
    const b = await getCompanyMoney('c1')
    expect(b.balance).toBe(-1180) // a fully paid customer shows a negative balance of everything they paid
    fake?.uninstall()

    // a cancelled order that was never invoiced still counts (v_order_money has no D-MR3 filter)
    const cancelled: Books = { ...part, orders: [{ ...order, cancelledOn: '2026-02-01' }], payments: [] }
    serveOrderMoney(cancelled, '2026-10-20')
    const c = await getCompanyMoney('c1')
    expect(c.receivable).toBe(1180)
    expect(companyMoney('c1', cancelled, '2026-10-20').balance).toBe(0n)
  })

  it('what each order owes, summed over a customer, is what the receivables list shows for that customer', () => {
    fc.assert(
      fc.property(booksArb, dateArb, (books, today) => {
        const want = companyMoney('c1', books, today)
        const listed = books.orders.filter(o => o.companyId === 'c1').map(o => orderMoneyOf(o, books, today)).filter(m => m.listed)
        expect(sumP(listed.map(m => m.balance))).toBe(want.balance)
        expect(want.balance - want.overpaid).toBe(want.gross - want.received)
      }),
      { numRuns: 500 },
    )
  })
})

describe('Karachi "today" (lib/dates) at the day boundary', () => {
  it('the business date is the UTC+5 calendar date at every instant (Pakistan keeps no daylight saving)', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2029, 0, 1) }), ms => {
        vi.useFakeTimers({ now: ms, toFake: ['Date'] })
        expect(businessToday()).toBe(karachiDate(ms))
        vi.useRealTimers()
      }),
      { numRuns: 2000 },
    )
  })

  it('00:30 PKT on 1 March 2024 is 1 March (still 29 February in UTC); 23:59 PKT on 31 Dec is 31 Dec', () => {
    vi.useFakeTimers({ now: Date.UTC(2024, 1, 29, 19, 30), toFake: ['Date'] })
    expect(businessToday()).toBe('2024-03-01')
    vi.setSystemTime(Date.UTC(2026, 11, 31, 18, 59))
    expect(businessToday()).toBe('2026-12-31')
    vi.setSystemTime(Date.UTC(2026, 11, 31, 19, 0))
    expect(businessToday()).toBe('2027-01-01')
  })
})
