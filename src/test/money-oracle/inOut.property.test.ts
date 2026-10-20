import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildInOut, inOutCsv, periodOf, type DetailRow, type FlowRow, type ProfitRow } from '@/features/money/inOut/model'
import { cashMonth, monthOf, profitMonth, quarterMonths, roundDiv, rs, sumP, type Books, type Expense, type Group } from '@/test/money-oracle/oracle'
import { RUNS_HEAVY, booksArb, paisaArb } from '@/test/money-oracle/arbitraries'

/*
 * In vs out (owner decision 2026-10-20): the report arranges what the database summed (v_month_cash_flow, v_month_profit,
 * v_month_cash_out_detail). Fed the oracle's month figures, every quarter total, the explanation of profit against cash, the
 * category lines and the CSV must be the oracle's own sums, to the paisa.
 */

const CATS: Array<{ id: string; grp: Group }> = [
  { id: 'cat-fuel', grp: 'overhead' },
  { id: 'cat-util', grp: 'overhead' },
  { id: 'cat-sup', grp: 'order_cost' },
  { id: 'cat-frt', grp: 'order_cost' },
  { id: 'cat-draw', grp: 'non_pnl' },
]
const DETAILS = [null, 'LEA-1234', 'lea-1234 ', 'Office water', 'office  water']
const MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']

const scenarioArb = booksArb.chain(b =>
  fc
    .tuple(
      fc.array(
        fc.record({
          cat: fc.nat({ max: CATS.length - 1 }),
          amount: paisaArb(20_000_000n),
          taxPct: fc.constantFrom(0n, 0n, 180n),
          month: fc.constantFrom(...MONTHS),
          day: fc.integer({ min: 1, max: 28 }),
          order: fc.option(fc.nat({ max: b.orders.length - 1 }), { nil: null }),
          detail: fc.nat({ max: DETAILS.length - 1 }),
        }),
        { maxLength: 30 },
      ),
      fc.array(fc.boolean(), { minLength: b.payments.length, maxLength: b.payments.length }),
      fc.constantFrom(...MONTHS),
    )
    .map(([list, voids, month]) => {
      const expenses: (Expense & { detail: string | null })[] = list.map((e, i) => {
        const c = CATS[e.cat]
        return {
          id: `e${i}`,
          date: `${e.month}-${String(e.day).padStart(2, '0')}`,
          amount: e.amount,
          inputTax: c.grp === 'order_cost' ? roundDiv(e.amount * e.taxPct, 1180n) : 0n,
          grp: c.grp,
          categoryId: c.id,
          orderId: c.grp === 'order_cost' && e.order !== null ? b.orders[e.order].id : null,
          legId: null,
          supplierPayment: c.id === 'cat-sup',
          detail: DETAILS[e.detail],
        }
      })
      // invoices and payments spread over the same months, so each quarter has money on both sides
      const shift = (d: string, i: number) => `${MONTHS[i % MONTHS.length]}-${d.slice(8)}`
      const books: Books = {
        ...b,
        invoices: b.invoices.map((v, i) => ({ ...v, date: v.date ? shift(v.date, i) : null })),
        payments: b.payments.map((p, i) => ({ ...p, date: shift(p.date, i + 3), voided: voids[i] })),
        expenses,
      }
      return { books, expenses, month }
    }),
)

const flowsOf = (books: Books): FlowRow[] =>
  MONTHS.map(m => {
    const c = cashMonth(m, books)
    return { month: m, moneyIn: rs(c.in), payments: c.payments, moneyOut: rs(c.out), expenses: c.expenses, frozen: false }
  })
const profitsOf = (books: Books): ProfitRow[] =>
  MONTHS.map(m => {
    const p = profitMonth(m, books)
    return {
      month: m,
      salesNet: rs(p.sales),
      salesGst: rs(p.salesGst),
      invoices: p.invoices,
      orderCostsMatched: rs(p.orderCosts),
      overheads: rs(p.overheads),
      profit: rs(p.profit),
      orderCostsPaid: rs(p.orderCostsPaid),
      nonPnlPaid: rs(p.nonPnlPaid),
      inputTaxPaid: rs(p.inputTaxPaid),
    }
  })
