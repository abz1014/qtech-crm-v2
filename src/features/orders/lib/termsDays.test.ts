import { describe, expect, it } from 'vitest'
import { daysFromTermsText } from '@/features/orders/lib/termsDays'

describe('daysFromTermsText', () => {
  it('reads a number of days', () => {
    expect(daysFromTermsText('30 days from invoice')).toBe(30)
    expect(daysFromTermsText('Net 45')).toBe(45)
    expect(daysFromTermsText('Payment within 60-days of delivery')).toBe(60)
  })
  it('reads advance as 0', () => {
    expect(daysFromTermsText('100% advance')).toBe(0)
    expect(daysFromTermsText('Against delivery')).toBe(0)
  })
  it('gives up when unsure', () => {
    expect(daysFromTermsText(null)).toBeNull()
    expect(daysFromTermsText('As agreed')).toBeNull()
    expect(daysFromTermsText('50% advance, balance 30 days, rest 60 days')).toBeNull()
  })
})
