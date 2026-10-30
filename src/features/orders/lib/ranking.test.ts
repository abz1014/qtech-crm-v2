import { describe, expect, it } from 'vitest'
import { forItem, mapRankRows, priceTexts } from '@/features/orders/lib/ranking'
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

describe('the quotes of an item (no rank, no reason)', () => {
  it('are listed by supplier name, whatever the rank or the price', () => {
    const qs = mapRankRows(
      [row({ quote_line_id: 'a', supplier_id: 's', rank: 1 }), row({ quote_line_id: 'b', supplier_id: 't', rank: 2, price: 100 })],
      names,
    )
    expect(forItem(qs, qs[0].itemId).map(q => q.supplierName)).toEqual(['Lahore', 'Metro'])
  })
  it('prices', () => {
    const [a] = mapRankRows([row({})], names)
    expect(priceTexts(a)).toEqual({ price: 'USD 412.00', pkr: '≈ PKR 114,701' })
    expect(priceTexts({ ...a, currency: 'PKR' }).pkr).toBe('no conversion')
  })
})
