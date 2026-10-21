import { describe, expect, it } from 'vitest'
import {
  CLEARING_ID,
  FREIGHT_ID,
  SUPPLIER_PAYMENT_ID,
  burstInserts,
  burstTotals,
  categoryMeta,
  cleanDetail,
  closedMonthOf,
  detailSuggestions,
  dueThisMonth,
  effectivePaidVia,
  filterExpenses,
  invalidRows,
  listTotals,
  markClosedRows,
  matchOrders,
  monthEnd,
  monthLabel,
  mostUsedCategory,
  newBurstRow,
  paidViaFor,
  recurringPaidOn,
  shiftMonth,
  showsInputTax,
  type BurstRow,
  type Category,
  type ListedExpense,
  type OrderTagOption,
  type RecurringTemplate,
} from '@/features/money/expenses/model'

const cat = (id: string, name: string, grp: Category['grp'], via: 'bank' | 'cash', active = true): Category => ({ id, name, grp, groupId: grp, defaultPaidVia: via, sort: 0, active, budget: null })
const CATS: Category[] = [
  cat('snacks', 'Office supplies & snacks', 'overhead', 'cash'),
  cat('fuel', 'Fuel & travel', 'overhead', 'cash'),
  cat('sal', 'Salaries', 'overhead', 'bank'),
  cat(SUPPLIER_PAYMENT_ID, 'Supplier payment', 'order_cost', 'bank'),
  cat('old', 'Retired', 'overhead', 'bank', false),
]
const D = { categoryId: 'snacks', today: '2026-11-06' }

describe('input tax visibility (owner decision 2026-10-14)', () => {
  it('shows on Supplier payment, Freight and Clearing only', () => {
    expect([SUPPLIER_PAYMENT_ID, FREIGHT_ID, CLEARING_ID].every(showsInputTax)).toBe(true)
    expect(showsInputTax('snacks')).toBe(false)
    expect(showsInputTax(null)).toBe(false)
  })
})

describe('defaults', () => {
  it('paid via follows the category', () => {
    expect(paidViaFor('snacks', CATS)).toBe('cash')
    expect(paidViaFor('sal', CATS)).toBe('bank')
    expect(paidViaFor('unknown', CATS)).toBe('bank')
  })

  it('the most used category of the last 30 days wins, ties go to the one used last', () => {
    const rows = [
      { category_id: 'fuel', paid_on: '2026-11-01' },
      { category_id: 'snacks', paid_on: '2026-11-02' },
      { category_id: 'snacks', paid_on: '2026-11-03' },
      { category_id: 'fuel', paid_on: '2026-11-05' },
    ]
    expect(mostUsedCategory(rows)).toEqual({ id: 'fuel', count: 2 })
    expect(mostUsedCategory([])).toBeNull()
    expect(mostUsedCategory([...rows, { category_id: 'snacks', paid_on: '2026-11-04' }])).toEqual({ id: 'snacks', count: 3 })
  })

  it('the first burst row uses the favourite and the next row carries the category above', () => {
    const first = newBurstRow(null, D, 'a')
    expect(first).toMatchObject({ categoryId: 'snacks', categorySource: 'most-used', date: '2026-11-06', paidVia: null })
    const second = newBurstRow({ ...first, categoryId: 'fuel', categorySource: 'typed' }, D, 'b')
    expect(second).toMatchObject({ categoryId: 'fuel', categorySource: 'carried', dateTyped: false })
    expect(effectivePaidVia(second, CATS)).toBe('cash')
  })

  it('category meta reads "Overhead, cash" as in the type-ahead', () => {
    expect(categoryMeta(CATS[0])).toBe('Overhead · cash')
    expect(categoryMeta(CATS[3])).toBe('Order cost · bank')
  })
})

