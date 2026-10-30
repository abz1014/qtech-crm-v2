import { describe, expect, it } from 'vitest'
import {
  buildInOut,
  categoriesOut,
  chosenPeriod,
  inOutCsv,
  isPeriodKey,
  periodLabel,
  periodMonths,
  periodOf,
  shiftPeriod,
  type DetailRow,
  type FlowRow,
  type ProfitRow,
} from '@/features/money/inOut/model'

/* The figures are the 0079 pgTAP fixture's (supabase/tests/0079_in_vs_out.test.sql), so screen, file and database agree. */
const flow = (month: string, moneyIn: string, payments: number, moneyOut: string, expenses: number, frozen = false): FlowRow => ({ month, moneyIn, payments, moneyOut, expenses, frozen })
const FLOWS: FlowRow[] = [
  flow('2019-12', '5900.00', 1, '4000.00', 1, true),
  flow('2020-01', '3000.50', 1, '4000.00', 2),
  flow('2020-03', '1000.00', 1, '10500.00', 2),
  flow('2020-04', '700.00', 1, '1100.00', 2),
]
const z = '0.00'
const profit = (month: string, p: Partial<ProfitRow>): ProfitRow => ({
  month, salesNet: z, salesGst: z, invoices: 0, orderCostsMatched: z, overheads: z, profit: z, orderCostsPaid: z, nonPnlPaid: z, inputTaxPaid: z, ...p,
})
const PROFITS: ProfitRow[] = [
  profit('2019-12', { orderCostsPaid: '3400.00', inputTaxPaid: '600.00' }),
  profit('2020-01', { salesNet: '10000.00', salesGst: '1800.00', invoices: 1, orderCostsMatched: '3400.00', overheads: '4000.00', profit: '2600.00' }),
  profit('2020-03', { overheads: '500.00', profit: '-500.00', nonPnlPaid: '10000.00' }),
  profit('2020-04', { overheads: '800.00', profit: '-800.00', orderCostsPaid: '300.00' }),
]
const SUP = 'cat-sup'
const FUEL = 'cat-fuel'
const UTIL = 'cat-util'
const DRAW = 'cat-draw'
const FRT = 'cat-frt'
const NAMES = { [SUP]: 'Supplier payment', [FUEL]: 'Fuel & travel', [UTIL]: 'Utilities', [DRAW]: 'Owner drawings', [FRT]: 'Freight' }
const DETAILS: DetailRow[] = [
  { month: '2019-12', categoryId: SUP, detail: null, gross: '4000.00', count: 1 },
  { month: '2020-01', categoryId: FUEL, detail: 'LEA-1234', gross: '4000.00', count: 2 },
  { month: '2020-03', categoryId: UTIL, detail: 'Office water', gross: '500.00', count: 1 },
  { month: '2020-03', categoryId: DRAW, detail: null, gross: '10000.00', count: 1 },
  { month: '2020-04', categoryId: UTIL, detail: 'office water', gross: '800.00', count: 1 },
  { month: '2020-04', categoryId: FRT, detail: null, gross: '300.00', count: 1 },
]

describe('periods: calendar quarters, exact boundaries', () => {
  it('a month falls in its quarter', () => {
    expect(periodOf('quarter', '2019-12')).toEqual({ kind: 'quarter', key: '2019-Q4' })
    expect(periodOf('quarter', '2020-01')).toEqual({ kind: 'quarter', key: '2020-Q1' })
    expect(periodOf('quarter', '2020-03')).toEqual({ kind: 'quarter', key: '2020-Q1' })
    expect(periodOf('quarter', '2020-04')).toEqual({ kind: 'quarter', key: '2020-Q2' })
  })
  it('a quarter has its three months; shifting crosses the year', () => {
    expect(periodMonths({ kind: 'quarter', key: '2020-Q1' })).toEqual(['2020-01', '2020-02', '2020-03'])
    expect(shiftPeriod({ kind: 'quarter', key: '2020-Q1' }, -1)).toEqual({ kind: 'quarter', key: '2019-Q4' })
    expect(shiftPeriod({ kind: 'month', key: '2020-01' }, -1)).toEqual({ kind: 'month', key: '2019-12' })
    expect(shiftPeriod({ kind: 'quarter', key: '2019-Q4' }, 1)).toEqual({ kind: 'quarter', key: '2020-Q1' })
  })
  it('labels, keys and the period in the address (never the future)', () => {
    expect(periodLabel({ kind: 'quarter', key: '2026-Q4' })).toBe('Q4 2026 (Oct to Dec)')
    expect(periodLabel({ kind: 'month', key: '2026-10' })).toBe('October 2026')
    expect(isPeriodKey('quarter', '2026-Q5')).toBe(false)
    expect(isPeriodKey('month', '2026-13')).toBe(false)
    expect(chosenPeriod('quarter', '2027-Q1', '2026-10-20')).toEqual({ kind: 'quarter', key: '2026-Q4' })
    expect(chosenPeriod('month', '2026-09', '2026-10-20')).toEqual({ kind: 'month', key: '2026-09' })
    expect(chosenPeriod('month', null, '2026-10-20')).toEqual({ kind: 'month', key: '2026-10' })
  })
})

