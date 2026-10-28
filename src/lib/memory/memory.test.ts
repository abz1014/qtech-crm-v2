import { describe, expect, it } from 'vitest'
import { agedDate, buildMemoryCard, lastPriceChip, monthsBetween, ordersFact, repliesFact, tierLabelOf, type MemoryRow } from './index'

const TODAY = '2026-11-27'

function row(over: Partial<MemoryRow> = {}): MemoryRow {
  return { supplier_id: 's1', best_tier: 0, supplied_before: true, ...over }
}

describe('tiers', () => {
  it('names every tier and nothing else', () => {
    expect(['0', '1', '2', '3'].map(t => tierLabelOf(+t))).toEqual(['same model', 'same item', 'same brand', 'same family'])
    expect(tierLabelOf(null)).toBeNull()
    expect(tierLabelOf(4)).toBeNull()
  })
})

describe('age', () => {
  it('counts whole calendar months', () => {
    expect(monthsBetween('2025-04-11', '2026-11-27')).toBe(19)
    expect(monthsBetween('2025-05-30', '2026-11-27')).toBe(17)
    expect(monthsBetween('2026-11-27', '2026-11-27')).toBe(0)
  })
  it('shows the age only past 18 months, as month and year', () => {
    expect(agedDate('2026-06-14', TODAY)).toEqual({ text: '14 Jun', ago: null })
    expect(agedDate('2025-05-30', TODAY)).toEqual({ text: '30 May 2025', ago: null })
    expect(agedDate('2025-04-11', TODAY)).toEqual({ text: 'Apr 2025', ago: '19 months ago' })
  })
})

describe('replies (low-data copy, D03)', () => {
  it('says no history yet with no enquiries', () => {
    expect(repliesFact(null)).toEqual({ main: 'No history yet', sub: null })
    expect(repliesFact({ asked: 0 }).main).toBe('No history yet')
  })
  it('shows raw facts below 3 asks, never a rate', () => {
    expect(repliesFact({ asked: 2, replied: 1, median_reply_days: 4 })).toEqual({ main: 'asked twice', sub: '1 reply' })
    expect(repliesFact({ asked: 1, replied: 0 })).toEqual({ main: 'asked once', sub: 'no reply' })
  })
  it('shows counts out of counts, with the median only when the database gave one', () => {
    expect(repliesFact({ asked: 8, replied: 7, median_reply_days: 1 })).toEqual({ main: 'answered 7 of 8', sub: 'usually logs a reply in ~1 day' })
    expect(repliesFact({ asked: 9, replied: 5, median_reply_days: null })).toEqual({ main: 'answered 5 of 9', sub: 'not enough replies yet to say how fast they answer' })
    expect(repliesFact({ asked: 4, replied: 4, median_reply_days: 0 }).sub).toBe('usually logs a reply the same day')
  })
  it('never prints a percentage', () => {
    const all = JSON.stringify([repliesFact({ asked: 8, replied: 7, median_reply_days: 1 }), ordersFact({ chosen_of: 3, chosen: 2, deliveries: 3, late: 0 })])
    expect(all).not.toContain('%')
  })
})

describe('orders and deliveries', () => {
  it('is absent with nothing behind it', () => {
    expect(ordersFact({ chosen_of: 0, deliveries: 0 })).toBeNull()
  })
  it('says chosen c of k and late l of d', () => {
    expect(ordersFact({ chosen_of: 3, chosen: 2, deliveries: 4, late: 1 })).toEqual({
      main: 'chosen 2 of 3 times',
      sub: 'a quoted item was later ordered · late 1 of 4 deliveries',
    })
  })
  it('adds the median days late only when the database gave one (3 or more late)', () => {
    expect(ordersFact({ deliveries: 3, late: 3, median_days_late: 9 })?.sub).toBe('late 3 of 3 deliveries, usually ~9 days over')
    expect(ordersFact({ deliveries: 3, late: 2, median_days_late: null })?.sub).toBe('late 2 of 3 deliveries')
  })
})

