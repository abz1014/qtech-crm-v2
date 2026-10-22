import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Category, ExpenseGroup, ListedExpense } from '@/features/money/expenses/model'
import type { FlowRow } from '@/features/money/inOut/model'
import { periodOf } from '@/features/money/inOut/model'
import { buildExpenseReport, toEntries } from '@/features/money/expenseReport/model'
import { shiftMonth } from '@/features/money/expenses/model'
import { cashMonth, expensesFor, forMonthOfExpense, monthOf, monthPnlLive, quarterMonths, roundDiv, rs, sumP, type Books, type Expense, type Group } from '@/test/money-oracle/oracle'
import { RUNS_HEAVY, booksArb, paisaArb } from '@/test/money-oracle/arbitraries'

/*
 * The Expenses report (2026-10-22) against the oracle. Random books; the report is fed the expenses the way the app reads them
 * (rows of the expenses table) and the cash-flow months the way v_month_cash_flow returns them. For a month and for a quarter:
 *   total spent                  = the oracle's cash out (In vs out "money out", P&L "cash out")
 *   running / order / not a cost = the oracle's P&L overheads / order costs / not in P&L (net of input tax)
 *   input tax                    = the oracle's input tax;  running + order + not a cost + input tax = total
 *   cash + bank                  = total, each the oracle's own sum by paid via
 *   groups, categories, details  add up to the total; the In vs out cross-check is 0
 * 0087 for-month: some expenses carry a period (a monthly bill for the month before or after the one paid). The report then
 * counts each one in the month it is FOR (the oracle's expensesFor), while its `paid` side still equals In vs out and the P&L,
 * and the bridge holds to the paisa: for-total - paid elsewhere + paid here for other months = paid.
 */
const GROUPS: ExpenseGroup[] = [
  { id: 'g-run', name: 'Office running', kind: 'overhead', sort: 10 },
  { id: 'g-veh', name: 'Vehicles', kind: 'overhead', sort: 20 },
  { id: 'g-ord', name: 'Order costs', kind: 'order_cost', sort: 30 },
  { id: 'g-own', name: 'Owner and loans', kind: 'non_pnl', sort: 40 },
]
const CATS: Array<{ id: string; grp: Group; group: string }> = [
  { id: 'cat-water', grp: 'overhead', group: 'g-run' },
  { id: 'cat-fuel', grp: 'overhead', group: 'g-veh' },
  { id: 'cat-sup', grp: 'order_cost', group: 'g-ord' },
  { id: 'cat-frt', grp: 'order_cost', group: 'g-ord' },
  { id: 'cat-draw', grp: 'non_pnl', group: 'g-own' },
]
const CATEGORIES: Category[] = CATS.map((c, i) => ({ id: c.id, name: c.id, grp: c.grp, groupId: c.group, defaultPaidVia: 'bank', sort: i, active: true, budget: i === 0 ? 3000 : null }))
const DETAILS = [null, 'LEA-1234', 'lea-1234 ', 'Office water']
const MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']

type Ex = Expense & { via: 'cash' | 'bank'; detail: string | null }

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
          cash: fc.boolean(),
          detail: fc.nat({ max: DETAILS.length - 1 }),
          shift: fc.constantFrom(0, 0, 0, -1, 1),
        }),
        { maxLength: 40 },
      ),
      fc.constantFrom(...MONTHS),
    )
    .map(([list, month]) => {
      const expenses: Ex[] = list.map((e, i) => {
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
          supplierPayment: c.id === 'cat-sup',
          via: e.cash ? 'cash' : 'bank',
          detail: DETAILS[e.detail],
          period: e.shift === 0 ? null : shiftMonth(e.month, e.shift),
        }
      })
      const books: Books = { ...b, expenses }
      return { books, expenses, month }
    }),
)

