import { describe, expect, it } from 'vitest'
import {
  approxPkr,
  bandSizeOf,
  evidenceOf,
  evidenceReason,
  pkrTotal,
  rankChip,
  rankNote,
  reasonsFor,
  recordFromStats,
  recordReason,
  reliabilityBand,
  sellNote,
  unrankedReason,
  type Evidence,
  type RankRow,
} from './reasons'

const row = (o: Partial<RankRow> = {}): RankRow => ({
  rfq_item_id: 'i1',
  quote_line_id: 'q1',
  supplier_id: 's1',
  item_qty: 2,
  price: 1985,
  currency: 'USD',
  pkr_unit_price: 552_624,
  fx_state: 'fresh',
  fx_rate_pkr: 278.4,
  fx_rate_on: '2026-11-27',
  fx_age_days: 0,
  comparable: true,
  rank: 1,
  within_band: true,
  pct_above_best: 1.28,
  sell_unit_net: 612_000,
  sell_source: 'quoted',
  sell_order_number: null,
  sell_on: null,
  spread_unit: 59_376,
  spread_total: 118_752,
  reliability_band: 1,
  deliveries: 4,
  on_time: 4,
  late: 0,
  median_days_late: null,
  orders_count: 5,
  orders_value_pkr: 2_600_000,
  last_order_number: 27,
  last_order_on: '2026-02-03',
  last_order_delivered_after_days: 9,
  replied: 4,
  asked: 4,
  lead_time: '3 to 4 weeks',
  in_stock: false,
  ...o,
})

const ev: Evidence = {
  tier: 1,
  orderNumber: 27,
  itemDesc: 'Endress+Hauser Proline Promag 300',
  qty: 1,
  placedOn: '2026-02-03',
  expectedOn: '2026-02-13',
  deliveredOn: '2026-02-12',
  deliveredAfterDays: 9,
  count: 1,
}

const texts = (list: { text: string }[]) => list.map(r => r.text)

describe('numbers that are estimates', () => {
  it('rounds PKR to the nearest 100 from 1,000 up and the nearest 10 below', () => {
    expect(approxPkr(59_376)).toBe('59,400')
    expect(approxPkr(1_670)).toBe('1,700')
    expect(approxPkr(344)).toBe('340')
    expect(approxPkr(-2_940)).toBe('2,900')
    expect(pkrTotal(2_600_000)).toBe('2.6M')
    expect(pkrTotal(900_000)).toBe('0.9M')
    expect(pkrTotal(45_400)).toBe('45,000')
  })
})

describe('the delivery record (counts, never a score)', () => {
  it('uses the database bands: 3 or more deliveries and 2/3 on time is proven', () => {
    expect(reliabilityBand({ deliveries: 6, onTime: 5 })).toBe(1)
    expect(reliabilityBand({ deliveries: 3, onTime: 2 })).toBe(1)
    expect(reliabilityBand({ deliveries: 6, onTime: 2 })).toBe(3)
    expect(reliabilityBand({ deliveries: 2, onTime: 2 })).toBe(2)
    expect(reliabilityBand({ deliveries: 0, onTime: 0 })).toBe(2)
  })
  it('says the counts, and "too few to judge" below 3 deliveries', () => {
    const f = (deliveries: number, onTime: number, medianDaysLate: number | null = null) => ({ deliveries, onTime, late: deliveries - onTime, medianDaysLate })
    expect(recordReason(f(4, 4), false).text).toBe('On time 4 of 4 deliveries')
    expect(recordReason(f(0, 0), true).text).toBe('No deliveries yet')
    expect(recordReason(f(1, 1), false).text).toBe('Too few to judge: 1 delivery, on time')
    expect(recordReason(f(1, 1), true).text).toBe('Too few deliveries to judge (1 delivery, on time)')
    expect(recordReason(f(2, 1), false).text).toBe('Too few to judge: 2 deliveries, 1 on time')
    expect(recordReason(f(6, 2), false)).toMatchObject({ text: 'Often late: on time 2 of 6', tone: 'warn' })
    expect(recordReason(f(6, 2, 12), true).text).toBe('Often late: on time 2 of 6 deliveries · late ones median 12 days')
  })
  it('reads the record from v_supplier_stats columns for the float list, and says nothing without a delivery', () => {
    expect(recordFromStats({ deliveries: 6, late: 1 })?.text).toBe('On time 5 of 6 deliveries')
    expect(recordFromStats({ deliveries: 0, late: 0 })).toBeNull()
    expect(recordFromStats(null)).toBeNull()
  })
})

