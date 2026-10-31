import { describe, expect, it } from 'vitest'
import type { ConvertItem } from '@/features/orders/lib/convert'
import type { RankedQuote } from '@/features/orders/lib/ranking'
import { buildSplitPayload, checkSplit, hasFreeQuote, orderLineCount, partQuantities, type Part } from '@/features/orders/lib/splitConvert'

const item = (id: string, qty: number, price: number | null = 100): ConvertItem => ({ id, description: id, qty, unit: null, quotedUnitPriceNet: price })
const q = (lineId: string, rank: number | null): RankedQuote => ({
  lineId,
  itemId: 'i',
  supplierId: lineId,
  supplierName: lineId,
  price: 1,
  currency: 'PKR',
  rank,
  comparable: rank !== null,
  inStock: false,
  row: {} as RankedQuote['row'],
})
const part = (key: string, lineId: string, qty: Part['qty']): Part => ({ key, lineId, qty })

describe('split quantities', () => {
  it('the first part takes the remainder as the second is typed', () => {
    expect(partQuantities(4, [part('a', 'A', null), part('b', 'B', 1)])).toEqual([3, 1])
  })
  it('a remainder never goes below zero', () => {
    expect(partQuantities(4, [part('a', 'A', null), part('b', 'B', 6)])).toEqual([0, 6])
  })
  it('parts that add up are fine; parts that do not are flagged but not blocked', () => {
    expect(checkSplit(4, [part('a', 'A', 3), part('b', 'B', 1)])).toMatchObject({ mismatch: false, incomplete: false, total: 4 })
    expect(checkSplit(4, [part('a', 'A', 3), part('b', 'B', 2)])).toMatchObject({ mismatch: true, incomplete: false, total: 5 })
  })
  it('a part with no quantity yet is incomplete', () => {
    expect(checkSplit(4, [part('a', 'A', null), part('b', 'B', undefined)]).incomplete).toBe(true)
  })
})

describe('free quotes for a new part', () => {
  it('says whether a quote is still unused; it picks none', () => {
    const quotes = [q('U', null), q('B', 2), q('A', 1)]
    expect(hasFreeQuote(quotes, new Set(['A']))).toBe(true)
    expect(hasFreeQuote(quotes, new Set(['A', 'B', 'U']))).toBe(false)
    expect(hasFreeQuote([q('A', 1)], new Set(['A']))).toBe(false)
  })
})

describe('payload', () => {
  const items = [item('i1', 2), item('i2', 4), item('i3', 1, null)]
  const splits = { i2: [part('a', 'L2', null), part('b', 'L9', 1)] }
  it('an unsplit item sends what it did before; a split sends one entry per part with its quantity', () => {
    const p = buildSplitPayload(items, { i1: 'L1', i2: 'L2', i3: 'service' }, { i3: 650 }, splits)
    expect(p).toEqual([
      { rfq_item_id: 'i1', quote_line_id: 'L1' },
      { rfq_item_id: 'i2', quote_line_id: 'L2', qty: 3 },
      { rfq_item_id: 'i2', quote_line_id: 'L9', qty: 1 },
      { rfq_item_id: 'i3', unit_price_net: 650, is_service: true },
    ])
  })
  it('sends the confirmed price for every line, also one the RFQ item already had, and for every part of a split', () => {
    const p = buildSplitPayload([item('i1', 2, 1000), item('i2', 4, 1000)], { i1: 'L1', i2: 'L2' }, { i1: 1250, i2: 900 }, splits)
    expect(p).toEqual([
      { rfq_item_id: 'i1', quote_line_id: 'L1', unit_price_net: 1250 },
      { rfq_item_id: 'i2', quote_line_id: 'L2', qty: 3, unit_price_net: 900 },
      { rfq_item_id: 'i2', quote_line_id: 'L9', qty: 1, unit_price_net: 900 },
    ])
  })
  it('sends no price when none was confirmed (zero or empty), leaving the database to refuse it', () => {
    const p = buildSplitPayload([item('i1', 2)], { i1: 'L1' }, { i1: 0 }, {})
    expect(p).toEqual([{ rfq_item_id: 'i1', quote_line_id: 'L1' }])
  })
  it('counts the order lines', () => {
    expect(orderLineCount(items, {})).toBe(3)
    expect(orderLineCount(items, splits)).toBe(4)
  })
})
