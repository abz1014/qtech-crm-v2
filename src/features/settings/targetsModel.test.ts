import { describe, expect, it } from 'vitest'
import {
  compactPkr,
  progressLine,
  shownQuarters,
  cellIntent,
  cellKey,
  cellProgress,
  checkTargetAmount,
  indexTargets,
  MAX_TARGET,
  planCopy,
  targetsFooter,
  previousQuarter,
  quarterMonths,
  quarterOfDate,
  quarterPhase,
  type ProgressRow,
  type TargetRow,
} from '@/features/settings/targetsModel'

const t = (user_id: string, year: number, quarter: number, amount: number): TargetRow => ({ id: `${user_id}-${year}-${quarter}`, user_id, year, quarter, target_net_pkr: amount })
const prog = (over: Partial<ProgressRow> = {}): ProgressRow => ({
  user_id: 'a',
  year: 2026,
  quarter: 4,
  target_net: 9_000_000,
  achieved_net: 2_000_000,
  on_pace_net: 3_000_000,
  behind_pace: 1_000_000,
  excluded_count: 0,
  ...over,
})

describe('quarters', () => {
  it('reads the calendar quarter of a date', () => {
    expect(quarterOfDate('2026-01-01')).toEqual({ year: 2026, quarter: 1 })
    expect(quarterOfDate('2026-03-31')).toEqual({ year: 2026, quarter: 1 })
    expect(quarterOfDate('2026-04-01')).toEqual({ year: 2026, quarter: 2 })
    expect(quarterOfDate('2026-12-31')).toEqual({ year: 2026, quarter: 4 })
  })
  it('Q1 reaches back into last year Q4', () => {
    expect(previousQuarter(2027, 1)).toEqual({ year: 2026, quarter: 4 })
    expect(previousQuarter(2026, 3)).toEqual({ year: 2026, quarter: 2 })
  })
  it('knows past, current and future', () => {
    expect(quarterPhase(2026, 3, '2026-10-15')).toBe('past')
    expect(quarterPhase(2026, 4, '2026-10-15')).toBe('current')
    expect(quarterPhase(2027, 1, '2026-10-15')).toBe('future')
    expect(quarterPhase(2025, 4, '2026-01-01')).toBe('past')
  })
  it('names the months', () => {
    expect(quarterMonths(1)).toBe('Jan to Mar')
    expect(quarterMonths(4)).toBe('Oct to Dec')
  })
})

describe('cellIntent (hunt HE-12)', () => {
  it('only a really empty cell removes; junk text is unreadable, never "empty"', () => {
    expect(cellIntent('', null)).toEqual({ kind: 'remove' })
    expect(cellIntent('   ', null)).toEqual({ kind: 'remove' })
    expect(cellIntent('abc', null).kind).toBe('unreadable')
    expect(cellIntent('500,000', 500000)).toEqual({ kind: 'amount', value: 500000 })
  })
})

describe('checkTargetAmount', () => {
  it('accepts a positive amount and rounds to paisa', () => {
    expect(checkTargetAmount(5_000_000)).toEqual({ ok: true, amount: 5_000_000 })
    expect(checkTargetAmount(1234.567)).toEqual({ ok: true, amount: 1234.57 })
  })
  it('refuses zero, negatives, nothing and too much, in words', () => {
    for (const bad of [0, -5, null, MAX_TARGET + 1]) {
      const r = checkTargetAmount(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10)
    }
  })
})

describe('planCopy (copy last quarter)', () => {
  const people = ['a', 'b', 'c', 'd']
  const rows = [t('a', 2026, 3, 100), t('b', 2026, 3, 200), t('c', 2026, 3, 300), t('b', 2026, 4, 999)]

  it('fills only the empty cells of the quarter from the one before', () => {
    const plan = planCopy(people, rows, 2026, 4)
    expect(plan.from).toEqual({ year: 2026, quarter: 3 })
    expect(plan.add).toEqual([
      { user_id: 'a', year: 2026, quarter: 4, target_net_pkr: 100 },
      { user_id: 'c', year: 2026, quarter: 4, target_net_pkr: 300 },
    ])
    expect(plan.kept).toBe(1) // b already has a Q4 target: never overwritten
    expect(plan.nothingToCopy).toBe(1) // d has no Q3 target
  })
  it('Q1 copies from the previous year Q4', () => {
    const plan = planCopy(['a'], [t('a', 2025, 4, 700)], 2026, 1)
    expect(plan.from).toEqual({ year: 2025, quarter: 4 })
    expect(plan.add).toEqual([{ user_id: 'a', year: 2026, quarter: 1, target_net_pkr: 700 }])
  })
  it('adds nothing when everything is already set or there is nothing to copy', () => {
    expect(planCopy(['b'], rows, 2026, 4).add).toEqual([])
    expect(planCopy(['d'], rows, 2026, 4).add).toEqual([])
  })
})