describe('memory card', () => {
  it('(n) shows the rate captured on the day, labelled, not today\'s', () => {
    const c = buildMemoryCard(
      row({
        last_quote_on: '2026-06-14',
        last_quote_tier: 0,
        last_quote_price: 1980,
        last_quote_currency: 'USD',
        last_quote_fx_rate_pkr: 278.3,
        last_quote_fx_rate_on: '2026-06-14',
        last_quote_price_pkr: 551034,
        last_quote_qty: 1,
        last_quote_unit: 'pcs',
      }),
      { asked: 6, replied: 5 },
      TODAY,
    )
    expect(c.quote.amount).toBe('USD 1,980')
    expect(c.quote.pkr).toBe('551,034')
    expect(c.quote.rate).toBe('278.30 · 14 Jun')
    expect(c.quote.note).toBeNull()
    expect(c.quote.qty).toBe('1 pcs')
  })
  it('(n) a legacy line with no captured rate shows the original currency only', () => {
    const c = buildMemoryCard(
      row({ last_quote_on: '2025-04-11', last_quote_tier: 0, last_quote_price: 640, last_quote_currency: 'USD', last_quote_is_legacy: true }),
      { asked: 8, replied: 7, legacy_asked: 2 },
      TODAY,
    )
    expect(c.quote.amount).toBe('USD 640')
    expect(c.quote.pkr).toBeNull()
    expect(c.quote.note).toBe('PKR value not captured at the time')
    expect(c.quote.date).toEqual({ text: 'Apr 2025', ago: '19 months ago' })
    expect(c.quote.imported).toBe(true)
    expect(c.hasImported).toBe(true)
    expect(c.footnote).toContain('Includes imported history')
    expect(c.footnote).toContain('older than 18 months')
  })
  it('a PKR price has nothing to convert and no note', () => {
    const c = buildMemoryCard(row({ last_quote_on: '2026-10-01', last_quote_tier: 1, last_quote_price: 61500, last_quote_currency: 'PKR' }), { asked: 3, replied: 3 }, TODAY)
    expect(c.quote.pkr).toBeNull()
    expect(c.quote.note).toBeNull()
  })
  it('(e) hides a price whose currency is unverified, and says how many are hidden', () => {
    const c = buildMemoryCard(
      row({ last_quote_on: '2026-05-09', last_quote_tier: 1, last_quote_price_hidden: true, last_quote_price: null, last_quote_currency: null }),
      { asked: 9, replied: 5, legacy_asked: 4, prices_hidden: 2 },
      TODAY,
    )
    expect(c.quote.state).toBe('hidden')
    expect(c.quote.amount).toBeNull()
    expect(c.footnote).toContain('2 prices hidden (currency unverified)')
  })
  it('labels the last ordered price by where it came from', () => {
    const po = buildMemoryCard(row({ last_ordered_on: '2026-10-21', last_ordered_source: 'po', last_ordered_price: 395, last_ordered_currency: 'USD', last_ordered_fx_rate_pkr: 278.5, last_ordered_fx_rate_on: '2026-10-20', last_ordered_price_pkr: 110007.5 }), null, TODAY)
    expect(po.ordered.source).toBe('PO')
    expect(po.ordered.pkr).toBe('110,008')
    const ord = buildMemoryCard(row({ last_ordered_on: '2026-09-09', last_ordered_source: 'order', last_ordered_price: 86500, last_ordered_currency: 'PKR' }), null, TODAY)
    expect(ord.ordered.source).toBe('agreed on order, no PO issued')
    expect(ord.ordered.pkr).toBeNull()
  })
  it('keeps the lead time as written, with the one before it', () => {
    const c = buildMemoryCard(row({ recent_lead_times: ['ex Dubai stock, 3 pcs', '4 weeks'] }), null, TODAY)
    expect(c.lead).toEqual({ latest: 'ex Dubai stock, 3 pcs', before: '4 weeks' })
  })
  it('(a) no history at all: brands only, nothing else, no zero counts', () => {
    const c = buildMemoryCard(null, { asked: 0, brand_names: ['Auma', 'Rotork'] }, TODAY)
    expect(c.empty).toBe(true)
    expect(c.quote.state).toBe('none')
    expect(c.ordered.state).toBe('none')
    expect(c.orders).toBeNull()
    expect(c.replies.main).toBe('No history yet')
    expect(c.brands).toEqual(['Auma', 'Rotork'])
    expect(c.footnote).toBe('Nothing recorded or imported for this supplier yet.')
    expect(c.matchedOn).toContain('Nothing quoted or ordered')
  })
  it('(b) two enquiries, one reply: raw facts and the too-few note', () => {
    const c = buildMemoryCard(row({ best_tier: 2 }), { asked: 2, replied: 1, last_contact: '2026-06-19' }, TODAY)
    expect(c.replies).toEqual({ main: 'asked twice', sub: '1 reply' })
    expect(c.footnote).toContain('Two enquiries on record. Too few to say how quickly they usually reply.')
    expect(c.scope).toBe('brand')
    expect(c.tierLabel).toBe('same brand')
  })
})