const listed = (xs: readonly Ex[]): ListedExpense[] =>
  xs.map(e => ({
    id: e.id,
    paidOn: e.date,
    amount: Number(rs(e.amount)),
    inputTax: Number(rs(e.inputTax)),
    categoryId: e.categoryId,
    paidVia: e.via,
    note: e.detail,
    orderId: null,
    legId: null,
    payeeId: null,
    recurringId: null,
    bankMonth: null,
    period: e.period ?? null,
  }))
const flowsOf = (books: Books): FlowRow[] =>
  MONTHS.map(m => {
    const c = cashMonth(m, books)
    return { month: m, moneyIn: rs(c.in), payments: c.payments, moneyOut: rs(c.out), expenses: c.expenses, frozen: false }
  })

function check(kind: 'month' | 'quarter') {
  fc.assert(
    fc.property(scenarioArb, ({ books, expenses, month }) => {
      const p = periodOf(kind, month)
      const v = buildExpenseReport({ period: p, entries: toEntries(listed(expenses)), categories: CATEGORIES, groups: GROUPS, flows: flowsOf(books) })
      const ms = kind === 'month' ? [month] : quarterMonths(p.key)
      const pnl = ms.map(m => monthPnlLive(m, books))
      const out = sumP(ms.map(m => cashMonth(m, books).out))
      const paidHere = expenses.filter(e => ms.includes(monthOf(e.date)))
      const mine = expenses.filter(e => ms.includes(forMonthOfExpense(e)))
      const f = expensesFor(ms, books)
      // the cash side: In vs out's money out and the P&L lines, by the day paid
      expect(v.paid.amount).toBe(rs(out))
      expect(v.paid.count).toBe(paidHere.length)
      expect(v.paidKinds).toEqual({
        running: rs(sumP(pnl.map(x => x.overheads))),
        order: rs(sumP(pnl.map(x => x.orderCosts))),
        notCost: rs(sumP(pnl.map(x => x.nonPnl))),
        inputTax: rs(sumP(pnl.map(x => x.inputTax))),
      })
      // the report itself, by the month each expense is for
      expect(v.total.amount).toBe(rs(f.amount))
      expect(v.total.count).toBe(f.count)
      expect(v.kinds).toEqual({ running: rs(f.overheads), order: rs(f.orderCosts), notCost: rs(f.nonPnl), inputTax: rs(f.inputTax) })
      expect(v.forHerePaidElsewhere).toBe(rs(f.forHerePaidElsewhere))
      expect(v.paidForOther).toBe(rs(f.paidForOther))
      const P = (a: string) => BigInt(Math.round(Number(a) * 100))
      expect(rs(P(v.total.amount) - P(v.forHerePaidElsewhere) + P(v.paidForOther))).toBe(v.paid.amount)
      const k = v.kinds
      expect(rs(sumP([k.running, k.order, k.notCost, k.inputTax].map(a => BigInt(Math.round(Number(a) * 100)))))).toBe(v.total.amount)
      expect(v.total.cash).toBe(rs(sumP(mine.filter(e => e.via === 'cash').map(e => e.amount))))
      expect(v.total.bank).toBe(rs(sumP(mine.filter(e => e.via === 'bank').map(e => e.amount))))
      expect(v.unexplained).toBe('0.00')
      const toP = (a: string) => BigInt(Math.round(Number(a) * 100))
      expect(rs(sumP(v.groups.map(g => toP(g.amount))))).toBe(v.total.amount)
      for (const g of v.groups) {
        expect(rs(sumP(g.categories.map(c => toP(c.amount))))).toBe(g.amount)
        for (const c of g.categories) expect(rs(sumP(c.details.map(d => toP(d.amount))))).toBe(c.amount)
      }
      expect(v.trend[v.trend.length - 1].amount).toBe(v.paid.amount)
    }),
    RUNS_HEAVY,
  )
}

describe('the Expenses report agrees with the oracle (In vs out, Profit and loss)', () => {
  it('a month', () => check('month'))
  it('a calendar quarter', () => check('quarter'))
})
