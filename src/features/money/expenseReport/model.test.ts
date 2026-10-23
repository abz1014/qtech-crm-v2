import { describe, expect, it } from 'vitest'
import type { Category, ExpenseGroup, ListedExpense } from '@/features/money/expenses/model'
import type { FlowRow } from '@/features/money/inOut/model'
import { buildExpenseReport, entriesCsv, expenseReportCsv, pctChange, share, toEntries, type ReportEntry } from '@/features/money/expenseReport/model'

/*
 * The Expenses report, worked by hand. September 2026 (the period) and August 2026 (the one before):
 *   Sep  Water 1,150 cash "Office water" · Water 500 cash "office  water" · Fuel 9,000 cash "LEA-1234" · Fuel 3,200 cash "LEB-5678"
 *        Supplier payment 100,000 bank, input tax 15,000 · Owner drawings 50,000 bank
 *   Aug  Water 1,150 cash · Fuel 7,800 cash "LEA-1234" · Supplier payment 80,000 bank
 * Sep total 163,850 (6 expenses): cash 13,850 (4), bank 150,000 (2). Aug total 88,950 → +74,900 (+84.2%).
 * P&L kinds (net of input tax): running 13,850; order 85,000; not a cost 50,000; input tax 15,000 → sum 163,850.
 */
const G: ExpenseGroup[] = [
  { id: 'g-office', name: 'Office running', kind: 'overhead', sort: 10 },
  { id: 'g-veh', name: 'Vehicles', kind: 'overhead', sort: 20 },
  { id: 'g-order', name: 'Order costs', kind: 'order_cost', sort: 50 },
  { id: 'g-owner', name: 'Owner and loans', kind: 'non_pnl', sort: 60 },
]
const cat = (id: string, name: string, groupId: string, grp: Category['grp'], budget: number | null = null, active = true): Category => ({
  id,
  name,
  groupId,
  grp,
  defaultPaidVia: 'cash',
  sort: 0,
  active,
  budget,
})
const C: Category[] = [
  cat('water', 'Water', 'g-office', 'overhead', 3000),
  cat('fuel', 'Fuel', 'g-veh', 'overhead', 10000),
  cat('sup', 'Supplier payment', 'g-order', 'order_cost'),
  cat('draw', 'Owner drawings', 'g-owner', 'non_pnl'),
  cat('tea', 'Tea', 'g-office', 'overhead', 2000),
]
let n = 0
const e = (paidOn: string, amount: number, categoryId: string, paidVia: 'cash' | 'bank', note: string | null = null, inputTax = 0): ListedExpense => ({
  id: `x${++n}`,
  paidOn,
  amount,
  inputTax,
  categoryId,
  paidVia,
  note,
  orderId: null,
  legId: null,
  payeeId: null,
  recurringId: null,
  bankMonth: null, period: null,
})
const ROWS = [
  e('2026-09-03', 1150, 'water', 'cash', 'Office water'),
  e('2026-09-17', 500, 'water', 'cash', ' office  water '),
  e('2026-09-08', 9000, 'fuel', 'cash', 'LEA-1234'),
  e('2026-09-21', 3200, 'fuel', 'cash', 'LEB-5678'),
  e('2026-09-11', 100000, 'sup', 'bank', null, 15000),
  e('2026-09-25', 50000, 'draw', 'bank'),
  e('2026-08-03', 1150, 'water', 'cash'),
  e('2026-08-08', 7800, 'fuel', 'cash', 'LEA-1234'),
  e('2026-08-11', 80000, 'sup', 'bank'),
]
const flow = (month: string, moneyOut: string, frozen = false): FlowRow => ({ month, moneyIn: '0.00', payments: 0, moneyOut, expenses: 0, frozen })
const FLOWS = [flow('2026-04', '0.00'), flow('2026-05', '70000.00'), flow('2026-08', '88950.00', true), flow('2026-09', '163850.00')]
const month = (key: string) => buildExpenseReport({ period: { kind: 'month', key }, entries: toEntries(ROWS), categories: C, groups: G, flows: FLOWS })

