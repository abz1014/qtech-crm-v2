import { describe, expect, it } from 'vitest'
import { buildStatement, financialYearStart, fixed, toLines, type RawStatementLine } from './model'

const raw = (line_on: string, kind: string, debit: number, credit: number, ref: string, seq: number): RawStatementLine => ({
  line_on, kind, ref, order_number: 7, note: null, debit, credit, seq,
})

describe('customer statement (process audit 7)', () => {
  const lines = toLines([
    raw('2026-06-10', 'invoice', 1180, 0, 'INV-1', 1), // before the range: opening
    raw('2026-06-20', 'payment', 0, 500, 'cheque 1', 3), // before the range: opening
    raw('2026-07-05', 'invoice', 2360, 0, 'INV-2', 1),
    raw('2026-07-05', 'payment', 0, 100.5, 'cash', 3), // same day: invoice first, then the payment
    raw('2026-07-09', 'credit_note', 0, 590, 'CN-1', 2),
    raw('2026-07-20', 'refund', 200, 0, 'refund 1', 4), // a refund raises what they owe
    raw('2026-08-15', 'invoice', 999, 0, 'INV-3', 1), // after the range
    raw('2026-07-01', 'mystery', 5, 0, 'x', 9), // an unknown kind is ignored
  ])

  it('opens with everything before the first day and runs the balance line by line', () => {
    const s = buildStatement(lines, '2026-07-01', '2026-07-31')
    expect(fixed(s.opening)).toBe('680.00')
    expect(s.rows.map(r => [r.ref, fixed(r.balance)])).toEqual([
      ['INV-2', '3040.00'],
      ['cash', '2939.50'],
      ['CN-1', '2349.50'],
      ['refund 1', '2549.50'],
    ])
    expect(fixed(s.closing)).toBe('2549.50')
  })

  it('opening plus charged less paid is the closing balance', () => {
    const s = buildStatement(lines, '2026-07-01', '2026-07-31')
    expect(s.opening + s.charged - s.credited).toBe(s.closing)
    expect(fixed(s.charged)).toBe('2560.00')
    expect(fixed(s.credited)).toBe('690.50')
  })

  it('an empty range still shows the opening and closing balance, the same', () => {
    const s = buildStatement(lines, '2026-07-21', '2026-08-01')
    expect(s.rows).toEqual([])
    expect(s.closing).toBe(s.opening)
    expect(fixed(s.closing)).toBe('2549.50')
  })

  it('the Pakistani financial year starts on 1 July', () => {
    expect(financialYearStart('2026-10-30')).toBe('2026-07-01')
    expect(financialYearStart('2027-03-01')).toBe('2026-07-01')
    expect(financialYearStart('2026-07-01')).toBe('2026-07-01')
  })
})