describe('burst rows to one bulk insert', () => {
  const row = (id: string, amount: number | null, over: Partial<BurstRow> = {}): BurstRow => ({ ...newBurstRow(null, D, id), amount, ...over })

  it('skips empty rows, keeps the client ids and fills paid via from the category', () => {
    const rows = [row('r1', 450, { note: ' Tea and biscuits ' }), row('r2', null), row('r3', 100000, { categoryId: 'sal', date: '2026-09-30', dateTyped: true })]
    const out = burstInserts(rows, CATS)
    expect(out.map(o => o.id)).toEqual(['r1', 'r3'])
    expect(out[0]).toEqual({ id: 'r1', amount_pkr: 450, category_id: 'snacks', paid_on: '2026-11-06', paid_via: 'cash', description: 'Tea and biscuits', input_tax_pkr: 0 })
    expect(out[1]).toMatchObject({ paid_via: 'bank', paid_on: '2026-09-30' })
  })

  it('input tax is only sent for the three categories that show it', () => {
    const rows = [row('a', 590000, { categoryId: SUPPLIER_PAYMENT_ID, inputTax: 90000 }), row('b', 500, { inputTax: 80 })]
    expect(burstInserts(rows, CATS).map(r => r.input_tax_pkr)).toEqual([90000, 0])
  })

  it('the order tag (audit X1) is sent only when set; an order box holding text that matches nothing blocks the save', () => {
    const rows = [row('t', 5000, { orderId: 'o-42' }), row('u', 700), row('v', 100, { orderText: 'zzz' })]
    const out = burstInserts(rows, CATS)
    expect(out.map(o => o.id)).toEqual(['t', 'u'])
    expect(out[0]).toMatchObject({ order_id: 'o-42' })
    expect('order_id' in out[1]).toBe(false)
    expect(invalidRows(rows).map(r => r.id)).toEqual(['v'])
    expect(newBurstRow(rows[0], D, 'n').orderId).toBeNull() // never carried from the row above
  })

  it('totals count filled rows and a negative amount needs a change', () => {
    const rows = [row('a', 450), row('b', 600), row('c', null), row('d', -5)]
    expect(burstTotals(rows)).toEqual({ count: 3, total: 1045 })
    expect(invalidRows(rows).map(r => r.id)).toEqual(['d'])
  })
})

describe('closed month', () => {
  it('names the month from the P0001 sentence', () => {
    expect(closedMonthOf('September 2026 is closed. An admin can reopen it.')).toBe('September 2026')
    expect(closedMonthOf('Something else')).toBeNull()
    expect(monthLabel('2026-09-30')).toBe('September 2026')
  })

  it('marks only the rows dated in that month and leaves every row in place', () => {
    const base = newBurstRow(null, D, 'ok')
    const rows: BurstRow[] = [
      { ...base, amount: 450 },
      { ...base, id: 'bad', amount: 100000, date: '2026-09-30', dateTyped: true },
    ]
    const marked = markClosedRows(rows, 'September 2026 is closed. An admin can reopen it.')
    expect(marked).toHaveLength(2)
    expect(marked[0].error).toBeUndefined()
    expect(marked[1].error).toBe('September 2026 is closed. An admin can reopen it.')
    expect(marked[1].amount).toBe(100000)
  })
})

describe('months', () => {
  it('steps and ends months', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-11', 1)).toBe('2026-12')
    expect(monthEnd('2026-02')).toBe('2026-02-28')
  })
})

describe('recurring templates', () => {
  const t = (id: string, over: Partial<RecurringTemplate> = {}): RecurringTemplate => ({ id, label: id, categoryId: 'sal', amount: 1, dayOfMonth: null, active: true, startMonth: null, notes: null, paidVia: null, ...over })

  it('due this month: active, started, and not recorded for the period', () => {
    const list = [t('rent'), t('paused', { active: false }), t('later', { startMonth: '2026-12' }), t('done'), t('now', { startMonth: '2026-11' })]
    expect(dueThisMonth(list, new Set(['done']), '2026-11').map(x => x.id)).toEqual(['rent', 'now'])
  })

  it('is dated its day of the month once that day has passed, never in the future', () => {
    expect(recurringPaidOn({ dayOfMonth: 1 }, '2026-11-06')).toBe('2026-11-01')
    expect(recurringPaidOn({ dayOfMonth: 20 }, '2026-11-06')).toBe('2026-11-06')
    expect(recurringPaidOn({ dayOfMonth: null }, '2026-11-06')).toBe('2026-11-06')
  })
})