describe('evidence: order number, date, days to delivery', () => {
  it('item level', () => {
    expect(evidenceReason(ev).text).toBe('Ordered Endress+Hauser Proline Promag 300 ×1 for ORD-0027, placed 3 Feb 2026, delivered after 9 days (expected 10)')
  })
  it('brand and family level cite the count and the last order', () => {
    expect(evidenceReason({ ...ev, tier: 3, count: 3, itemDesc: null, qty: null, expectedOn: null }, { family: 'Flow meters' }).text).toBe(
      'Ordered in Flow meters 3 times; last for ORD-0027, placed 3 Feb 2026, delivered after 9 days',
    )
    expect(evidenceReason({ ...ev, tier: 2, count: 1 }, { brand: 'Hach' }).text).toContain('Ordered Hach 1 time; last for ORD-0027')
  })
  it('an order that is not delivered yet says so, and never says "received"', () => {
    const e = evidenceReason({ ...ev, deliveredOn: null, deliveredAfterDays: null })
    expect(e.text).toBe('Ordered Endress+Hauser Proline Promag 300 ×1 for ORD-0027, placed 3 Feb 2026, not delivered yet')
    expect(JSON.stringify([e, evidenceReason(ev)])).not.toMatch(/receiv/i)
  })
  it('reads the columns of supplier_item_memory, and null when there is no order', () => {
    expect(evidenceOf({ supplier_id: 's', best_tier: 1, supplied_before: true })).toBeNull()
    expect(evidenceOf({ supplier_id: 's', best_tier: 1, supplied_before: true, evidence_tier: 1, evidence_order_number: 31, evidence_delivered_after_days: 19, evidence_count_at_tier: 3 })).toMatchObject({ tier: 1, orderNumber: 31, deliveredAfterDays: 19, count: 3 })
  })
})

describe('a ranked row (admin and sales)', () => {
  it('a line inside the band that is not the cheapest says how far above, why it is first, and the spread', () => {
    const r = reasonsFor(row(), { showSell: true, bandSize: 2, evidence: ev })
    expect(texts(r.short)).toEqual([
      '≈ PKR 7,000 each above the best (1.3%)',
      'Within 2% of the best: by delivery record',
      'On time 4 of 4 deliveries',
      'Spread ≈ PKR 59,400 each',
    ])
    expect(texts(r.full)).toEqual([
      '≈ PKR 7,000 each above the best (1.3%)',
      'Within 2% of the best price: ordered by delivery record',
      'Spread ≈ PKR 59,400 each, PKR 118,800 for 2, against our quoted PKR 612,000. Supplier price only, before freight and duty.',
      'On time 4 of 4 deliveries',
      'Ordered from 5 times, last ORD-0027 on 3 Feb 2026 · ≈ PKR 2.6M in total',
      'Ordered Endress+Hauser Proline Promag 300 ×1 for ORD-0027, placed 3 Feb 2026, delivered after 9 days (expected 10)',
    ])
  })
  it('the cheapest line is "Best price" with the rate it was converted at', () => {
    const r = reasonsFor(row({ pct_above_best: 0, pkr_unit_price: 545_664, price: 1960, orders_count: 0, deliveries: 0, on_time: 0, spread_unit: 66_336, spread_total: 132_672, last_order_number: null, last_order_on: null }), { showSell: true, bandSize: 2 })
    expect(r.full[0].text).toBe('Best price: ≈ PKR 545,700 each (USD 1,960 at 278.40, today)')
    expect(texts(r.short)).toEqual(['Best price', 'Within 2% of the best: by delivery record', 'No deliveries yet', 'Spread ≈ PKR 66,300 each'])
    expect(r.full.some(x => x.id === 'history' || x.id === 'evidence')).toBe(false)
  })
  it('the band line is only printed when the band decided something', () => {
    const r = reasonsFor(row({ pct_above_best: 0 }), { showSell: true, bandSize: 1 })
    expect(texts(r.full).join('\n')).not.toContain('Within 2%')
  })
  it('a stale rate is named, a line above the band has no band line', () => {
    const r = reasonsFor(row({ fx_state: 'stale', fx_age_days: 12, within_band: false, pct_above_best: 4.3, currency: 'EUR', price: 392 }), { showSell: true, bandSize: 2 })
    expect(r.short.find(x => x.id === 'rate')).toMatchObject({ text: 'Rate 12 days old', tone: 'warn' })
    expect(texts(r.short)).not.toContain('Within 2% of the best: by delivery record')
  })
  it('often late is a warning and still listed', () => {
    const r = reasonsFor(row({ deliveries: 6, on_time: 2, late: 4, median_days_late: 12, reliability_band: 3 }), { showSell: true, bandSize: 2 })
    expect(r.full.find(x => x.id === 'record')).toMatchObject({ tone: 'warn', text: 'Often late: on time 2 of 6 deliveries · late ones median 12 days' })
  })
  it('no selling price: the spread line is replaced by the note', () => {
    const r = reasonsFor(row({ sell_unit_net: null, sell_source: 'none', spread_unit: null, spread_total: null }), { showSell: true, bandSize: 2 })
    expect(texts(r.full)).toContain('No selling price yet: ranked by supplier price')
    expect(r.short.some(x => x.id === 'spread')).toBe(false)
  })
  it('a last-sold price says which order it came from', () => {
    const r = reasonsFor(row({ sell_source: 'last_sold', sell_unit_net: 52_000, sell_order_number: 27, sell_on: '2026-02-03', spread_unit: 10_500, spread_total: 21_000 }), { showSell: true, bandSize: 2 })
    expect(r.full.find(x => x.id === 'spread')?.text).toContain('against the last price we sold, PKR 52,000 (ORD-0027, 3 Feb 2026)')
  })
  it('a supplier price above the selling price is a warning, not a hidden number', () => {
    const r = reasonsFor(row({ spread_unit: -3_000, spread_total: -6_000 }), { showSell: true, bandSize: 2 })
    expect(r.short.find(x => x.id === 'spread')).toMatchObject({ text: 'Spread ≈ −PKR 3,000 each', tone: 'warn' })
  })
  it('a same-currency item with no rate compares in its own currency', () => {
    const r = reasonsFor(row({ pkr_unit_price: null, fx_state: 'none', fx_rate_pkr: null, price: 102, pct_above_best: 2, within_band: false, spread_unit: null }), { showSell: true, bandSize: 1 })
    expect(r.full[0].text).toBe('USD 2 each above the best (2.0%)')
  })
})

