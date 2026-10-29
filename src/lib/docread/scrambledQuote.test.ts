import { describe, expect, it } from 'vitest'
import { suggestFromReply } from '@/features/rfqs/lib/replySuggest'
import { parseSupplierQuote } from './supplierQuoteParse'

// A supplier quotation copied out of a mail export with row cells out of place (synthetic, invented content). The reader must never
// put another row's or column's figure on an item as its price without a word: such an offer keeps its item and lead time, its price
// is left blank and flagged price_uncertain (with the figure in suspectPrice) for the person to check.
const ITEMS = [
  { id: 'a', description: 'Ball valve DN50 PN16', qty: 6 },
  { id: 'b', description: 'Pressure gauge 0-10 bar', qty: 12 },
  { id: 'c', description: 'Level switch float type', qty: 4 },
]
const HEAD = 'Item\tDescription\tQty\tUnit Price (USD)\tLead time'
const read = (rows: string[], head = HEAD) => parseSupplierQuote([head, ...rows].join('\n'), ITEMS, { today: '2026-10-20' })
const offer = (r: ReturnType<typeof read>, id: string) => r.offers.find(o => o.rfqItemId === id)

describe('a quotation table in its right cells is read as before', () => {
  it('prices every row', () => {
    const r = read(['1\tBall valve DN50 PN16\t6\t45.00\t2 weeks', '2\tPressure gauge 0-10 bar\t12\t18.50\t2 weeks', '3\tLevel switch float type\t4\t60.00\t3 weeks'])
    expect(r.offers.map(o => [o.rfqItemId, o.unitPrice])).toEqual([['a', 45], ['b', 18.5], ['c', 60]])
    expect(r.offers.every(o => !o.flags.includes('price_uncertain'))).toBe(true)
  })

  it('a price on the continuation line, in its own column, is the row above its price', () => {
    const r = read(['1\tBall valve DN50 PN16\t6\t\t2 weeks\n\t\t\t45.00', '2\tPressure gauge 0-10 bar\t12\t18.50\t2 weeks'])
    expect(offer(r, 'a')?.unitPrice).toBe(45)
  })

  it('a row with fewer cells than the heading (merged empty cell) keeps its price by the right-hand columns', () => {
    const r = parseSupplierQuote(
      ['No.\tDescription\tModel\tQty\tUnit Price (EUR)\tTotal', '1\tBall valve DN50 PN16\t6\t45.00\t270.00', '2\tPressure gauge 0-10 bar\t12\t18.50\t222.00'].join('\n'),
      ITEMS,
      { today: '2026-10-20' },
    )
    expect(r.offers.map(o => [o.rfqItemId, o.unitPrice])).toEqual([['a', 45], ['b', 18.5]])
  })
})

describe('a scrambled row is not given a wrong price', () => {
  it('a lead time under the price heading: the number of "2 weeks" is no price', () => {
    const r = read(['1\tBall valve DN50 PN16\t6\t2 weeks\t45.00', '2\tPressure gauge 0-10 bar\t12\t2 weeks\t18.50'])
    for (const id of ['a', 'b']) {
      const o = offer(r, id)
      expect(o?.unitPrice).toBeNull()
      expect(o?.flags).toContain('price_uncertain')
      expect(o?.confidence).toBe('low')
    }
    expect(offer(r, 'a')?.suspectPrice).toBeDefined()
  })

  it('the price printed before the row (it is on the previous row line): not taken for this row', () => {
    const r = read(['1\tBall valve DN50 PN16\t6\t2 weeks', '45.00\t2\tPressure gauge 0-10 bar\t12\t2 weeks', '18.50\t3\tLevel switch float type\t4\t3 weeks'])
    for (const id of ['b', 'c']) {
      expect(offer(r, id)?.unitPrice).toBeNull()
      expect(offer(r, id)?.flags).toContain('price_uncertain')
    }
  })

  it('a price that starts the next line, away from the price column', () => {
    const r = read(['1\tBall valve DN50 PN16\t6\n45.00\t2 weeks', '2\tPressure gauge 0-10 bar\t12\t18.50\t2 weeks'])
    expect(offer(r, 'a')?.unitPrice).toBeNull()
    expect(offer(r, 'a')?.flags).toContain('price_uncertain')
    expect(offer(r, 'b')?.unitPrice).toBe(18.5)
  })

  it('a price and total that do not fit the row quantity (the price of the row above): flagged, left blank', () => {
    const head = 'Item\tDescription\tQty\tUnit Price (USD)\tTotal (USD)'
    const r = read(['1\tBall valve DN50 PN16\t6\t\t', '2\tPressure gauge 0-10 bar\t12\t45.00\t270.00', '3\tLevel switch float type\t4\t60.00\t240.00'], head)
    expect(offer(r, 'b')?.unitPrice).toBeNull()
    expect(offer(r, 'b')?.flags).toContain('price_uncertain')
    expect(offer(r, 'b')?.suspectPrice).toBe(45)
    // the row whose price and total agree with its quantity is untouched
    expect(offer(r, 'c')?.unitPrice).toBe(60)
  })

  it('the suggestion is blocked, says why and shows the figure, so nothing is ticked and saved', () => {
    const r = read(['1\tBall valve DN50 PN16\t6\t2 weeks\t45.00'])
    const set = suggestFromReply(r, ITEMS.map((i, n) => ({ ...i, number: n + 1 })), 'USD')
    const s = set.suggestions.find(x => x.itemId === 'a')
    expect(s?.selectable).toBe(false)
    expect(s?.unitPrice).toBeNull()
    expect(s?.blocked).toMatch(/may belong to another row or column/)
  })
})
