import { describe, expect, it } from 'vitest'
import {
  convertToPaisa,
  formatAmount,
  formatPaisa,
  formatRate,
  fxStaleness,
  hasPaisa,
  paisaToFixed,
  sumPaisa,
  toPaisa,
} from '@/lib/money'
import { formatDay } from '@/lib/formatDay'

describe('toPaisa and formatting', () => {
  it('reads numbers and decimal strings exactly', () => {
    expect(toPaisa('1250000')).toBe(125000000n)
    expect(toPaisa(410514.4)).toBe(41051440n)
    expect(toPaisa('0.07')).toBe(7n)
    expect(toPaisa(0.1 + 0.2)).toBe(30n) // float noise does not leak in
    expect(toPaisa('-84500.5')).toBe(-8450050n)
  })

  it('rejects things that are not amounts', () => {
    expect(() => toPaisa('12abc')).toThrow()
    expect(() => toPaisa(Number.NaN)).toThrow()
  })

  it('groups thousands, keeps the paisa, uses a true minus', () => {
    expect(formatAmount('1250000')).toBe('1,250,000')
    expect(formatAmount('2280635.6')).toBe('2,280,635.60')
    expect(formatAmount('999.99')).toBe('999.99')
    expect(formatAmount('-84500')).toBe('−84,500')
    expect(formatAmount('0')).toBe('0')
    expect(formatAmount('1250000', 'always')).toBe('1,250,000.00')
  })

  it('"never" rounds half away from zero and is only for headline tiles', () => {
    expect(formatPaisa(12_350n, 'never')).toBe('124')
    expect(formatPaisa(-12_350n, 'never')).toBe('−124')
  })

  it('detects a column that needs paisa', () => {
    expect(hasPaisa(['100', 200, null])).toBe(false)
    expect(hasPaisa(['100', '200.01'])).toBe(true)
  })
})

describe('sums are exact', () => {
  it('a total equals the sum of its rows to the paisa, where floats would not', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => (i % 7 === 0 ? '0.10' : '0.20'))
    const exact = sumPaisa(rows)
    const float = rows.reduce((n, r) => n + Number(r), 0)
    expect(paisaToFixed(exact)).toBe('185.70')
    expect(float).not.toBe(185.7) // the reason this module exists
  })

  it('net plus GST equals gross for the mockup order', () => {
    expect(paisaToFixed(sumPaisa(['1250000', '225000']))).toBe('1475000.00')
  })
})

describe('foreign conversion', () => {
  it('multiplies in paisa and rounds once', () => {
    expect(paisaToFixed(convertToPaisa('4820', '278.40'))).toBe('1341888.00')
    expect(paisaToFixed(convertToPaisa('18600', '38.42'))).toBe('714612.00')
    expect(paisaToFixed(convertToPaisa('17900', '39.10'))).toBe('699890.00')
    expect(paisaToFixed(convertToPaisa('12400.50', '75.8123'))).toBe('940110.43') // true product 940110.42615
  })

  it('formats a rate to at least two decimals', () => {
    expect(formatRate(278.4)).toBe('278.40')
    expect(formatRate('38.4200')).toBe('38.42')
    expect(formatRate('0.0034')).toBe('0.0034')
  })

  it('bands rate age as the view does: 7, 30', () => {
    expect([0, 7, 8, 30, 31].map(fxStaleness)).toEqual(['fresh', 'fresh', 'stale', 'stale', 'unusable'])
  })
})

describe('formatDay', () => {
  it('writes the weekday and day', () => {
    expect(formatDay('2026-11-26')).toBe('Thu 26 Nov')
    expect(formatDay('2026-12-01')).toBe('Tue 1 Dec')
    expect(formatDay('2026-09-28')).toBe('Mon 28 Sep') // not "Sept"
  })
})
