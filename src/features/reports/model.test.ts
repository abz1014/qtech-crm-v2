import { describe, expect, it } from 'vitest'
import {
  daysText,
  monthLabel,
  pct,
  showPct,
  summariseFloat,
  summariseOutcomes,
  summariseRepeat,
  summariseTurnaround,
} from '@/features/reports/model'

/*
 * The same hand-computed fixture as supabase/tests/0053_reports.test.sql: rows are what the views return for it,
 * and the expected numbers were counted by hand there (7 RFQs, r1..r7).
 */
describe('pct', () => {
  it('rounds to a whole percent and refuses to divide by nothing', () => {
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
    expect(pct(0, 5)).toBe(0)
    expect(pct(1, 0)).toBeNull()
    expect(showPct(null)).toBe('not enough data')
    expect(showPct(57)).toBe('57%')
  })
})

describe('RFQ outcomes by close reason', () => {
  const rows = [
    { outcome: 'closed' as const, closeReason: 'competitor', rfqs: 1 },
    { outcome: 'closed' as const, closeReason: 'price', rfqs: 2 },
    { outcome: 'open' as const, closeReason: null, rfqs: 3 },
    { outcome: 'won' as const, closeReason: null, rfqs: 1 },
  ]
  it('counts won 1, closed 3, open 3 of 7, and the win rate over those answered', () => {
    const s = summariseOutcomes(rows)
    expect([s.total, s.won, s.closed, s.open]).toEqual([7, 1, 3, 3])
    expect(s.winRate).toBe(25)
  })
  it('lists reasons biggest first, labelled in the words the close dialog uses, with their share of closed', () => {
    expect(summariseOutcomes(rows).reasons).toEqual([
      { key: 'price', label: 'Price too high', count: 2, share: 67 },
      { key: 'competitor', label: 'The customer chose a competitor', count: 1, share: 33 },
    ])
  })
  it('has no win rate and no reasons when nothing is answered', () => {
    const s = summariseOutcomes([{ outcome: 'open', closeReason: null, rfqs: 2 }])
    expect(s.winRate).toBeNull()
    expect(s.reasons).toEqual([])
  })
  it('puts an unknown reason under "Another reason"', () => {
    expect(summariseOutcomes([{ outcome: 'closed', closeReason: null, rfqs: 1 }]).reasons[0].label).toBe('Another reason')
  })
})

describe('float coverage and conversion', () => {
  const rows = [
    { state: 'covered', rfqs: 2, itemsTotal: 3, itemsQuoted: 3, won: 1, closed: 0, open: 1 },
    { state: 'floated_awaiting', rfqs: 1, itemsTotal: 1, itemsQuoted: 0, won: 0, closed: 1, open: 0 },
    { state: 'no_offer_anywhere', rfqs: 1, itemsTotal: 1, itemsQuoted: 0, won: 0, closed: 0, open: 1 },
    { state: 'not_floated', rfqs: 2, itemsTotal: 1, itemsQuoted: 0, won: 0, closed: 1, open: 1 },
    { state: 'partly_covered', rfqs: 1, itemsTotal: 2, itemsQuoted: 1, won: 0, closed: 1, open: 0 },
  ]
  const s = summariseFloat(rows)
  it('orders the groups as the work flows', () => {
    expect(s.lines.map(l => l.state)).toEqual(['not_floated', 'floated_awaiting', 'partly_covered', 'covered', 'no_offer_anywhere'])
  })
  it('covers 4 of the 7 items on the 5 floated RFQs (57%)', () => {
    expect([s.floatedRfqs, s.floatedItems, s.floatedItemsQuoted, s.coverage]).toEqual([5, 7, 4, 57])
  })
  it('wins 1 of 3 answered floated RFQs (33%) and 0 of 1 not floated (0%)', () => {
    expect([s.floatedWinRate, s.notFloatedWinRate]).toEqual([33, 0])
  })
  it('gives the covered group a 100% win rate among its answered (1 won, 0 closed)', () => {
    expect(s.lines.find(l => l.state === 'covered')?.winRate).toBe(100)
  })
  it('is empty and honest with no RFQs', () => {
    const e = summariseFloat([])
    expect(e.lines).toEqual([])
    expect(e.coverage).toBeNull()
  })
})

describe('clarification turnaround', () => {
  const rows = [
    { month: '2026-03-01', asked: 3, answered: 2, withdrawn: 1, open: 0, avgDays: 3.5, slowestDays: 5, totalDays: 7 },
    { month: '2026-04-01', asked: 2, answered: 1, withdrawn: 0, open: 1, avgDays: 1, slowestDays: 1, totalDays: 1 },
  ]
  it('shows the newest month first and totals 5 asked, 3 answered, 1 open', () => {
    const s = summariseTurnaround(rows)
    expect(s.rows.map(r => r.month)).toEqual(['2026-04-01', '2026-03-01'])
    expect([s.asked, s.answered, s.open]).toEqual([5, 3, 1])
  })
  it('averages over every answered question: 8 days over 3 answers is 2.7, not the mean of 3.5 and 1', () => {
    expect(summariseTurnaround(rows).avgDays).toBe(2.7)
  })
  it('has no average when nothing was answered', () => {
    expect(summariseTurnaround([]).avgDays).toBeNull()
  })
  it('words months and days', () => {
    expect(monthLabel('2026-03-01')).toBe('Mar 2026')
    expect(daysText(1)).toBe('1 day')
    expect(daysText(3.5)).toBe('3.5 days')
    expect(daysText(0)).toBe('0 days')
    expect(daysText(null)).toBe('not enough data')
  })
})

describe('repeat customers', () => {
  const rows = [
    { companyId: 'b', name: 'P01 B', orders: 1, firstOrderOn: '2026-02-01', lastOrderOn: '2026-02-01', rfqs: 3, isRepeat: false },
    { companyId: 'a', name: 'P01 A', orders: 2, firstOrderOn: '2026-01-10', lastOrderOn: '2026-03-05', rfqs: 2, isRepeat: true },
  ]
  it('lists the most orders first and finds 1 repeat customer of 2 (50%)', () => {
    const s = summariseRepeat(rows)
    expect(s.rows.map(r => r.name)).toEqual(['P01 A', 'P01 B'])
    expect([s.customers, s.orders, s.repeat, s.share]).toEqual([2, 3, 1, 50])
  })
  it('has no share with no customers', () => {
    expect(summariseRepeat([]).share).toBeNull()
  })
})
