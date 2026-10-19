import { describe, expect, it } from 'vitest'
import { longReason, mapRankRows, priceTexts, recordText, shortReason, type RankRow } from '@/features/orders/lib/ranking'

const row = (o: Partial<RankRow>): RankRow => ({
  quote_line_id: 'l',
  rfq_item_id: 'i',
  supplier_id: 's',
  price: 412,
  currency: 'USD',
  rank: 1,
  comparable: true,
  within_band: true,
  pct_above_best: 0,
  pkr_unit_price: 114701,
  fx_state: 'fresh',
  fx_age_days: 1,
  reliability_band: 1,
  deliveries: 6,
  on_time: 5,
  late: 1,
  median_days_late: null,
  orders_count: 4,
  in_stock: false,
  sell_unit_net: null,
  spread_unit: null,
  ...o,
})
const names = new Map([
  ['s', 'Metro'],
  ['t', 'Lahore'],
])

describe('reasons', () => {
  it('writes the record in words', () => {
    expect(recordText({ deliveries: 0, onTime: 0, reliabilityBand: 2 })).toBe('No deliveries yet')
    expect(recordText({ deliveries: 6, onTime: 5, reliabilityBand: 1 })).toBe('on time 5 of 6')
    expect(recordText({ deliveries: 6, onTime: 2, reliabilityBand: 3 })).toBe('Often late: on time 2 of 6')
    expect(recordText({ deliveries: 1, onTime: 1, reliabilityBand: 2 })).toBe('Too few to judge: 1 delivery, on time')
  })
  it('rank 1 alone is "Best price"; rank 1 with a tied neighbour is "Within 2%"', () => {
    const [a] = mapRankRows([row({ within_band: false })], names)
    expect(shortReason(a, [a])).toBe('Best price · on time 5 of 6')
    const [b, c] = mapRankRows([row({ quote_line_id: 'a' }), row({ quote_line_id: 'b', rank: 2, supplier_id: 't', pct_above_best: 1.5 })], names)
    expect(shortReason(b, [b, c])).toBe('Within 2% · on time 5 of 6')
  })
  it('the long line cites the gap and shows the spread only when it is there', () => {
    const rows = mapRankRows(
      [row({ quote_line_id: 'a' }), row({ quote_line_id: 'b', rank: 2, supplier_id: 't', pkr_unit_price: 116401, pct_above_best: 1.5, spread_unit: 15500 })],
      names,
    )
    expect(longReason(rows[1], rows)).toContain('≈ PKR 1,700 each above the best (1.5%)')
    expect(longReason(rows[1], rows)).toContain('Spread ≈ PKR 15,500 each')
    expect(longReason({ ...rows[1], spreadUnit: null }, rows)).not.toContain('Spread')
  })
  it('with no rate to convert at, the gap is still cited as a percentage', () => {
    const rows = mapRankRows([row({ quote_line_id: 'a' }), row({ quote_line_id: 'b', rank: 2, supplier_id: 't', pkr_unit_price: null, pct_above_best: 12.5, within_band: false })], names)
    expect(longReason(rows[1], rows)).toContain('12.5% above the best')
  })
  it('an engineer row (no sell, no spread) never produces money words about our margin', () => {
    const rows = mapRankRows([row({ sell_unit_net: null, spread_unit: null })], names)
    expect(longReason(rows[0], rows)).not.toMatch(/Spread|sell/i)
  })
  it('prices', () => {
    const [a] = mapRankRows([row({})], names)
    expect(priceTexts(a)).toEqual({ price: 'USD 412.00', pkr: '≈ PKR 114,701' })
    expect(priceTexts({ ...a, currency: 'PKR' }).pkr).toBe('no conversion')
  })
})