describe('cellProgress: amounts, never a bare percentage', () => {
  const target = t('a', 2026, 4, 9_000_000)
  it('has nothing to show without a target', () => {
    expect(cellProgress(undefined, undefined, 'current').kind).toBe('none')
  })
  it('a future quarter has not started, whatever the view says', () => {
    expect(cellProgress(target, prog(), 'future').kind).toBe('not-started')
  })
  it('behind pace is negative, from the two rupee figures', () => {
    const c = cellProgress(target, prog(), 'current')
    expect(c).toMatchObject({ kind: 'running', achieved: 2_000_000, onPace: 3_000_000, ahead: -1_000_000 })
  })
  it('ahead of pace is positive', () => {
    expect(cellProgress(target, prog({ achieved_net: 3_500_000 }), 'current').ahead).toBe(500_000)
  })
  it('a target with no payments yet reads as zero achieved', () => {
    expect(cellProgress(target, undefined, 'current')).toMatchObject({ achieved: 0, onPace: 0, ahead: 0 })
  })
  it('carries the count of payments that cannot count yet', () => {
    expect(cellProgress(target, prog({ excluded_count: 2 }), 'past').excluded).toBe(2)
  })
})

describe('targetsFooter', () => {
  const rows = [t('a', 2026, 4, 1), t('b', 2026, 4, 1), t('a', 2026, 3, 1), t('c', 2025, 4, 1), t('x', 2026, 4, 1)]
  it('counts people and who has a target in the current quarter', () => {
    expect(targetsFooter(['a', 'b', 'c'], rows, 2026, 4)).toBe('3 people · 2 with Q4 targets')
    expect(targetsFooter(['a'], rows, 2026, 4)).toBe('1 person · 1 with Q4 target')
  })
  it('for another year counts anyone with a target that year', () => {
    expect(targetsFooter(['a', 'b', 'c'], rows, 2026, null)).toBe('3 people · 2 with targets in 2026')
  })
})

describe('index', () => {
  it('finds a cell by person, year and quarter', () => {
    const idx = indexTargets([t('a', 2026, 2, 5)])
    expect(idx.get(cellKey('a', 2026, 2))?.target_net_pkr).toBe(5)
    expect(idx.get(cellKey('a', 2026, 3))).toBeUndefined()
  })
})

describe('targets grid, audit 2026-10-22', () => {
  it('shows this quarter and the next by default (across the year end), or the four of one year', () => {
    expect(shownQuarters('now', '2026-10-15', 2026)).toEqual([
      { year: 2026, quarter: 4 },
      { year: 2027, quarter: 1 },
    ])
    expect(shownQuarters('now', '2026-05-02', 2026)).toEqual([
      { year: 2026, quarter: 2 },
      { year: 2026, quarter: 3 },
    ])
    expect(shownQuarters('year', '2026-10-15', 2025).map(q => `${q.year}Q${q.quarter}`)).toEqual(['2025Q1', '2025Q2', '2025Q3', '2025Q4'])
  })

  it('says achieved against the target and the gap to pace in one line, the gap short from a million up', () => {
    expect(progressLine({ achieved: 3_862_102, ahead: 1_950_000 }, 8_000_000)).toBe('Achieved 3,862,102 of 8,000,000 · 1.95 M ahead of pace')
    expect(progressLine({ achieved: 1_200_000, ahead: -300_000 }, 5_000_000)).toBe('Achieved 1,200,000 of 5,000,000 · 300,000 behind pace')
    expect(progressLine({ achieved: 10, ahead: 0 }, 100)).toBe('Achieved 10 of 100 · On pace')
    expect(compactPkr(2_000_000)).toBe('2 M')
    expect(compactPkr(-1_234_567)).toBe('1.23 M')
  })
})