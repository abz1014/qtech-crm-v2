import { describe, expect, it } from 'vitest'
import { billPeriod, forMonthOf, RENT_CATEGORY_ID } from '@/features/money/expenses/forMonth'

const SALARIES = 'ca7e0000-0000-4000-8000-000000000001'

describe('for-month (0087) and the rent exception (0106)', () => {
  it('a monthly bill paid on day 1 to 10 is for last month, later in the month for this month', () => {
    expect(forMonthOf('2026-10-05', SALARIES)).toBe('2026-09')
    expect(forMonthOf('2026-10-10', SALARIES)).toBe('2026-09')
    expect(forMonthOf('2026-10-11', SALARIES)).toBe('2026-10')
    expect(forMonthOf('2026-01-02')).toBe('2025-12')
  })

  it('rent is always for the month it is paid in, whatever the day', () => {
    for (const day of ['01', '05', '10', '11', '20', '31']) expect(forMonthOf(`2026-10-${day}`, RENT_CATEGORY_ID)).toBe('2026-10')
    expect(forMonthOf('2026-01-01', RENT_CATEGORY_ID)).toBe('2026-01')
  })

  it('a rent template is due for this month even on day 1 to 10; other templates keep the rule', () => {
    expect(billPeriod({ dayOfMonth: 1, categoryId: RENT_CATEGORY_ID }, '2026-10-03')).toBe('2026-10')
    expect(billPeriod({ dayOfMonth: 5, categoryId: SALARIES }, '2026-10-03')).toBe('2026-09')
    expect(billPeriod({ dayOfMonth: 5 }, '2026-10-03')).toBe('2026-09')
    expect(billPeriod({ dayOfMonth: 25, categoryId: SALARIES }, '2026-10-03')).toBe('2026-10')
  })
})
