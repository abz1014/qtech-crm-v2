import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  amountPaisa,
  amountSchema,
  businessDateRange,
  dateRangeProblem,
  inDateRange,
  normalisePhone,
  phoneProblem,
  phoneText,
  pkr,
  rateDateRange,
  storedRate,
} from '@/lib/formRules'

describe('pkr (toasts show the stored amount, hunt HE-4/HE-5)', () => {
  it('rounds to the paisa as numeric(14,2) does, half away from zero on the typed decimal', () => {
    expect(amountPaisa(100.555)).toBe(10056n)
    expect(amountPaisa(1.005)).toBe(101n)
    expect(amountPaisa(-2.345)).toBe(-235n)
    expect(pkr(100.555)).toBe('PKR 100.56')
  })
  it('keeps the paisa zero, and shows whole rupees without decimals', () => {
    expect(pkr(12345.5)).toBe('PKR 12,345.50')
    expect(pkr(0.5)).toBe('PKR 0.50')
    expect(pkr(5900)).toBe('PKR 5,900')
  })
})

describe('storedRate (hunt HE-10)', () => {
  it('shows a rate at the six decimals numeric(14,6) keeps', () => {
    expect(storedRate(281.123456789)).toBe('281.123457')
    expect(storedRate(278.4)).toBe('278.40')
  })
})

describe('amountSchema (hunt HE-6/7/8)', () => {
  const s = amountSchema('Enter the amount')
  const first = (v: unknown) => {
    const r = s.safeParse(v)
    return r.success ? null : r.error.issues[0].message
  }
  it('says what is wrong with each kind of bad amount', () => {
    expect(first(undefined)).toBe('Enter the amount')
    expect(first(-500)).toBe('The amount must be above zero')
    expect(first(0)).toBe('The amount must be above zero')
    expect(first(0.001)).toBe('The smallest amount is 0.01 (one paisa)')
    expect(first(99999999999999)).toMatch(/too large/)
  })
  it('accepts a paisa and the largest numeric(14,2) amount', () => {
    expect(first(0.01)).toBeNull()
    expect(first(999_999_999_999.99)).toBeNull()
  })
})

describe('date ranges (hunt HE-3/HE-9)', () => {
  it('payments and expenses: 1 Jan 2000 to a year from today', () => {
    expect(businessDateRange('2026-10-22')).toEqual({ earliest: '2000-01-01', latest: '2027-10-22' })
    expect(businessDateRange('2028-02-29').latest).toBe('2029-02-28')
  })
  it('rates: up to a week ahead', () => {
    expect(rateDateRange('2026-10-22').latest).toBe('2026-10-29')
  })
  it('names the range when a date is outside it, and leaves good or empty dates alone', () => {
    const r = businessDateRange('2026-10-22')
    expect(dateRangeProblem('2200-01-01', r)).toBe('Use a date between Sat 1 Jan 2000 and Fri 22 Oct 2027. Check the year')
    expect(dateRangeProblem('1900-01-01', r)).toMatch(/^Use a date between/)
    expect(dateRangeProblem('2026-10-22', r)).toBeNull()
    expect(dateRangeProblem('', r)).toBeNull()
  })
  it('works as a zod refinement', () => {
    const s = z.string().superRefine(inDateRange(() => businessDateRange('2026-10-22')))
    expect(s.safeParse('2027-01-01').success).toBe(true)
    expect(s.safeParse('2200-01-01').success).toBe(false)
  })
})

describe('phone (hunt HE-17)', () => {
  it('turns Urdu and Arabic-Indic digits into 0-9', () => {
    expect(normalisePhone(' ۰۳۰۰۱۲۳۴۵۶۷ ')).toBe('03001234567')
    expect(normalisePhone('٠٣٠٠١٢٣٤٥٦٧')).toBe('03001234567')
  })
  it('refuses letters and emoji, too few or too many digits', () => {
    expect(phoneProblem('call me 📞')).toMatch(/digits only/)
    expect(phoneProblem('12345')).toMatch(/too short/)
    expect(phoneProblem('1'.repeat(25))).toMatch(/too long/)
  })
  it('accepts ordinary numbers and an empty field', () => {
    for (const ok of ['', '0300 1234567', '+92 300 1234567', '(042) 111-222-333', '۰۳۰۰۱۲۳۴۵۶۷']) expect(phoneProblem(ok)).toBeNull()
    expect(phoneText.parse('۰۳۰۰۱۲۳۴۵۶۷')).toBe('03001234567')
    expect(phoneText.safeParse('call me 📞').success).toBe(false)
  })
})