describe('list filters and totals', () => {
  const e = (id: string, categoryId: string, amount: number, paidVia: 'bank' | 'cash', inputTax = 0): ListedExpense => ({
    id, paidOn: '2026-11-03', amount, inputTax, categoryId, paidVia, note: null, orderId: null, legId: null, payeeId: null, recurringId: null, bankMonth: null,
  })
  const rows = [e('1', 'snacks', 450, 'cash'), e('2', 'sal', 100000, 'bank'), e('3', SUPPLIER_PAYMENT_ID, 590000, 'bank', 90000)]

  it('filters by group, category and paid via', () => {
    expect(filterExpenses(rows, { group: 'order_cost', categoryId: 'all', paidVia: 'all' }, CATS).map(r => r.id)).toEqual(['3'])
    expect(filterExpenses(rows, { group: 'all', categoryId: 'sal', paidVia: 'all' }, CATS).map(r => r.id)).toEqual(['2'])
    expect(filterExpenses(rows, { group: 'all', categoryId: 'all', paidVia: 'cash' }, CATS).map(r => r.id)).toEqual(['1'])
  })

  it('totals the paid amount, the input tax and the cost', () => {
    expect(listTotals(rows)).toEqual({ count: 3, total: 690450, inputTax: 90000, cost: 600450 })
  })
})

describe('order tag type-ahead (audit X1)', () => {
  const O = (n: number, company: string): OrderTagOption => ({ id: `o${n}`, ref: `ORD-${String(n).padStart(4, '0')}`, company })
  const ORDERS = [O(142, 'Karachi Glass'), O(42, 'Lahore Beverages'), O(7, 'Margalla Foods'), O(8, 'Indus Beverages')]

  it('a bare number finds that order first, then orders that contain the digits', () => {
    expect(matchOrders(ORDERS, '42').map(o => o.id)).toEqual(['o42', 'o142'])
    expect(matchOrders(ORDERS, 'ORD-0042').map(o => o.id)).toEqual(['o42'])
  })
  it('a customer name word finds its orders, newest first as listed', () => {
    expect(matchOrders(ORDERS, 'bev').map(o => o.id)).toEqual(['o42', 'o8'])
  })
  it('nothing typed lists nothing to reject, and no match is an empty list', () => {
    expect(matchOrders(ORDERS, 'zzz')).toEqual([])
  })
})

describe('the Detail field (owner request 2026-10-20)', () => {
  it('cleanDetail trims and squeezes spaces; empty is null', () => {
    expect(cleanDetail('  LEA-1234  ')).toBe('LEA-1234')
    expect(cleanDetail('Office   water')).toBe('Office water')
    expect(cleanDetail('   ')).toBeNull()
  })

  it('suggestions: one per detail (case ignored, latest spelling), this category first, then most used, then most recent', () => {
    const rows = [
      { detail: 'Office water', categoryId: 'util', count: 2, last: '2026-09-30' },
      { detail: 'office water', categoryId: 'util', count: 1, last: '2026-10-15' },
      { detail: 'LEA-1234', categoryId: 'fuel', count: 5, last: '2026-10-01' },
      { detail: 'LEB-777', categoryId: 'fuel', count: 1, last: '2026-10-18' },
      { detail: 'Courier to Lahore', categoryId: 'post', count: 1, last: '2026-10-10' },
    ]
    expect(detailSuggestions(rows, 'util')).toEqual(['office water', 'LEA-1234', 'LEB-777', 'Courier to Lahore'])
    expect(detailSuggestions(rows, 'fuel')).toEqual(['LEA-1234', 'LEB-777', 'office water', 'Courier to Lahore'])
    expect(detailSuggestions(rows, null, 2)).toEqual(['LEA-1234', 'office water'])
  })
})
