import { describe, expect, it } from 'vitest'
import type { FlowRow, ProfitRow } from '@/features/money/inOut/model'
import { averageOf, bestMonth, buildPoints, completeMonths, shortMonth, spanLabel, sumOf } from '@/features/money/profit/model'

const profitRow = (month: string, salesNet: string, over: Partial<ProfitRow> = {}): ProfitRow => ({
  month,
  salesNet,
  salesGst: '0.00',
  invoices: 1,
  orderCostsMatched: '0.00',
  overheads: '0.00',
  profit: salesNet,
  orderCostsPaid: '0.00',
  nonPnlPaid: '0.00',
  inputTaxPaid: '0.00',
  ...over,
})
const flowRow = (month: string, moneyIn: string): FlowRow => ({ month, moneyIn, payments: 1, moneyOut: '0.00', expenses: 0, frozen: false })

describe('completeMonths (the current month is never one)', () => {
  it('is the 12 months before this one, oldest first', () => {
    const m = completeMonths('2026-11-05', 12)
    expect(m).toHaveLength(12)
    expect(m[0]).toBe('2025-11')
    expect(m[11]).toBe('2026-10')
    expect(m).not.toContain('2026-11')
  })

  it('crosses a year end', () => {
    const m = completeMonths('2027-01-01', 12)
    expect(m[0]).toBe('2026-01')
    expect(m[11]).toBe('2026-12')
  })

  it('is 24 months for the longer trend', () => {
    const m = completeMonths('2026-11-05', 24)
    expect(m).toHaveLength(24)
    expect(m[0]).toBe('2024-11')
    expect(m[23]).toBe('2026-10')
  })
})

describe('buildPoints and the average', () => {
  const months = completeMonths('2026-11-05', 12)

  it('leaves the current month out even when the views have a row for it', () => {
    const pts = buildPoints(months, [profitRow('2026-11', '999999.00'), profitRow('2026-10', '1200.00')], [flowRow('2026-11', '888888.00')])
    expect(pts.map(p => p.month)).not.toContain('2026-11')
    expect(sumOf(pts, 'income')).toBe(120000n)
    expect(sumOf(pts, 'cash')).toBe(0n)
  })

  it('counts a month with nothing in it as zero, in the points and in the average', () => {
    const pts = buildPoints(months, [profitRow('2026-10', '1200.00')], [])
    expect(pts).toHaveLength(12)
    expect(pts.filter(p => p.income === 0n)).toHaveLength(11)
    expect(averageOf(pts, 'income')).toBe(10000n)
  })

  it('averages invoiced net and cash received separately, in paisa', () => {
    const profit = months.map(m => profitRow(m, '1000.00'))
    const flows = months.map(m => flowRow(m, '1180.00'))
    const pts = buildPoints(months, profit, flows)
    expect(averageOf(pts, 'income')).toBe(100000n)
    expect(averageOf(pts, 'cash')).toBe(118000n)
  })

  it('rounds the average half away from zero and is zero with no points', () => {
    const pts = buildPoints(['2026-09', '2026-10'], [profitRow('2026-09', '0.01')], [])
    expect(averageOf(pts, 'income')).toBe(1n)
    expect(averageOf([], 'income')).toBe(0n)
  })

  it('carries costs and profit from the profit view', () => {
    const pts = buildPoints(['2026-10'], [profitRow('2026-10', '1000.00', { orderCostsMatched: '300.00', overheads: '100.00', profit: '600.00', invoices: 4 })], [])
    expect(pts[0]).toMatchObject({ income: 100000n, costs: 40000n, profit: 60000n, invoices: 4 })
  })
})

describe('labels', () => {
  it('writes a month and a span in words', () => {
    expect(shortMonth('2026-03')).toBe('Mar 2026')
    expect(spanLabel(['2025-11', '2026-10'])).toBe('Nov 2025 to Oct 2026')
    expect(spanLabel([])).toBe('')
  })

  it('finds the best month, and none when every month is zero', () => {
    const pts = buildPoints(['2026-08', '2026-09', '2026-10'], [profitRow('2026-08', '10.00'), profitRow('2026-09', '30.00'), profitRow('2026-10', '20.00')], [])
    expect(bestMonth(pts)?.month).toBe('2026-09')
    expect(bestMonth(buildPoints(['2026-08'], [], []))).toBeNull()
  })
})