describe('last price chip (reply rows)', () => {
  const base = { last_quote_on: '2026-03-12', last_quote_tier: 0, last_quote_price: 412, last_quote_currency: 'USD', last_quote_fx_rate_pkr: 278.4, last_quote_fx_rate_on: '2026-03-12', last_quote_price_pkr: 114700.8 }
  it('shows the supplier\'s last quote for the same model at the rate of the day', () => {
    const c = lastPriceChip(row(base), TODAY)
    expect(c).toMatchObject({ state: 'price', amount: 'USD 412', pkr: '114,701', tierLabel: 'same model', from: 'quote' })
    expect(c?.date.text).toBe('12 Mar')
  })
  it('is absent for a same-brand or same-family match: that is not a price for this item', () => {
    expect(lastPriceChip(row({ ...base, best_tier: 2, last_quote_tier: 2 }), TODAY)).toBeNull()
    expect(lastPriceChip(row({ best_tier: 3 }), TODAY)).toBeNull()
    expect(lastPriceChip(null, TODAY)).toBeNull()
  })
  it('prefers the stronger match, then the newer date, then the quote', () => {
    const r = row({ ...base, last_quote_tier: 1, last_ordered_on: '2026-01-10', last_ordered_tier: 0, last_ordered_price: 124500, last_ordered_currency: 'PKR' })
    expect(lastPriceChip(r, TODAY)?.from).toBe('order')
    const same = row({ ...base, last_ordered_on: '2026-04-01', last_ordered_tier: 0, last_ordered_price: 400, last_ordered_currency: 'USD' })
    expect(lastPriceChip(same, TODAY)?.from).toBe('order')
    const tie = row({ ...base, last_ordered_on: '2026-03-12', last_ordered_tier: 0, last_ordered_price: 400, last_ordered_currency: 'USD' })
    expect(lastPriceChip(tie, TODAY)?.from).toBe('quote')
  })
  it('hides an unverified price and says so', () => {
    const c = lastPriceChip(row({ ...base, last_quote_price_hidden: true, last_quote_price: null, last_quote_currency: null }), TODAY)
    expect(c?.state).toBe('hidden')
    expect(c?.amount).toBeNull()
  })
  it('a legacy line with no captured rate shows the original currency and says no PKR value was captured', () => {
    const c = lastPriceChip(row({ ...base, last_quote_fx_rate_pkr: null, last_quote_fx_rate_on: null, last_quote_price_pkr: null, last_quote_is_legacy: true }), TODAY)
    expect(c?.pkr).toBeNull()
    expect(c?.note).toBe('PKR value not captured at the time')
    expect(c?.imported).toBe(true)
  })
})
