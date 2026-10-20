import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toPaisa } from '@/lib/money'
import {
  buildAging,
  buildGst,
  buildPayables,
  buildPnl,
  buildTeam,
  closeState,
  defaultMonthEndMonth,
  pnlCsv,
  quarterOf,
  type AgingRow,
  type CategoryLine,
  type GstMonthRow,
  type PayableRow,
  type RawPnl,
} from '@/features/money/monthEnd/model'
import { monthEnd, shiftMonth } from '@/features/money/expenses/model'
import {
  CloseLedger,
  agingAsOf,
  basisOf,
  daysFrom,
  gstMonth,
  lastDayOf,
  livePnlFields,
  monthOf,
  monthPnlLive,
  nextMonth,
  payablesAsOf,
  resultOf,
  roundDiv,
  rs,
  splitPayment,
  sumP,
  teamMonth,
  type Books,
  type Expense,
  type Group,
  type Leg,
  type Order,
  type Rate,
} from '@/test/money-oracle/oracle'
import { RUNS, RUNS_HEAVY, booksArb, dateArb, paisaArb, scaledText } from '@/test/money-oracle/arbitraries'

/*
 * Month-end (money/monthEnd/model): the P&L, its CSV, aging, we owe, GST/FBR and team views arrange figures the database has
 * summed. These properties feed them the oracle's figures and check that every number on the screen and in the CSV is the
 * oracle's, that the CSV adds up to its own Result line, and that the month and quarter arithmetic is right at every boundary.
 */

const CATS: Array<{ id: string; name: string; grp: Group; sort: number; supplier?: boolean }> = [
  { id: 'cat-sal', name: 'Salaries', grp: 'overhead', sort: 10 },
  { id: 'cat-rent', name: 'Rent', grp: 'overhead', sort: 20 },
  { id: 'cat-sup', name: 'Supplier payment', grp: 'order_cost', sort: 110, supplier: true },
  { id: 'cat-frt', name: 'Freight', grp: 'order_cost', sort: 120 },
  { id: 'cat-draw', name: 'Owner drawings', grp: 'non_pnl', sort: 160 },
]

const expensesArb = (months: string[]): fc.Arbitrary<Expense[]> =>
  fc.array(
    fc.record({ cat: fc.nat({ max: CATS.length - 1 }), amount: paisaArb(20_000_000n), taxPct: fc.constantFrom(0n, 0n, 150n, 180n), month: fc.constantFrom(...months), day: fc.integer({ min: 1, max: 28 }) }),
    { maxLength: 25 },
  ).map(list =>
    list.map((e, i) => {
      const c = CATS[e.cat]
      return {
        id: `e${i}`,
        date: `${e.month}-${String(e.day).padStart(2, '0')}`,
        amount: e.amount,
        inputTax: c.grp === 'order_cost' ? roundDiv(e.amount * e.taxPct, 1180n) : 0n,
        grp: c.grp,
        categoryId: c.id,
        orderId: null,
        legId: null,
        supplierPayment: !!c.supplier,
      }
    }),
  )

/** Books whose payments and expenses fall in a handful of months, so each month has several of each. */
const monthBooksArb: fc.Arbitrary<{ books: Books; month: string }> = booksArb.chain(b => {
  const months = [...new Set(b.payments.map(p => monthOf(p.date)))]
  const pool = months.length ? months : ['2026-01']
  return fc.tuple(expensesArb(pool), fc.constantFrom(...pool)).map(([expenses, month]) => ({ books: { ...b, expenses }, month }))
})

const categoryLines = (books: Books, month: string): CategoryLine[] =>
  CATS.map(c => {
    const ex = books.expenses.filter(e => e.categoryId === c.id && monthOf(e.date) === month)
    return { c, ex }
  })
    .filter(x => x.ex.length > 0)
    .map(({ c, ex }) => ({
      categoryId: c.id,
      category: c.name,
      grp: c.grp,
      sort: c.sort,
      count: ex.length,
      gross: rs(sumP(ex.map(e => e.amount))),
      net: rs(sumP(ex.map(e => e.amount - e.inputTax))),
      inputTax: rs(sumP(ex.map(e => e.inputTax))),
      paidVia: 'bank' as const,
    }))

