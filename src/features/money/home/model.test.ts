import { describe, expect, it } from 'vitest'
import { countWord, moneyHomeFigures } from '@/features/money/home/model'

const flow = (month: string, moneyIn: string, moneyOut: string, payments = 1, expenses = 1) => ({ month, moneyIn, payments, moneyOut, expenses, frozen: false })
const profit = (month: string, p: string, invoices = 2) => ({
  month,
  salesNet: '0',
  salesGst: '0',
  invoices,
  orderCostsMatched: '0',
  overheads: '0',
  profit: p,
  orderCostsPaid: '0',
  nonPnlPaid: '0',
  inputTaxPaid: '0',
})
const base = {
  today: '2026-10-22',
  summary: { outstanding: 2184600, overdue: 636715, overdueCount: 3 },
  flows: [flow('2026-09', '900000.00', '500000.00'), flow('2026-10', '1912400.00', '731850.00', 6, 14)],
  pnl: { '2026-10': { gstIn: '291700.00' } },
  profits: [profit('2026-08', '100.00'), profit('2026-09', '412300.00'), profit('2026-10', '5.00')],
  owed: { total: '1465000.00', count: 3 },
}

describe('Money home figures', () => {
  it('the four numbers, the GST inside what came in, and the profit of the last finished month', () => {
    const f = moneyHomeFigures(base)
    expect(f.monthName).toBe('October')
    expect(f.toCollect).toEqual({ total: 2184600, late: 636715, lateCount: 3 })
    expect(f.received).toEqual({ total: '1912400.00', count: 6 })
    expect(f.paidOut).toEqual({ total: '731850.00', count: 14 })
    expect(f.owed).toEqual({ total: '1465000.00', count: 3 })
    expect(f.gstShare).toBe('291700.00')
    expect(f.profit).toEqual({ monthKey: '2026-09', monthName: 'September', amount: '412300.00' })
  })
  it('a month with no money yet is zero, not loading; nothing loaded is null', () => {
    const f = moneyHomeFigures({ ...base, today: '2026-11-02' })
    expect(f.received).toEqual({ total: '0.00', count: 0 })
    expect(f.gstShare).toBe('0.00')
    expect(f.profit?.monthKey).toBe('2026-10')
    const none = moneyHomeFigures({ today: '2026-10-22', summary: null, flows: null, pnl: null, profits: null, owed: null })
    expect(none).toMatchObject({ toCollect: null, received: null, paidOut: null, owed: null, gstShare: null, profit: null })
  })
  it('a finished month with no invoices is not offered as the profit', () => {
    const f = moneyHomeFigures({ ...base, profits: [profit('2026-09', '0.00', 0), profit('2026-08', '100.00')] })
    expect(f.profit?.monthKey).toBe('2026-08')
  })
  it('counts in words', () => {
    expect(countWord(1, 'order')).toBe('1 order')
    expect(countWord(3, 'payment')).toBe('3 payments')
  })
})
