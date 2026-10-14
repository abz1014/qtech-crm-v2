import { describe, expect, it } from 'vitest'
import { formatDateText, parseDateText } from '@/lib/dateInput'

const TODAY = '2026-11-27'

describe('date text (U07)', () => {
  it('formats as "Fri 27 Nov 2026" without touching the timezone', () => {
    expect(formatDateText('2026-11-27')).toBe('Fri 27 Nov 2026')
    expect(formatDateText('2026-01-01')).toBe('Thu 1 Jan 2026')
    expect(formatDateText('')).toBe('')
    expect(formatDateText('2026-02-30')).toBe('')
  })

  it('reads day-first, never month-first', () => {
    expect(parseDateText('27/11/2026', TODAY)).toBe('2026-11-27')
    expect(parseDateText('3/4/2026', TODAY)).toBe('2026-04-03')
    expect(parseDateText('27/11', TODAY)).toBe('2026-11-27')
    expect(parseDateText('27-11-26', TODAY)).toBe('2026-11-27')
    expect(parseDateText('27.11.2026', TODAY)).toBe('2026-11-27')
  })

  it('reads day and month names, with or without a year', () => {
    expect(parseDateText('27 nov', TODAY)).toBe('2026-11-27')
    expect(parseDateText('27 November 2026', TODAY)).toBe('2026-11-27')
    expect(parseDateText('1 dec 2025', TODAY)).toBe('2025-12-01')
    expect(parseDateText('Fri 27 Nov 2026', TODAY)).toBe('2026-11-27')
  })

  it('reads today, yesterday and tomorrow from the business date', () => {
    expect(parseDateText('today', TODAY)).toBe('2026-11-27')
    expect(parseDateText('Yesterday', TODAY)).toBe('2026-11-26')
    expect(parseDateText('tomorrow', '2026-11-30')).toBe('2026-12-01')
    expect(parseDateText('yesterday', '2026-01-01')).toBe('2025-12-31')
  })

  it('reads ISO', () => {
    expect(parseDateText('2026-11-27', TODAY)).toBe('2026-11-27')
  })

  it('refuses what is not a date', () => {
    for (const bad of ['', 'abc', '31/02/2026', '32 nov', '27 xyz', '13/13', '0/5']) {
      expect(parseDateText(bad, TODAY)).toBeNull()
    }
  })
})
