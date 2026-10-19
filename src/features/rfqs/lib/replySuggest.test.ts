import { describe, expect, it } from 'vitest'
import { parseSupplierReply } from './replyParse'
import { draftFromSuggestions, reasonForRegret, suggestFromReply, type SuggestItem } from './replySuggest'

const items: SuggestItem[] = [
  { id: 'a', number: 1, description: 'Endress+Hauser Cerabar PMC71 pressure transmitter', qty: 2 },
  { id: 'b', number: 2, description: 'Siemens SITRANS LR250 radar level transmitter', qty: 1 },
]
const empty = { currency: 'USD', prices: {}, leadTime: '', inStock: null }

describe('suggestFromReply', () => {
  it('reads two offers, names the currency from the reply, and lets all be accepted', () => {
    const text = ['Dear Sir,', 'Cerabar PMC71: USD 438.00 each, 3-4 weeks', 'SITRANS LR250: USD 1,390.00 each, ex-stock'].join('\n')
    const set = suggestFromReply(parseSupplierReply(text, items), items, 'CNY')
    expect(set.currency).toBe('USD')
    const sel = set.suggestions.filter(s => s.selectable)
    expect(sel.map(s => [s.itemNumber, s.unitPrice])).toEqual([
      [1, 438],
      [2, 1390],
    ])
    const draft = draftFromSuggestions(empty, set, new Set(sel.map(s => s.key)))
    expect(draft.currency).toBe('USD')
    expect(draft.prices).toEqual({ a: 438, b: 1390 })
    expect(draft.leadTime).not.toBe('')
  })

  it('a price with no currency anywhere takes the supplier\'s pre-filled currency and says so', () => {
    const text = 'Cerabar PMC71 price 2980 each, 10 days'
    const set = suggestFromReply(parseSupplierReply(text, items, { inheritReplyLevel: false }), items, 'CNY')
    const s = set.suggestions.find(x => x.itemId === 'a')
    expect(s?.currency).toBe('CNY')
    expect(s?.currencyFrom).toBe('supplier')
    expect(set.currency).toBe('CNY')
  })

  it('with no currency on file and none in the reply, a bare price is not selectable until one is picked (audit R1)', () => {
    const text = 'Cerabar PMC71 price 2980 each, 10 days'
    const set = suggestFromReply(parseSupplierReply(text, items, { inheritReplyLevel: false }), items, '')
    const s = set.suggestions.find(x => x.itemId === 'a')
    expect(s?.selectable).toBe(false)
    expect(s?.blocked).toMatch(/pick the supplier/)
  })

  it('with no currency on file, a currency named in the reply picks it', () => {
    const set = suggestFromReply(parseSupplierReply('Cerabar PMC71: USD 438', items), items, '')
    expect(set.currency).toBe('USD')
    expect(set.suggestions.find(x => x.itemId === 'a')?.selectable).toBe(true)
  })

  it('an offer in another currency than the row is not selectable', () => {
    const text = ['Cerabar PMC71: USD 438', 'SITRANS LR250: USD 1390', 'extra: EUR 5'].join('\n')
    const set = suggestFromReply(parseSupplierReply(text, items), items, 'USD')
    expect(set.currency).toBe('USD')
    expect(set.suggestions.every(s => s.currency === 'USD' || !s.selectable)).toBe(true)
  })

  it('never selects an offer with no item or no price, or a second offer for the same item', () => {
    const fake = {
      offers: [
        { rfqItemId: null, unitPrice: 5, currency: 'USD', confidence: 'low', flags: [], snippet: '' },
        { rfqItemId: 'a', unitPrice: null, currency: 'USD', confidence: 'low', flags: [], snippet: '' },
        { rfqItemId: 'a', unitPrice: 10, currency: 'USD', confidence: 'high', flags: [], snippet: '' },
        { rfqItemId: 'a', unitPrice: 11, currency: 'USD', confidence: 'high', flags: [], snippet: '' },
      ],
      regret: false,
      regretKind: null,
      declined: [],
    }
    const set = suggestFromReply(fake as never, items, 'USD')
    expect(set.suggestions.map(s => s.selectable)).toEqual([false, false, true, false])
    expect(set.suggestions[3].blocked).toMatch(/already covers/)
  })

  it('highlights low confidence, ambiguous separators and position matches', () => {
    const fake = {
      offers: [
        { rfqItemId: 'a', unitPrice: 1234, currency: 'EUR', confidence: 'low', flags: ['ambiguous_separator', 'match_by_position'], snippet: '' },
        { rfqItemId: 'b', unitPrice: 5, currency: 'EUR', confidence: 'high', flags: [], snippet: '' },
      ],
      regret: false,
      regretKind: null,
      declined: [],
    }
    const set = suggestFromReply(fake as never, items, 'USD')
    expect(set.suggestions[0].check).toHaveLength(3)
    expect(set.suggestions[1].check).toEqual([])
  })

  it('a regret becomes a can\'t quote with the reason chosen from its kind', () => {
    const set = suggestFromReply(parseSupplierReply('Regret, we cannot quote this item. We do not handle this brand.', items), items, 'USD')
    expect(set.regret).not.toBeNull()
    expect(['no_brand', 'other']).toContain(set.regret?.reason)
    expect(reasonForRegret('discontinued')).toBe('discontinued')
    expect(reasonForRegret('unavailable')).toBe('cant_source_in_time')
    expect(reasonForRegret('cannot_quote')).toBe('other')
  })

  it('says nothing was found for text with no offers', () => {
    expect(suggestFromReply(parseSupplierReply('Thank you for your enquiry.', items), items, 'USD').nothingFound).toBe(true)
  })
})

describe('draftFromSuggestions', () => {
  it('keeps what the row already holds and takes stock only when the offers agree', () => {
    const set = suggestFromReply(
      {
        offers: [
          { rfqItemId: 'a', unitPrice: 10, currency: 'USD', confidence: 'high', flags: [], snippet: '', inStock: true, leadTimeText: '2 weeks' },
          { rfqItemId: 'b', unitPrice: 20, currency: 'USD', confidence: 'high', flags: [], snippet: '', inStock: false, leadTimeText: null },
        ],
        regret: false,
        regretKind: null,
        declined: [],
      } as never,
      items,
      'USD',
    )
    const all = new Set(set.suggestions.map(s => s.key))
    const d = draftFromSuggestions({ ...empty, leadTime: 'typed', prices: { z: 1 } }, set, all)
    expect(d.leadTime).toBe('typed')
    expect(d.prices).toEqual({ z: 1, a: 10, b: 20 })
    expect(d.inStock).toBeNull() // the two offers disagree
    expect(draftFromSuggestions(empty, set, new Set()).prices).toEqual({})
  })
})