describe('the Expenses report, a month', () => {
  const v = month('2026-09')
  it('totals, cash and bank, and the change against the month before', () => {
    expect(v.total).toEqual({ amount: '163850.00', count: 6, cash: '13850.00', cashCount: 4, bank: '150000.00', bankCount: 2, inputTax: '15000.00' })
    expect(v.prev.amount).toBe('88950.00')
    expect(v.change).toBe('74900.00')
    expect(v.changePct).toBe(84.2)
    expect(v.label).toBe('September 2026')
    expect(v.prevLabel).toBe('August 2026')
  })
  it('splits exactly as Profit and loss does: kinds net of input tax, plus the input tax, add up to the total', () => {
    expect(v.kinds).toEqual({ running: '13850.00', order: '85000.00', notCost: '50000.00', inputTax: '15000.00' })
  })
  it('groups biggest first; categories inside; % of total; the month before; budgets per month', () => {
    expect(v.groups.map(g => [g.name, g.amount, g.share, g.prev])).toEqual([
      ['Order costs', '100000.00', 61, '80000.00'],
      ['Owner and loans', '50000.00', 30.5, '0.00'],
      ['Vehicles', '12200.00', 7.4, '7800.00'],
      ['Office running', '1650.00', 1, '1150.00'],
    ])
    const office = v.groups.find(g => g.id === 'g-office')!
    expect(office.categories.map(c => [c.name, c.amount, c.budget, c.budgetLeft])).toEqual([
      ['Water', '1650.00', '3000.00', '1350.00'],
      ['Tea', '0.00', '2000.00', '2000.00'], // a budget with nothing spent still shows
    ])
    expect(office.budget).toBe('5000.00')
    expect(v.budget).toBe('15000.00')
  })
  it('details: case and spaces ignored, biggest first, with their share of the category', () => {
    const water = v.groups.flatMap(g => g.categories).find(c => c.id === 'water')!
    expect(water.details).toEqual([{ key: 'office water', detail: 'Office water', amount: '1650.00', count: 2, share: 100 }])
    const fuel = v.groups.flatMap(g => g.categories).find(c => c.id === 'fuel')!
    expect(fuel.details.map(d => [d.detail, d.amount, d.share])).toEqual([
      ['LEA-1234', '9000.00', 73.8],
      ['LEB-5678', '3200.00', 26.2],
    ])
    expect(fuel.entries.map(x => x.paidOn)).toEqual(['2026-09-21', '2026-09-08'])
  })
  it('the categories and details add up to the total, to the paisa', () => {
    const cats = v.groups.flatMap(g => g.categories)
    expect(cats.reduce((s, c) => s + Number(c.amount), 0)).toBe(163850)
    for (const c of cats) expect(c.details.reduce((s, d) => s + Number(d.amount), 0)).toBe(Number(c.amount))
  })
  it('top 10 and by detail across categories', () => {
    expect(v.top.map(x => x.amount)).toEqual(['100000.00', '50000.00', '9000.00', '3200.00', '1150.00', '500.00'])
    expect(v.byDetail.map(d => [d.detail, d.amount, d.categories])).toEqual([
      ['LEA-1234', '9000.00', ['Fuel']],
      ['LEB-5678', '3200.00', ['Fuel']],
      ['Office water', '1650.00', ['Water']],
    ])
  })
  it('trend: the last 6 months from In vs out, this month marked; the cross-check is 0 when the books agree', () => {
    expect(v.trend.map(t => [t.label, t.amount, t.current])).toEqual([
      ['Apr 2026', '0.00', false],
      ['May 2026', '70000.00', false],
      ['Jun 2026', '0.00', false],
      ['Jul 2026', '0.00', false],
      ['Aug 2026', '88950.00', false],
      ['Sep 2026', '163850.00', true],
    ])
    expect(v.unexplained).toBe('0.00')
    expect(month('2026-08').frozenMonths).toBe(1)
  })
  it('a closed month whose frozen money out differs from its entries shows the difference', () => {
    const w = buildExpenseReport({ period: { kind: 'month', key: '2026-08' }, entries: toEntries(ROWS), categories: C, groups: G, flows: [flow('2026-08', '89000.00', true)] })
    expect(w.unexplained).toBe('50.00')
  })
})

describe('the Expenses report, a quarter', () => {
  const v = buildExpenseReport({ period: { kind: 'quarter', key: '2026-Q3' }, entries: toEntries(ROWS), categories: C, groups: G, flows: FLOWS })
  it('sums its three months; budgets x 3; previous quarter is Q2; 4 quarters of trend', () => {
    expect(v.total.amount).toBe('252800.00')
    expect(v.total.count).toBe(9)
    expect(v.months).toBe(3)
    expect(v.groups.find(g => g.id === 'g-office')!.categories.find(c => c.id === 'water')!.budget).toBe('9000.00')
    expect(v.prev.amount).toBe('0.00')
    expect(v.changePct).toBeNull()
    expect(v.trend.map(t => t.label)).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026'])
    expect(v.trend[2].amount).toBe('70000.00')
  })
})

describe('helpers and CSV', () => {
  it('percent change and share', () => {
    expect(pctChange('150.00', '100.00')).toBe(50)
    expect(pctChange('50.00', '0.00')).toBeNull()
    expect(share('850.00', '871338.00')).toBe(0.1)
    expect(share('1.00', '0.00')).toBe(0)
  })
  it('an unknown category is "Category removed" in the Other group, as a running cost', () => {
    const v = buildExpenseReport({ period: { kind: 'month', key: '2026-09' }, entries: toEntries([e('2026-09-01', 10, 'gone', 'cash')]), categories: C, groups: G, flows: [] })
    expect(v.groups[0]).toMatchObject({ id: 'other', name: 'Other', amount: '10.00' })
    expect(v.kinds.running).toBe('10.00')
    expect(v.unexplained).toBe('-10.00')
  })
  it('the CSV carries the same figures', () => {
    const csv = expenseReportCsv(month('2026-09'))
    expect(csv.headers[0]).toBe('Section')
    expect(csv.rows[0]).toEqual(['Total', 'September 2026', 'Spent (gross, input tax included)', '', 6, 163850, 88950, '', ''])
    expect(csv.rows.filter(r => r[0] === 'Category').reduce((s, r) => s + (r[5] as number), 0)).toBe(163850)
    expect(csv.rows.some(r => r[0] === 'Detail' && r[3] === 'LEA-1234' && r[5] === 9000)).toBe(true)
  })
  it('the entries CSV of a category, oldest first', () => {
    const list: ReportEntry[] = toEntries([e('2026-09-08', 9000, 'fuel', 'cash', 'LEA-1234'), e('2026-09-02', 3200, 'fuel', 'cash', 'LEB-5678')])
    expect(entriesCsv('Fuel', list).rows.map(r => r[0])).toEqual(['2026-09-02', '2026-09-08'])
  })
})
