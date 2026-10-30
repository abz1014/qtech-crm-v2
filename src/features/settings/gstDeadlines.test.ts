import { describe, expect, it } from 'vitest'
import { DEFAULT_GST_DEADLINES, dayWords, deadlinesFromRows, gstDatesFor, parseGstDay } from '@/features/settings/gstDeadlines'

describe('GST deadlines', () => {
  it('starts at the 15th and the 18th of the following month', () => {
    expect(gstDatesFor(DEFAULT_GST_DEADLINES, '2026-10')).toMatchObject({ payBy: '2026-11-15', returnBy: '2026-11-18', payOverridden: false })
    expect(gstDatesFor(DEFAULT_GST_DEADLINES, '2026-12-01').payBy).toBe('2027-01-15')
  })
  it('moves with the days the admin sets', () => {
    const d = { ...DEFAULT_GST_DEADLINES, payDay: 20, returnDay: 25 }
    expect(gstDatesFor(d, '2026-10')).toMatchObject({ payBy: '2026-11-20', returnBy: '2026-11-25' })
  })
  it('takes a one-off date for one month only, and keeps the usual day for an empty one', () => {
    const d = deadlinesFromRows({ pay_day: 15, return_day: 18 }, [{ month: '2026-10-01', pay_by: '2026-11-22', return_by: null }])
    expect(gstDatesFor(d, '2026-10')).toEqual({ payBy: '2026-11-22', returnBy: '2026-11-18', payOverridden: true, returnOverridden: false })
    expect(gstDatesFor(d, '2026-09').payBy).toBe('2026-10-15')
  })
  it('falls back to the defaults when the settings cannot be read', () => {
    expect(deadlinesFromRows(null, [])).toEqual(DEFAULT_GST_DEADLINES)
  })
  it('accepts whole days 1 to 28 only', () => {
    expect(parseGstDay(' 20 ')).toBe(20)
    for (const bad of ['', '0', '29', '1.5', 'x', '-3']) expect(parseGstDay(bad)).toBeNull()
  })
  it('says the day in words', () => {
    expect([1, 2, 3, 4, 11, 12, 15, 21, 22, 23].map(dayWords)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '15th', '21st', '22nd', '23rd'])
  })
})