/** What v_month_cash_out_detail returns: month, category, detail (case and spaces ignored), gross, count. */
function detailsOf(expenses: readonly (Expense & { detail: string | null })[]): DetailRow[] {
  const by = new Map<string, DetailRow & { p: bigint }>()
  for (const e of expenses) {
    const shown = e.detail?.trim().replace(/\s+/g, ' ') || null
    const k = `${monthOf(e.date)}|${e.categoryId}|${(shown ?? '').toLowerCase()}`
    const r = by.get(k) ?? { month: monthOf(e.date), categoryId: e.categoryId, detail: shown, gross: '', count: 0, p: 0n }
    r.p += e.amount
    r.count += 1
    by.set(k, r)
  }
  return [...by.values()].map(({ p, ...r }) => ({ ...r, gross: rs(p) }))
}
const NAMES = Object.fromEntries(CATS.map(c => [c.id, c.id]))

describe('in vs out shows the oracle figures and explains the gap exactly', () => {
  it('a quarter: cash and profit totals are the sums of its months; profit - cash net is explained to the paisa', () => {
    fc.assert(
      fc.property(scenarioArb, ({ books, expenses, month }) => {
        const p = periodOf('quarter', month)
        const v = buildInOut(p, flowsOf(books), profitsOf(books), detailsOf(expenses), NAMES)
        const ms = quarterMonths(p.key)
        const cin = sumP(ms.map(m => cashMonth(m, books).in))
        const cout = sumP(ms.map(m => cashMonth(m, books).out))
        const profit = sumP(ms.map(m => profitMonth(m, books).profit))
        expect([v.cash.in, v.cash.out, v.cash.net, v.profit.profit]).toEqual([rs(cin), rs(cout), rs(cin - cout), rs(profit)])
        // the oracle's own explanation, from invoices, payments and expenses directly
        const inv = books.invoices.filter(i => i.date && ms.includes(monthOf(i.date)))
        const gross = sumP(inv.map(i => i.net + i.gst))
        const gst = sumP(inv.map(i => i.gst))
        const paidOrder = sumP(expenses.filter(e => e.grp === 'order_cost' && ms.includes(monthOf(e.date))).map(e => e.amount - e.inputTax))
        const matched = sumP(ms.map(m => profitMonth(m, books).orderCosts))
        const notCost = sumP(expenses.filter(e => ms.includes(monthOf(e.date))).map(e => (e.grp === 'non_pnl' ? e.amount - e.inputTax : 0n) + e.inputTax))
        expect(v.reconcile).toEqual({
          gap: rs(profit - (cin - cout)),
          owedMore: rs(gross - cin),
          gst: rs(gst),
          costsAhead: rs(paidOrder - matched),
          drawingsAndTax: rs(notCost),
          other: '0.00',
        })
        // money out by category adds up to money out, and each category's details to the category
        expect(v.unexplainedOut).toBe('0.00')
        for (const c of v.categories) expect(rs(sumP(c.details.map(d => BigInt(Math.round(Number(d.amount) * 100)))))).toBe(c.amount)
        // the CSV says the same
        const csv = inOutCsv(v)
        expect(csv.rows.find(r => r[2] === 'Profit (invoiced basis)')?.[5]).toBe(Number(rs(profit)))
        expect(csv.rows.find(r => r[2] === 'Other')?.[5]).toBe(0)
      }),
      RUNS_HEAVY,
    )
  })

  it('a month: the voided payments are never counted, and the trend ends with the month shown', () => {
    fc.assert(
      fc.property(scenarioArb, ({ books, expenses, month }) => {
        const v = buildInOut(periodOf('month', month), flowsOf(books), profitsOf(books), detailsOf(expenses), NAMES)
        const live = books.payments.filter(p => !p.voided && monthOf(p.date) === month)
        expect(v.cash.in).toBe(rs(sumP(live.map(p => p.amount))))
        expect(v.cash.payments).toBe(live.length)
        expect(v.trend).toHaveLength(6)
        expect(v.trend[5].period.key).toBe(month)
        expect(v.trend[5].net).toBe(v.cash.net)
      }),
      RUNS_HEAVY,
    )
  })
})