describe('buildInOut (the 0079 fixture)', () => {
  const q1 = buildInOut({ kind: 'quarter', key: '2020-Q1' }, FLOWS, PROFITS, DETAILS, NAMES)

  it('cash: Q1 2020 in 4,000.50, out 14,500.00, net -10,499.50; Q4 2019 beside it', () => {
    expect(q1.cash).toMatchObject({ in: '4000.50', out: '14500.00', net: '-10499.50', payments: 2, expenses: 4, frozenMonths: 0, months: 3 })
    expect(q1.prevCash).toMatchObject({ in: '5900.00', out: '4000.00', net: '1900.00', frozenMonths: 1 })
  })

  it('profit, invoiced basis: Q1 2020 2,100.00 (sales 10,000.00, order costs 3,400.00, overheads 4,500.00)', () => {
    expect(q1.profit).toMatchObject({ sales: '10000.00', salesGst: '1800.00', orderCosts: '3400.00', overheads: '4500.00', profit: '2100.00' })
  })

  it('explains the gap exactly: 12,599.50 = 7,799.50 - 1,800.00 - 3,400.00 + 10,000.00', () => {
    expect(q1.reconcile).toEqual({ gap: '12599.50', owedMore: '7799.50', gst: '1800.00', costsAhead: '-3400.00', drawingsAndTax: '10000.00', refunds: '0.00', other: '0.00' })
    const q4 = buildInOut({ kind: 'quarter', key: '2019-Q4' }, FLOWS, PROFITS, DETAILS, NAMES)
    expect(q4.reconcile).toEqual({ gap: '-1900.00', owedMore: '-5900.00', gst: '0.00', costsAhead: '3400.00', drawingsAndTax: '600.00', refunds: '0.00', other: '0.00' })
  })

  it('money out by category, biggest first, adds up to money out; the previous quarter per category', () => {
    expect(q1.categories.map(c => [c.name, c.amount, c.count, c.prev])).toEqual([
      ['Owner drawings', '10000.00', 1, '0.00'],
      ['Fuel & travel', '4000.00', 2, '0.00'],
      ['Utilities', '500.00', 1, '0.00'],
      ['Supplier payment', '0.00', 0, '4000.00'],
    ])
    expect(q1.unexplainedOut).toBe('0.00')
  })

  it('details: one line per detail, case and spaces ignored across months', () => {
    const q2 = categoriesOut({ kind: 'quarter', key: '2020-Q2' }, [...DETAILS, { month: '2020-05', categoryId: UTIL, detail: ' OFFICE  WATER ', gross: '250.00', count: 1 }], NAMES)
    const util = q2.find(c => c.categoryId === UTIL)!
    expect(util.details).toEqual([{ detail: 'office water', amount: '1050.00', count: 2 }])
  })

  it('a frozen month whose figure differs from its lines shows the difference', () => {
    const v = buildInOut({ kind: 'month', key: '2019-12' }, [flow('2019-12', '5900.00', 1, '4100.00', 2, true)], PROFITS, DETAILS, NAMES)
    expect(v.unexplainedOut).toBe('100.00')
  })

  it('trend: the last 6 months or 4 quarters, ending with the period shown', () => {
    expect(q1.trend.map(t => [t.label, t.in, t.out, t.net, t.profit])).toEqual([
      ['Q2 2019', '0.00', '0.00', '0.00', '0.00'],
      ['Q3 2019', '0.00', '0.00', '0.00', '0.00'],
      ['Q4 2019', '5900.00', '4000.00', '1900.00', '0.00'],
      ['Q1 2020', '4000.50', '14500.00', '-10499.50', '2100.00'],
    ])
    const m = buildInOut({ kind: 'month', key: '2020-04' }, FLOWS, PROFITS, DETAILS, NAMES)
    expect(m.trend.map(t => t.label)).toEqual(['Nov 2019', 'Dec 2019', 'Jan 2020', 'Feb 2020', 'Mar 2020', 'Apr 2020'])
  })

  it('the CSV carries the same figures, with paisa, and its details add up to each category', () => {
    const csv = inOutCsv(q1)
    const amount = (line: string) => csv.rows.find(r => r[2] === line)?.[5]
    expect(amount('Money in (payments received, GST included)')).toBe(4000.5)
    expect(amount('Cash net (in less out)')).toBe(-10499.5)
    expect(amount('Profit (invoiced basis)')).toBe(2100)
    expect(amount('less GST in the invoices (for FBR)')).toBe(-1800)
    for (const cat of csv.rows.filter(r => r[0] === 'Money out by category')) {
      const lines = csv.rows.filter(r => r[0] === 'Money out by detail' && r[2] === cat[2])
      expect(lines.reduce((s, r) => s + (r[5] as number), 0)).toBeCloseTo(cat[5] as number, 2)
    }
    expect(csv.headers[6]).toBe('Previous: Q4 2019 (Oct to Dec) (PKR)')
  })
})

