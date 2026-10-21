import { describe, expect, it } from 'vitest'
import { isOpenableMonth } from '@/features/money/bank/model'
import { isUsableAsOf } from '@/features/money/monthEnd/reportHooks'

const today = '2026-10-22'

describe('a month from a Month-end or bank link (HE-21)', () => {
  it('opens this month and past months', () => {
    expect(isOpenableMonth('2026-10', today)).toBe(true)
    expect(isOpenableMonth('2026-09', today)).toBe(true)
    expect(isOpenableMonth('2000-01', today)).toBe(true)
  })
  it('refuses a future month, one before 2000 and nonsense', () => {
    expect(isOpenableMonth('2026-11', today)).toBe(false)
    expect(isOpenableMonth('2030-01', today)).toBe(false)
    expect(isOpenableMonth('1999-12', today)).toBe(false)
    expect(isOpenableMonth('2026-13', today)).toBe(false)
    expect(isOpenableMonth(null, today)).toBe(false)
  })
})

describe('an as-of day from a report link (HE-22)', () => {
  it('takes a real past day', () => {
    expect(isUsableAsOf('2026-02-28', today)).toBe(true)
    expect(isUsableAsOf('2024-02-29', today)).toBe(true)
    expect(isUsableAsOf(today, today)).toBe(true)
  })
  it('refuses an impossible, future or ancient day', () => {
    expect(isUsableAsOf('2026-02-30', today)).toBe(false)
    expect(isUsableAsOf('2027-02-29', today)).toBe(false)
    expect(isUsableAsOf('2026-10-23', today)).toBe(false)
    expect(isUsableAsOf('1900-01-01', today)).toBe(false)
    expect(isUsableAsOf('2026-1-1', today)).toBe(false)
    expect(isUsableAsOf(null, today)).toBe(false)
  })
})
