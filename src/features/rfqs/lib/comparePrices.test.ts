import { describe, expect, it } from 'vitest'
import { cheapestFirst, comparePrices, type RateTable } from './comparePrices'

const usd = { rate: 280, ageDays: 0 }
const rates: RateTable = {
  USD: usd,
  CNY: { rate: 38.6, ageDays: 3 },
  EUR: { rate: 305.2, ageDays: 12 },
  AED: { rate: 76, ageDays: 45 },
}
const by = (c: ReturnType<typeof comparePrices>, id: string) => c.lines.find(l => l.id === id)!

describe('comparePrices', () => {
  it('compares lines in one currency with no rates at all', () => {
    const c = comparePrices(
      [
        { id: 'a', amount: 438, currency: 'USD' },
        { id: 'b', amount: 412.5, currency: 'USD' },
      ],
      {},
    )
    expect(c.basis).toBe('native')
    expect(c.lowestIds).toEqual(['b'])
    expect(by(c, 'a').pkrPaisa).toBeNull()
    expect(by(c, 'a').notCompared).toBe('no-rate')
    expect(by(c, 'a').compared).toBe(true)
  })

  it('compares PKR lines directly (PKR is its own rate)', () => {
    const c = comparePrices(
      [
        { id: 'a', amount: 131000, currency: 'PKR' },
        { id: 'b', amount: 124500, currency: 'PKR' },
      ],
      {},
    )
    expect(c.lowestIds).toEqual(['b'])
    expect(by(c, 'a').pkrPaisa).toBe(13_100_000n)
  })

  it('converts mixed currencies at today\'s rate and marks the lowest in PKR', () => {
    const c = comparePrices(
      [
        { id: 'cny', amount: 2980, currency: 'CNY' }, // 115,028
        { id: 'usd', amount: 438, currency: 'USD' }, // 122,640
        { id: 'pkr', amount: 131000, currency: 'PKR' },
      ],
      rates,
    )
    expect(c.basis).toBe('pkr')
    expect(c.lowestIds).toEqual(['cny'])
    expect(by(c, 'cny').pkrPaisa).toBe(11_502_800n)
    expect(by(c, 'cny').band).toBe('fresh')
    expect(c.comparableCount).toBe(3)
  })

  it('still compares on a stale rate and says so', () => {
    const c = comparePrices(
      [
        { id: 'eur', amount: 1265, currency: 'EUR' },
        { id: 'usd', amount: 1390, currency: 'USD' },
      ],
      rates,
    )
    expect(by(c, 'eur').band).toBe('stale')
    expect(by(c, 'eur').rateAgeDays).toBe(12)
    expect(c.lowestIds).toEqual(['eur'])
  })

  it('leaves out a line whose rate is unusable (over 30 days) or missing, and never blocks', () => {
    const c = comparePrices(
      [
        { id: 'aed', amount: 5200, currency: 'AED' },
        { id: 'gbp', amount: 100, currency: 'GBP' },
        { id: 'usd', amount: 438, currency: 'USD' },
        { id: 'pkr', amount: 200000, currency: 'PKR' },
      ],
      rates,
    )
    expect(by(c, 'aed')).toMatchObject({ compared: false, notCompared: 'unusable', pkrPaisa: null, lowest: false })
    expect(by(c, 'gbp')).toMatchObject({ compared: false, notCompared: 'no-rate', pkrPaisa: null })
    expect(c.comparableCount).toBe(2)
    expect(c.lowestIds).toEqual(['usd'])
  })

  it('marks no lowest with fewer than two comparable lines', () => {
    const one = comparePrices([{ id: 'a', amount: 10, currency: 'USD' }], rates)
    expect(one.lowestIds).toEqual([])
    const lonely = comparePrices(
      [
        { id: 'a', amount: 10, currency: 'USD' },
        { id: 'b', amount: 10, currency: 'AED' },
      ],
      rates,
    )
    expect(lonely.comparableCount).toBe(1)
    expect(lonely.lowestIds).toEqual([])
  })

  it('marks every line that ties for lowest', () => {
    const c = comparePrices(
      [
        { id: 'a', amount: 100, currency: 'USD' },
        { id: 'b', amount: 100, currency: 'USD' },
        { id: 'c', amount: 120, currency: 'USD' },
      ],
      rates,
    )
    expect(c.lowestIds).toEqual(['a', 'b'])
  })

  it('uses the band given by the view over the age', () => {
    const c = comparePrices(
      [
        { id: 'a', amount: 1, currency: 'USD' },
        { id: 'b', amount: 1, currency: 'PKR' },
      ],
      { USD: { rate: 280, ageDays: 3, staleness: 'unusable' } },
    )
    expect(by(c, 'a').notCompared).toBe('unusable')
  })

  it('handles no lines', () => {
    expect(comparePrices([], rates)).toMatchObject({ comparableCount: 0, lowestIds: [] })
  })
})

describe('cheapestFirst', () => {
  it('orders compared lines by PKR, cheapest first, then the lines with no rate; ties go to the tie-break', () => {
    const lines = [
      { id: 'dear', amount: 120, currency: 'USD' },
      { id: 'norate', amount: 1, currency: 'GBP' },
      { id: 'cheap', amount: 100, currency: 'USD' },
      { id: 'pkr', amount: 28_500, currency: 'PKR' },
    ]
    const c = comparePrices(lines, rates)
    const rows = lines.map(l => ({ id: l.id, amount: l.amount, c: by(c, l.id) }))
    rows.sort((a, b) => cheapestFirst(a, b, () => a.id.localeCompare(b.id)))
    expect(rows.map(r => r.id)).toEqual(['cheap', 'pkr', 'dear', 'norate'])
  })
})