describe('refunds paid back to customers (0117)', () => {
  const withRefund = (rows: FlowRow[]): FlowRow[] => rows.map(r => (r.month === '2020-01' ? { ...r, refunds: '500.00', refundCount: 2 } : r))

  it('cash net takes the refunds off; money out stays the expenses', () => {
    const v = buildInOut(periodOf('quarter', '2020-02'), withRefund(FLOWS), PROFITS, DETAILS, NAMES)
    expect(v.cash.out).toBe('14500.00')
    expect(v.cash.refunds).toBe('500.00')
    expect(v.cash.refundCount).toBe(2)
    expect(v.cash.net).toBe('-10999.50')
  })

  it('the explanation gains a refunds line and still adds up with nothing left over', () => {
    const v = buildInOut(periodOf('quarter', '2020-02'), withRefund(FLOWS), PROFITS, DETAILS, NAMES)
    expect(v.reconcile.refunds).toBe('500.00')
    expect(v.reconcile.gap).toBe('13099.50')
    expect(v.reconcile.other).toBe('0.00')
  })

  it('with no refund nothing changes: the same net and no refunds line in the CSV', () => {
    const v = buildInOut(periodOf('quarter', '2020-02'), FLOWS, PROFITS, DETAILS, NAMES)
    expect(v.cash.refunds).toBe('0.00')
    expect(v.cash.net).toBe('-10499.50')
    expect(inOutCsv(v).rows.some(r => String(r[2]).startsWith('Refunds paid back'))).toBe(false)
  })

  it('the trend counts refunds as cash out, so in less out is the net beside it', () => {
    const v = buildInOut(periodOf('month', '2020-01'), withRefund(FLOWS), PROFITS, DETAILS, NAMES)
    const jan = v.trend.find(t => t.label === 'Jan 2020')!
    expect(jan.out).toBe('4500.00')
    expect(jan.net).toBe('-1499.50')
  })

  it('the CSV carries the refunds line', () => {
    const v = buildInOut(periodOf('quarter', '2020-02'), withRefund(FLOWS), PROFITS, DETAILS, NAMES)
    const rows = inOutCsv(v).rows
    expect(rows.find(r => String(r[2]).startsWith('Refunds paid back to customers') && r[0] === 'Cash')?.[5]).toBe(500)
    expect(rows.find(r => r[0] === 'Why they differ' && String(r[2]).startsWith('Refunds paid back'))?.[5]).toBe(500)
  })
})

