import { describe, expect, it } from 'vitest'
import { fixedPeriodNote, isShowableMonth, thisMonthKey } from '@/features/money/monthParam'

const TODAY = '2026-11-25'

describe('the month in a Money link', () => {
  it('this month is the Karachi month of today', () => {
    expect(thisMonthKey(TODAY)).toBe('2026-11')
  })

  it('shows a real month from 2000 up to this month, nothing else', () => {
    expect(isShowableMonth('2026-11', TODAY)).toBe(true)
    expect(isShowableMonth('2000-01', TODAY)).toBe(true)
    for (const bad of ['2026-13', '2026-00', '2026-1', 'oct', '2026-12', '1999-12', null]) expect(isShowableMonth(bad, TODAY)).toBe(false)
  })

  it('the note says why the link was put right, and which month is shown', () => {
    const shown = 'November 2026'
    expect(fixedPeriodNote({ asked: '2026-13', shown }, TODAY)).toBe('2026-13 in the link is not a month, so this shows November 2026.')
    expect(fixedPeriodNote({ asked: '2027-01', shown }, TODAY)).toBe('2027-01 in the link has not started yet, so this shows November 2026.')
    expect(fixedPeriodNote({ asked: '1999-12', shown }, TODAY)).toBe('1999-12 in the link is before the books start, so this shows November 2026.')
    expect(fixedPeriodNote({ asked: '2027-Q1', shown: 'Q4 2026 (Oct to Dec)' }, TODAY)).toBe('2027-Q1 in the link has not started yet, so this shows Q4 2026 (Oct to Dec).')
  })
})
