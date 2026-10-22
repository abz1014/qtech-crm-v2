import { describe, expect, it } from 'vitest'
import { amountProblem, formatAmount, parseAmount } from '@/lib/number'

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
  it('HW-1: reads Pakistani and European separators one way only, or refuses', () => {
    expect(parseAmount('1.234,50')).toBe(1234.5)
    expect(parseAmount('12,5')).toBe(12.5)
    expect(parseAmount('12,50')).toBe(12.5)
    expect(parseAmount('0,75')).toBe(0.75)
    expect(parseAmount('1.234.567')).toBe(1234567)
    expect(parseAmount('1.234.567,8')).toBe(1234567.8)
    expect(parseAmount('1,234.50')).toBe(1234.5)
    expect(parseAmount('1,234')).toBe(1234)
    expect(parseAmount('1.234')).toBe(1.234)
    expect(parseAmount('1,00,000')).toBe(100000)
    expect(parseAmount('12,50,000.25')).toBe(1250000.25)
    expect(parseAmount("1'234.50")).toBe(1234.5)
    expect(parseAmount('-1,234.5')).toBe(-1234.5)
    expect(parseAmount('5.')).toBe(5)
    for (const junk of ['12,3456', '1,2,3', '1.234.5', '1,234,5', '1.2.3', ',5', '1,,234', 'PKR 1,200/-', '-', '.', '1.234,5.6']) {
      expect(parseAmount(junk), junk).toBeNull()
      expect(amountProblem(junk), junk).toMatch(/Type it like 1,234.50/)
    }
  })
  it('HW-2: refuses more digits than can be held exactly, and says so', () => {
    expect(parseAmount('999,999,999,999,999')).toBe(999999999999999)
    expect(parseAmount('9999999999999999999999')).toBeNull()
    expect(amountProblem('9999999999999999999999')).toBe('That number is too large.')
    expect(amountProblem('')).toBeNull()
    expect(amountProblem('1,234.50')).toBeNull()
  })
})
