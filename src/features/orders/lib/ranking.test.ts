import { describe, expect, it } from 'vitest'
import { longReason, mapRankRows, priceTexts, shortReason } from '@/features/orders/lib/ranking'
import type { RankRow } from '@/features/rfqs/lib/ranking/reasons'

const row = (o: Partial<RankRow>): RankRow => ({
  rfq_item_id: 'i',
  quote_line_id: 'l',
  supplier_id: 's',
  item_qty: 4,
  price: 412,
  currency: 'USD',
  pkr_unit_price: 114701,
  fx_state: 'fresh',
  fx_rate_pkr: 278.4,
  fx_rate_on: null,
  fx_age_days: 1,
  comparable: true,
  rank: 1,
  within_band: false,
  pct_above_best: 0,
  sell_unit_net: null,
  sell_source: null,
  sell_order_number: null,
  sell_on: null,
  spread_unit: null,
  spread_total: null,
  reliability_band: 1,
  deliveries: 6,
  on_time: 5,
  late: 1,
  median_days_late: null,
  orders_count: 4,
  orders_value_pkr: null,
  last_order_number: null,
  last_order_on: null,
  last_order_delivered_after_days: null,
  replied: null,
  asked: null,
  lead_time: null,
  in_stock: false,
  ...o,
})
const names = new Map([
  ['s', 'Metro'],
  ['t', 'Lahore'],
])

describe('reasons come from the one module', () => {
  it('rank 1 reads best price and the delivery record in the RFQ page wording', () => {
    const qs = mapRankRows([row({})], names)
    expect(shortReason(qs[0], qs)).toBe('Best price · On time 5 of 6 deliveries')
  })
  it('a quote within the 2% band is named in the picker line', () => {
    const qs = mapRankRows([row({ quote_line_id: 'a', within_band: true }), row({ quote_line_id: 'b', rank: 2, supplier_id: 't', within_band: true, pct_above_best: 1.5, pkr_unit_price: 116401 })], names)
    expect(longReason(qs[1], qs)).toContain('Within 2% of the best: by delivery record')
    expect(longReason(qs[1], qs)).toContain('above the best')
  })
  it('an engineer row never produces a selling price or a spread', () => {
    const qs = mapRankRows([row({ sell_unit_net: null, spread_unit: null, sell_source: null })], names)
    expect(longReason(qs[0], qs)).not.toMatch(/Spread|selling/i)
  })
  it('admin and sales rows add the spread', () => {
    const qs = mapRankRows([row({ sell_unit_net: 134000, sell_source: 'quoted', spread_unit: 15500, spread_total: 62000 })], names)
    expect(longReason(qs[0], qs)).toContain('Spread')
  })
  it('prices', () => {
    const [a] = mapRankRows([row({})], names)
    expect(priceTexts(a)).toEqual({ price: 'USD 412.00', pkr: '≈ PKR 114,701' })
    expect(priceTexts({ ...a, currency: 'PKR' }).pkr).toBe('no conversion')
  })
})