const rawPnl = (books: Books, month: string, adjust = 0n): RawPnl => {
  const p = monthPnlLive(month, books)
  return {
    netIn: rs(p.netIn),
    gstIn: rs(p.gstIn),
    unresolvedGross: rs(p.unresolvedGross),
    orderCosts: rs(p.orderCosts),
    overheads: rs(p.overheads),
    result: rs(p.result + adjust),
    nonPnlOut: rs(p.nonPnl),
    afterDrawings: rs(p.afterDrawings + adjust),
    cashOutTotal: rs(p.cashOut),
    inputTax: rs(p.inputTax),
    adjustResult: rs(adjust),
    adjustNonPnl: '0.00',
    frozenAt: null,
  }
}

describe('P&L (buildPnl, pnlCsv) shows the oracle figures and adds up', () => {
  it('money in = net + GST + unsplit = every payment of the month; costs by group; result and after drawings', () => {
    fc.assert(
      fc.property(monthBooksArb, fc.bigInt({ min: -500_000n, max: 500_000n }), ({ books, month }, adjust) => {
        const o = monthPnlLive(month, books)
        const pays = books.payments.filter(p => monthOf(p.date) === month)
        const unresolved = pays.filter(p => {
          const ord = books.orders.find(x => x.id === p.orderId) as Order
          return !splitPayment(p, ord, basisOf(ord, books.invoices)).countsInCash
        })
        const v = buildPnl(month, rawPnl(books, month, adjust), { count: pays.length, unresolved: unresolved.map(p => ({ orderRef: null, amount: rs(p.amount), reference: null })) }, categoryLines(books, month), {
          cashCount: 0,
          cashAmount: '0.00',
          bankCount: 0,
          bankAmount: '0.00',
        })
        expect(toPaisa(v.grossReceived)).toBe(sumP(pays.map(p => p.amount)))
        expect(toPaisa(v.orderCosts.net)).toBe(o.orderCosts)
        expect(toPaisa(v.overheads.net)).toBe(o.overheads)
        expect(toPaisa(v.notInPnl.total.net)).toBe(o.nonPnl)
        expect(toPaisa(v.orderCosts.gross) + toPaisa(v.overheads.gross) + toPaisa(v.notInPnl.total.gross)).toBe(o.cashOut)

        const csv = pnlCsv(v)
        const net = (label: string) => csv.rows.find(r => r[1] === label)?.[5] as number | undefined
        const result = csv.rows.find(r => r[0] === 'Result')?.[5] as number
        expect(toPaisa(result)).toBe(o.result + adjust)
        // the CSV adds up to its own Result line: net in - order costs - overheads + changes to closed months
        const sumLines =
          toPaisa(net('Payments received, split into net and GST') as number) +
          toPaisa(net('Order costs') as number) +
          toPaisa(net('Overheads') as number) +
          (adjust !== 0n ? toPaisa(net('Changes to closed months, counted this month') as number) : 0n)
        expect(sumLines).toBe(toPaisa(result))
        expect(toPaisa(csv.rows.find(r => r[0] === 'After drawings')?.[5] as number)).toBe(o.result + adjust - o.nonPnl)
        // the payment counts partition the month's payments
        const split = csv.rows.find(r => r[1] === 'Payments received, split into net and GST')?.[2] as number
        const notSplit = csv.rows.find(r => r[1] === 'Payments not yet split (excluded from net)')?.[2] as number
        expect(split + notSplit).toBe(pays.length)
        // gross received = split gross + unsplit gross
        expect(toPaisa(csv.rows[0][3] as number) + toPaisa(csv.rows[1][3] as number)).toBe(toPaisa(v.grossReceived))
      }),
      RUNS_HEAVY,
    )
  })

  it('team: net credited per person adds up to the P&L net in, less the unattributed payments', () => {
    fc.assert(
      fc.property(monthBooksArb, ({ books, month }) => {
        const team = teamMonth(month, books)
        const credited = [...team.entries()].map(([userId, t]) => ({ userId, name: userId, payments: t.count, net: rs(t.net), quarterNet: null, quarterTarget: null }))
        const v = buildTeam(month, '2026-10-20', credited, [{ userId: 'u1', name: 'u1', role: 'sales' }], [])
        const unattributed = sumP(
          books.payments
            .filter(p => monthOf(p.date) === month && p.credited === null)
            .map(p => {
              const ord = books.orders.find(x => x.id === p.orderId) as Order
              return splitPayment(p, ord, basisOf(ord, books.invoices)).net ?? 0n
            }),
        )
        expect(toPaisa(v.credited) + unattributed).toBe(monthPnlLive(month, books).netIn)
      }),
      RUNS_HEAVY,
    )
  })
})