describe('money safety: an engineer never gets a selling price or a spread', () => {
  const engineerRow = row({ sell_unit_net: null, sell_source: null, sell_order_number: null, sell_on: null, spread_unit: null, spread_total: null })
  it('no string mentions spread, selling or quoted price, even when the flag is on and the row is empty', () => {
    for (const showSell of [false, true]) {
      const r = reasonsFor(engineerRow, { showSell, bandSize: 2, evidence: ev })
      const all = JSON.stringify([r.short, r.full])
      expect(all).not.toMatch(/spread|selling|quoted|sold/i)
    }
  })
  it('even a row that wrongly carried money prints none when showSell is false', () => {
    const r = reasonsFor(row(), { showSell: false, bandSize: 2 })
    expect(JSON.stringify([r.short, r.full])).not.toMatch(/spread|selling|quoted|sold|612/i)
  })
  it('the note above the rows has no selling price for an engineer', () => {
    expect(sellNote([engineerRow], false)).toBeNull()
  })
})

describe('lines that cannot be ranked', () => {
  const unranked = row({ comparable: false, rank: null, pkr_unit_price: null, fx_state: 'none', currency: 'CNY', within_band: null, pct_above_best: null, deliveries: 0, orders_count: 0 })
  it('names the currency and what to do', () => {
    expect(unrankedReason(unranked).text).toBe('Not ranked: no current CNY rate. Add one.')
    expect(unrankedReason({ ...unranked, fx_state: 'unusable', fx_age_days: 45 }).text).toBe('Not ranked: the CNY rate is 45 days old. Add a current one.')
  })
  it('keeps the delivery record', () => {
    expect(texts(reasonsFor(unranked, { showSell: true, bandSize: 0 }).short)).toEqual(['Not ranked: no current CNY rate. Add one.', 'No deliveries yet'])
  })
})

describe('the item header', () => {
  const rows = [row(), row({ quote_line_id: 'q2', rank: 2 }), row({ quote_line_id: 'q3', rank: null, comparable: false })]
  it('counts the band and the chip', () => {
    expect(bandSizeOf(rows)).toBe(3 - 1)
    expect(rankChip(rows)).toBe('Ranked 2 of 3')
    expect(rankChip(rows.slice(0, 2))).toBe('Ranked, 2 prices')
    expect(rankChip([{ rank: null }])).toBeNull()
    expect(rankChip([{ rank: 1 }])).toBeNull()
    expect(rankChip([{ rank: 1 }, { rank: null }])).toBeNull()
  })
  it('the note says how it was ranked, or that nobody has a record, or that nothing can be ranked', () => {
    expect(rankNote(rows.slice(0, 2)).title).toBe("Ranked by price in PKR at today's rate.")
    expect(rankNote(rows.slice(0, 2).map(r => ({ ...r, deliveries: 0 }))).title).toBe('No supplier has a record yet.')
    expect(rankNote([rows[2]]).kind).toBe('none')
  })
  it('the selling price note: quoted, last sold or none', () => {
    expect(sellNote([row()], true)).toEqual({ kind: 'quoted', amount: 'PKR 612,000', text: 'each, quoted' })
    expect(sellNote([row({ sell_source: 'last_sold', sell_order_number: 27 })], true)?.text).toBe('each, last sold on ORD-0027')
    expect(sellNote([row({ sell_unit_net: null, sell_source: 'none' })], true)?.kind).toBe('none')
  })
})
