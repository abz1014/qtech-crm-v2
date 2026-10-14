import { describe, expect, it } from 'vitest'
import { formatAmount, parseAmount } from '@/lib/number'

describe('amount text (U07)', () => {
  it('groups PKR in thousands, not lakhs', () => {
    expect(formatAmount(1600764)).toBe('1,600,764')
    expect(formatAmount(700000)).toBe('700,000')
  })
  it('fixes decimals when asked, shows them only when present otherwise', () => {
    expect(formatAmount(278.4, 2)).toBe('278.40')
    expect(formatAmount(12.5)).toBe('12.5')
    expect(formatAmount(12)).toBe('12')
  })
  it('empty for no value', () => {
    expect(formatAmount(null)).toBe('')
    expect(formatAmount(undefined)).toBe('')
  })
  it('parses what people type', () => {
    expect(parseAmount('1,600,764')).toBe(1600764)
    expect(parseAmount(' 1 600 764 ')).toBe(1600764)
    expect(parseAmount('4820.5')).toBe(4820.5)
    expect(parseAmount('.5')).toBe(0.5)
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('12,3a')).toBeNull()
  })
})