describe('aging (buildAging) shows the oracle buckets', () => {
  it('bucket totals and the outstanding total are exact sums of the remaining gross; buckets at 30/31, 60/61, 90/91 days', () => {
    fc.assert(
      fc.property(booksArb, dateArb, (books, asOf) => {
        const a = agingAsOf(asOf, books)
        const rows: AgingRow[] = a.invoices.map(i => ({
          invoiceId: i.invoiceId,
          customer: 'C',
          invoiceNumber: i.invoiceId,
          orderRef: null,
          invoiceDate: asOf,
          ageDays: i.age,
          gross: rs(i.gross),
          applied: rs(i.applied),
          remaining: rs(i.remaining),
          bucket: i.bucket,
        }))
        const v = buildAging(asOf, rows, a.advances.map(x => ({ orderId: x.orderId, orderRef: null, customer: 'C', held: rs(x.held) })))
        expect(toPaisa(v.outstanding)).toBe(sumP(a.invoices.map(i => i.remaining)))
        for (const b of ['0-30', '31-60', '61-90', '90+'] as const) expect(toPaisa(v.totals[b].amount)).toBe(sumP(a.invoices.filter(i => i.bucket === b).map(i => i.remaining)))
        expect(toPaisa(v.advanceTotal)).toBe(sumP(a.advances.map(x => x.held)))
        for (const i of a.invoices) {
          expect(i.bucket).toBe(i.age <= 30 ? '0-30' : i.age <= 60 ? '31-60' : i.age <= 90 ? '61-90' : '90+')
          expect(i.remaining > 0n && i.applied >= 0n && i.applied <= i.gross).toBe(true)
        }
      }),
      RUNS_HEAVY,
    )
  })
})

describe('we owe (buildPayables) shows the oracle legs', () => {
  const legsArb = fc.array(
    fc.record({
      currency: fc.constantFrom('PKR', 'USD', 'EUR', null),
      placed: fc.option(dateArb, { nil: null }),
      priced: fc.array(fc.tuple(fc.integer({ min: 1, max: 20 }).map(q => `${q}.000`), fc.bigInt({ min: 0n, max: 50_000_000n }).map(u => scaledText(u, 4))), { maxLength: 3 }),
      paid: fc.array(fc.tuple(paisaArb(5_000_000_00n), fc.constantFrom(0n, 180n)), { maxLength: 2 }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  const ratesArb = fc.array(fc.record({ currency: fc.constantFrom('USD', 'EUR'), rate: fc.bigInt({ min: 100_000_000n, max: 400_000_000n }).map(u => scaledText(u, 6)), asOf: dateArb, manual: fc.boolean() }), { maxLength: 6 })

  it('owed, committed, paid, settled within 3%, overpaid, needs a rate (30 days), as the oracle', () => {
    fc.assert(
      fc.property(legsArb, ratesArb, dateArb, (ls, rates, asOf) => {
        const order: Order = { id: 'o', number: 1, companyId: 'c', ownerId: null, lines: [], terms: null, cancelledOn: null, basisUnknown: false, costsComplete: false, expectedCost: null }
        const legs: Leg[] = ls.map((l, i) => ({ id: `L${i}`, orderId: 'o', currency: l.currency, placedOn: l.placed, priced: l.priced, po: null }))
        const expenses: Expense[] = ls.flatMap((l, i) =>
          l.paid.map(([amount, tax], j) => ({ id: `x${i}${j}`, date: l.placed ?? asOf, amount, inputTax: roundDiv(amount * tax, 1180n), grp: 'order_cost' as Group, categoryId: 'sup', orderId: 'o', legId: `L${i}`, supplierPayment: true })),
        )
        const pay = payablesAsOf(asOf, legs, [order], expenses, rates as Rate[])
        const rows: PayableRow[] = pay.map(p => ({
          legId: p.legId,
          supplier: 'S',
          orderRef: null,
          leg: null,
          currency: p.currency,
          committed: p.committed7 === null ? null : rs(roundDiv(p.committed7, 100_000n)),
          rate: p.rate,
          committedPkr: p.committedPkr === null ? null : rs(p.committedPkr),
          paidPkr: rs(p.paid),
          owedPkr: p.owed === null ? null : rs(p.owed),
          state: p.state,
          flag: p.overpaid ? 'overpaid' : null,
        }))
        const v = buildPayables(asOf, rows)
        expect(toPaisa(v.owed)).toBe(sumP(pay.filter(p => p.state === 'owing').map(p => p.owed as bigint)))
        expect(v.owedCount).toBe(pay.filter(p => p.state === 'owing').length)
        expect(toPaisa(v.paid)).toBe(sumP(pay.map(p => p.paid)))
        expect(toPaisa(v.committed)).toBe(sumP(pay.filter(p => p.committedPkr !== null).map(p => p.committedPkr as bigint)))
        expect(toPaisa(v.paidOver)).toBe(sumP(pay.filter(p => p.overpaid).map(p => p.paid - (p.committedPkr as bigint))))
        // a settled leg has at most 3% of its committed amount left
        for (const p of pay) if (p.state === 'settled') expect((p.owed as bigint) * 100n <= 3n * (p.committedPkr as bigint)).toBe(true)
        // a foreign leg never uses a rate more than 30 days old
        for (const p of pay) if (p.currency !== 'PKR' && p.rate !== null) expect(rates.some(r => r.currency === p.currency && r.rate === p.rate && r.asOf <= asOf && daysFrom(r.asOf, asOf) <= 30)).toBe(true)
      }),
      RUNS_HEAVY,
    )
  })
})

describe('GST/FBR month (buildGst)', () => {
  it('totals over the months shown are exact sums; output GST and input tax are never netted', () => {
    fc.assert(
      fc.property(booksArb, fc.constantFrom('2024-06', '2025-01', '2026-03', '2027-12'), (b, month) => {
        const months = [...new Set(b.invoices.map(i => monthOf(i.date as string)))].sort()
        const all: GstMonthRow[] = months.map(m => {
          const g = gstMonth(m, { invoices: b.invoices, expenses: [] })
          return { month: m, invoiceCount: g.count, net: rs(g.net), gst: rs(g.gst), psidSets: 0, depositedCount: 0, depositedAmount: '0.00', toDeposit: rs(g.toDeposit), inputTax: '0.00' }
        })
        const v = buildGst(month, all, true)
        const shown = months.filter(m => m <= month).sort().reverse().slice(0, 3)
        expect(toPaisa(v.total.gst)).toBe(sumP(shown.map(m => gstMonth(m, { invoices: b.invoices, expenses: [] }).gst)))
        expect(toPaisa(v.total.net)).toBe(sumP(shown.map(m => gstMonth(m, { invoices: b.invoices, expenses: [] }).net)))
        expect(v.total.invoiceCount).toBe(shown.reduce((n, m) => n + gstMonth(m, { invoices: b.invoices, expenses: [] }).count, 0))
      }),
      RUNS_HEAVY,
    )
  })
})

describe('months and quarters at every boundary (Asia/Karachi calendar dates, leap years)', () => {
  const keyArb = fc.integer({ min: 2000 * 12, max: 2100 * 12 }).map(t => `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`)

  it('monthEnd and shiftMonth', () => {
    fc.assert(
      fc.property(keyArb, fc.integer({ min: -40, max: 40 }), (key, by) => {
        expect(monthEnd(key)).toBe(lastDayOf(key))
        expect(shiftMonth(key, by)).toBe(nextMonth(key, by))
      }),
      RUNS,
    )
    expect(monthEnd('2024-02')).toBe('2024-02-29')
    expect(monthEnd('2100-02')).toBe('2100-02-28')
    expect(monthEnd('2000-02')).toBe('2000-02-29')
  })

  it('the month-end checklist opens on the month that just ended; a month closes only after it has ended', () => {
    fc.assert(
      fc.property(dateArb, d => {
        expect(defaultMonthEndMonth(d)).toBe(nextMonth(monthOf(d), -1))
        expect(closeState(monthOf(d), d, new Set(), []).kind).toBe('not-ended')
        expect(closeState(nextMonth(monthOf(d), -1), d, new Set(), []).kind).toBe('open')
        const earlier = nextMonth(monthOf(d), -3)
        const s = closeState(nextMonth(monthOf(d), -1), d, new Set(), [earlier])
        expect(s.kind === 'open' && s.through).toBe(true)
      }),
      RUNS,
    )
  })

  it('quarter of a month and its last day', () => {
    fc.assert(
      fc.property(keyArb, dateArb, (key, today) => {
        const [y, m] = key.split('-').map(Number)
        const q = quarterOf(key, today)
        expect(q.quarter).toBe(Math.floor((m - 1) / 3) + 1)
        expect(q.end).toBe(lastDayOf(`${y}-${String(q.quarter * 3).padStart(2, '0')}`))
        expect(q.daysLeft).toBe(Math.max(0, Math.round((Date.UTC(+q.end.slice(0, 4), +q.end.slice(5, 7) - 1, +q.end.slice(8)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8))) / 86_400_000)))
      }),
      RUNS,
    )
  })
})

describe('month close (D-MR2) in the oracle: frozen at close, changes shown once, books always add up', () => {
  it('any sequence of edits, closes and reopens: the sum of what every month shows equals the live books', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
    const opArb = fc.oneof(
      fc.record({ kind: fc.constant('close' as const), m: fc.nat({ max: 4 }) }),
      fc.record({ kind: fc.constant('reopen' as const), m: fc.nat({ max: 4 }) }),
      fc.record({ kind: fc.constant('edit' as const), m: fc.nat({ max: 4 }), amount: fc.bigInt({ min: -1_000_000n, max: 1_000_000n }) }),
    )
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), ops => {
        const live = new Map(months.map(m => [m, 0n]))
        const ledger = new CloseLedger(m => ({ netIn: live.get(m) ?? 0n, gstIn: 0n, unresolvedGross: 0n, orderCosts: 0n, overheads: 0n, nonPnl: 0n }))
        for (const op of ops) {
          const m = months[op.m]
          if (op.kind === 'close') {
            // months close in order: everything before it closes first (close_months_through)
            for (const x of months.slice(0, op.m + 1)) ledger.close(x)
          } else if (op.kind === 'reopen') ledger.reopen(m)
          else live.set(m, (live.get(m) ?? 0n) + op.amount)
          const shown = sumP([...months, nextMonth(months[4])].map(x => ledger.shown(x).result))
          expect(shown).toBe(sumP(live.values()))
          // a closed month's own figure never moves while it stays closed
        }
      }),
      RUNS,
    )
  })

  it('a closed month keeps its figure while it stays closed, whatever is edited later', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), { minLength: 1, maxLength: 10 }), edits => {
        const live = new Map([['2026-01', 1000n], ['2026-02', 0n]])
        const ledger = new CloseLedger(m => ({ netIn: live.get(m) ?? 0n, gstIn: 0n, unresolvedGross: 0n, orderCosts: 0n, overheads: 0n, nonPnl: 0n }))
        ledger.close('2026-01')
        for (const e of edits) {
          live.set('2026-01', (live.get('2026-01') ?? 0n) + e)
          expect(ledger.shown('2026-01').result).toBe(1000n)
          expect(ledger.shown('2026-02').adjust.netIn).toBe((live.get('2026-01') ?? 0n) - 1000n)
        }
      }),
      RUNS,
    )
  })

  it('the live P&L of random books satisfies result = net in - order costs - overheads', () => {
    fc.assert(
      fc.property(monthBooksArb, ({ books, month }) => {
        const f = livePnlFields(books)(month)
        expect(resultOf(f)).toBe(monthPnlLive(month, books).result)
      }),
      RUNS_HEAVY,
    )
  })
})
