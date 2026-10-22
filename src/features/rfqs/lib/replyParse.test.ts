import { describe, expect, it } from 'vitest'
import { parseAmount, parseLeadTime, parseSupplierReply, normaliseCurrency, type ReplyItemRef, type ReplyOffer } from './replyParse'

const ITEMS: ReplyItemRef[] = [
  { id: 'i1', description: 'Siemens SITRANS P320 pressure transmitter 0-10 bar 4-20mA', qty: 4 },
  { id: 'i2', description: 'Endress+Hauser Promag 400 electromagnetic flow meter DN50', qty: 2 },
  { id: 'i3', description: 'Hach HQ1110 portable pH/EC meter with probes', qty: 1 },
  { id: 'i4', description: '24V actuator for ball valve DN40', qty: 2 },
]

const forItem = (offers: ReplyOffer[], id: string) => offers.filter(o => o.rfqItemId === id)
const one = (offers: ReplyOffer[], id: string): ReplyOffer => {
  const r = forItem(offers, id)
  expect(r, `offer for ${id}`).toHaveLength(1)
  return r[0] as ReplyOffer
}

describe('parseAmount: number formats', () => {
  it.each([
    ['1,234.50', 1234.5],
    ['1.234,50', 1234.5],
    ['1 234', 1234],
    ['1 234,50', 1234.5],
    ["1'234.50", 1234.5],
    ['1,234,567', 1234567],
    ['1.234.567,89', 1234567.89],
    ['12,5', 12.5],
    ['412.50', 412.5],
    ['0.125', 0.125],
    ['1.2k', 1200],
    ['2 k', 2000],
    ['120', 120],
    ['3.1416', 3.1416],
  ])('%s -> %s', (raw, value) => {
    expect(parseAmount(raw)?.value).toBe(value)
  })

  it('treats a lone "1.234" as ambiguous: a decimal, but thousands for EUR', () => {
    expect(parseAmount('1.234')).toEqual({ value: 1.234, ambiguous: true })
    expect(parseAmount('1.234', 'EUR')).toEqual({ value: 1234, ambiguous: true })
    expect(parseAmount('1,234')?.ambiguous).toBe(false)
  })

  it('rejects text', () => {
    expect(parseAmount('abc')).toBeNull()
  })
})

describe('parseLeadTime', () => {
  it.each([
    ['4–6 weeks', '4–6 weeks', 28, 42],
    ['4-6 wks', '4-6 wks', 28, 42],
    ['3 weeks', '3 weeks', 21, 21],
    ['30 days', '30 days', 30, 30],
    ['2 weeks after PO', '2 weeks after PO', 14, 14],
    ['6-8 weeks ARO', '6-8 weeks ARO', 42, 56],
    ['within 10 days', 'within 10 days', 10, 10],
    ['2 months', '2 months', 60, 60],
    ['15 working days', '15 working days', 21, 21],
    ['10d', '10d', 10, 10],
    ['4 to 6 weeks from PO', '4 to 6 weeks from PO', 28, 42],
  ])('%s', (input, text, min, max) => {
    const r = parseLeadTime(`Delivery: ${input}`)
    expect(r?.text).toBe(text)
    expect(r?.daysMin).toBe(min)
    expect(r?.daysMax).toBe(max)
  })

  it.each([['ex-stock'], ['Ex stock'], ['available from stock'], ['現货 / 现货']])('%s is ex-stock, 0 days', input => {
    const r = parseLeadTime(input)
    expect(r?.exStock).toBe(true)
    expect(r?.daysMax).toBe(0)
  })

  it('reads "immediate" as 0 days but not ex-stock', () => {
    expect(parseLeadTime('Delivery immediate')).toMatchObject({ text: 'immediate', daysMax: 0, exStock: false })
  })

  it('does not take validity, payment terms or warranty for a lead time', () => {
    expect(parseLeadTime('valid for 30 days')).toBeNull()
    expect(parseLeadTime('payment 30 days after delivery')).toBeNull()
    expect(parseLeadTime('12 months warranty')).toBeNull()
    expect(parseLeadTime('30 days validity, delivery 4 weeks')?.text).toBe('4 weeks')
  })

  it('does not take sizes for a lead time', () => {
    expect(parseLeadTime('DN50 4-20mA 0-10 bar 24V')).toBeNull()
  })
})

describe('normaliseCurrency', () => {
  it.each([
    ['USD', 'USD'], ['$', 'USD'], ['US$', 'USD'], ['us $', 'USD'], ['EUR', 'EUR'], ['€', 'EUR'], ['CNY', 'CNY'], ['RMB', 'CNY'], ['¥', 'CNY'],
    ['AED', 'AED'], ['GBP', 'GBP'], ['£', 'GBP'], ['PKR', 'PKR'], ['Rs.', 'PKR'], ['Rs', 'PKR'],
  ])('%s', (raw, code) => expect(normaliseCurrency(raw)).toBe(code))
  it('is null for anything else', () => {
    expect(normaliseCurrency('')).toBeNull()
    expect(normaliseCurrency('bar')).toBeNull()
  })
})

describe('sample 1: USD email, numbered, model codes', () => {
  const r = parseSupplierReply(
    `Dear Sir,
Thank you for your enquiry. Our best offer:
1) Siemens SITRANS P320 pressure transmitter 0-10 bar 4-20mA - USD 412.50 each, 3-4 weeks, genuine Siemens, Germany
2) Hach HQ1110 portable pH/EC meter with probes - USD 1,240.00 ex-stock
Prices are ex-works, valid 30 days.
Best regards, John`,
    ITEMS,
  )

  it('reads price, currency, lead time and origin for the transmitter without taking 0-10 or 4-20 for a price', () => {
    const o = one(r.offers, 'i1')
    expect(o).toMatchObject({ unitPrice: 412.5, currency: 'USD', currencySource: 'line', matchedBy: 'model', leadTimeText: '3-4 weeks', leadTimeDaysMax: 28, leadTimeDaysMin: 21 })
    expect(o.origin).toMatch(/Genuine Siemens/i)
    expect(o.origin).toMatch(/Germany/)
    expect(o.confidence).toBe('high')
    expect(o.snippet).toContain('USD 412.50')
    expect(o.lineNumbers).toEqual([3])
  })

  it('reads ex-stock as stock and 0 days', () => {
    const o = one(r.offers, 'i3')
    expect(o).toMatchObject({ unitPrice: 1240, currency: 'USD', inStock: true, leadTimeDaysMax: 0, matchedBy: 'model' })
  })

  it('applies the reply-level validity to both and marks it inherited', () => {
    for (const id of ['i1', 'i3']) {
      const o = one(r.offers, id)
      expect(o.validityDays).toBe(30)
      expect(o.inherited).toContain('validity')
    }
  })

  it('is not a regret', () => {
    expect(r.regret).toBe(false)
    expect(r.declined).toEqual([])
  })
})

describe('sample 2: CNY, WhatsApp-style, mixed symbols', () => {
  const r = parseSupplierReply(
    `hi boss
24v actuator ball valve dn40 RMB 380/pc 现货
flow meter dn50 ¥ 2,850 15-20 days`,
    ITEMS,
  )
  it('reads RMB and ¥ as CNY and matches by description', () => {
    expect(one(r.offers, 'i4')).toMatchObject({ unitPrice: 380, currency: 'CNY', inStock: true, matchedBy: 'description' })
    expect(one(r.offers, 'i2')).toMatchObject({ unitPrice: 2850, currency: 'CNY', leadTimeText: '15-20 days', leadTimeDaysMax: 20 })
  })
  it('did not take DN40 or 24V for a price', () => {
    expect(r.offers.map(o => o.unitPrice)).toEqual([2850, 380].sort((a, b) => (r.offers[0]?.unitPrice === 380 ? a - b : b - a)))
  })
})

describe('sample 3: EUR, European number format', () => {
  const r = parseSupplierReply(
    `Item 2: Promag 400 flow meter DN50 EUR 1.850,00 per piece, 8 weeks after PO, origin Germany
Item 3 - HQ1110 - 1.234,50 € - 6-8 wks`,
    ITEMS,
  )
  it('reads 1.850,00 and 1.234,50', () => {
    expect(one(r.offers, 'i2')).toMatchObject({ unitPrice: 1850, currency: 'EUR', leadTimeText: '8 weeks after PO', leadTimeDaysMax: 56, origin: 'Germany' })
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 1234.5, currency: 'EUR', leadTimeText: '6-8 wks' })
  })
})

describe('sample 4: email table pasted as text (tabs, unit-price header with currency)', () => {
  const r = parseSupplierReply(
    [
      'Item\tDescription\tQty\tUnit Price (USD)\tTotal\tLead time\tOrigin',
      '1\tSITRANS P320 pressure transmitter\t4\t412.50\t1,650.00\t3-4 weeks\tGermany',
      '2\tPromag 400 flow meter DN50\t2\t1,980\t3,960\t6 weeks\tGermany',
      '3\tHach HQ1110 pH meter\t1\t1240\t1240\tex-stock\tUSA',
    ].join('\n'),
    ITEMS,
  )
  it('takes the unit-price column, not the quantity or the total', () => {
    expect(one(r.offers, 'i1')).toMatchObject({ unitPrice: 412.5, currency: 'USD', totalPrice: 1650, qty: 4, leadTimeText: '3-4 weeks', origin: 'Germany' })
    expect(one(r.offers, 'i2')).toMatchObject({ unitPrice: 1980, currency: 'USD', leadTimeDaysMax: 42 })
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 1240, inStock: true, origin: 'USA' })
  })
  it('gives the currency from the header as a line currency with high confidence', () => {
    expect(one(r.offers, 'i1').confidence).toBe('high')
  })
})

describe('sample 5: table with pipes, lead time in a number-only column, currency column', () => {
  const r = parseSupplierReply(
    `| No | Item | Qty | Price | Currency | Lead time (weeks) | MOQ |
|----|------|-----|-------|----------|-------------------|-----|
| 1 | P320 transmitter | 4 | 395 | EUR | 3-4 | 2 |
| 2 | Promag flow meter DN50 | 2 | 1,850 | EUR | 6 | 1 |`,
    ITEMS,
  )
  it('maps columns by header', () => {
    expect(one(r.offers, 'i1')).toMatchObject({ unitPrice: 395, currency: 'EUR', leadTimeText: '3-4 weeks', leadTimeDaysMax: 28, moq: 2 })
    expect(one(r.offers, 'i2')).toMatchObject({ unitPrice: 1850, currency: 'EUR', leadTimeText: '6 weeks', leadTimeDaysMax: 42 })
  })
})

describe('sample 6: table with column gaps of spaces and no currency anywhere', () => {
  const r = parseSupplierReply(
    `Sr  Description  Qty  Rate  Delivery
1   P320 pressure transmitter   4   410   2 weeks
2   HQ1110 pH meter   1   1250   ex-stock`,
    ITEMS,
  )
  it('does not invent a currency', () => {
    const a = one(r.offers, 'i1')
    expect(a).toMatchObject({ unitPrice: 410, currency: null, currencySource: null, leadTimeText: '2 weeks' })
    expect(a.flags).toContain('currency_missing')
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 1250, currency: null })
  })
})

describe('sample 7: partial reply, only some items quoted, others pending', () => {
  const r = parseSupplierReply(
    `Hello, we can offer only the transmitter right now.
P320 transmitter: USD 405 / 3 weeks
For the flow meter and actuator we will revert tomorrow.`,
    ITEMS,
  )
  it('returns one offer and nothing for the rest', () => {
    expect(r.offers).toHaveLength(1)
    expect(one(r.offers, 'i1')).toMatchObject({ unitPrice: 405, currency: 'USD', leadTimeText: '3 weeks' })
    expect(r.regret).toBe(false)
  })
})

describe('sample 8: whole-reply regret', () => {
  const r = parseSupplierReply(`Dear Sir,\nWe regret to inform you that we are unable to quote for these items at present.\nRegards`, ITEMS)
  it('flags regret with no offers and declines every item', () => {
    expect(r.regret).toBe(true)
    expect(r.regretKind).toBe('cannot_quote')
    expect(r.regretSnippet).toMatch(/regret/)
    expect(r.offers).toEqual([])
    expect(r.declined.map(d => d.rfqItemId)).toEqual(['i1', 'i2', 'i3', 'i4'])
  })
})

describe('sample 9: one item quoted, one declined (not a whole-reply regret)', () => {
  const r = parseSupplierReply(
    `1) P320 transmitter USD 400, 2 weeks
2) Sorry, we don't handle Endress+Hauser flow meters`,
    ITEMS,
  )
  it('keeps the offer and lists the decline for item 2', () => {
    expect(r.regret).toBe(false)
    expect(one(r.offers, 'i1').unitPrice).toBe(400)
    expect(r.declined).toHaveLength(1)
    expect(r.declined[0]).toMatchObject({ rfqItemId: 'i2', kind: 'not_handled' })
  })
})

describe('sample 10: discontinued model', () => {
  const r = parseSupplierReply(`HQ1110 is discontinued, no longer available.`, ITEMS)
  it('declines that item as discontinued', () => {
    expect(r.regret).toBe(true)
    expect(r.regretKind).toBe('discontinued')
    expect(r.declined).toEqual([expect.objectContaining({ rfqItemId: 'i3', kind: 'discontinued' })])
  })
})

describe('sample 11: single-item RFQ, price with k suffix and no item words', () => {
  const r = parseSupplierReply(`USD 1.2k, ex-stock Dubai`, [{ id: 'only', description: 'Rosemount 3051 pressure transmitter', qty: 1 }])
  it('assigns the lone line to the lone item with a lower match score', () => {
    expect(r.offers).toHaveLength(1)
    expect(r.offers[0]).toMatchObject({ rfqItemId: 'only', matchedBy: 'single-item', unitPrice: 1200, currency: 'USD', inStock: true })
    expect(r.offers[0]?.confidence).not.toBe('low')
  })
})

describe('sample 12: AED and a per-unit lead time with "after PO"', () => {
  const r = parseSupplierReply(`24V actuator ball valve DN40 - AED 4,500 each - 2 weeks after PO - MOQ 2 pcs`, ITEMS)
  it('reads AED, lead time and MOQ', () => {
    expect(one(r.offers, 'i4')).toMatchObject({ unitPrice: 4500, currency: 'AED', leadTimeText: '2 weeks after PO', leadTimeDaysMax: 14, moq: 2 })
  })
})

describe('sample 13: GBP with symbol, MOQ and validity', () => {
  const r = parseSupplierReply(`P320 transmitter £95.00 per unit, lead time 30 days, MOQ 10, valid 14 days`, ITEMS)
  it('does not mix up the 30 days lead time with the 14 days validity', () => {
    expect(one(r.offers, 'i1')).toMatchObject({ unitPrice: 95, currency: 'GBP', leadTimeText: '30 days', leadTimeDaysMax: 30, moq: 10, validityDays: 14 })
  })
})

describe('sample 14: PKR', () => {
  const r = parseSupplierReply(`HQ1110 meter Rs. 125,000/- per piece, available ex-stock Lahore`, ITEMS)
  it('reads Rs. as PKR and ignores the trailing /-', () => {
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 125000, currency: 'PKR', inStock: true })
  })
})

describe('sample 15: total only, quantity on the line', () => {
  const r = parseSupplierReply(`P320 transmitter 5 pcs USD 600 total, 3 weeks`, ITEMS)
  it('derives the unit price from the total and says so', () => {
    const o = one(r.offers, 'i1')
    expect(o).toMatchObject({ unitPrice: 120, totalPrice: 600, qty: 5, currency: 'USD' })
    expect(o.flags).toContain('derived_from_total')
    expect(o.confidence).not.toBe('high')
  })
})

describe('sample 16: sizes and ratings are never prices', () => {
  const r = parseSupplierReply(`SITRANS P320 pressure transmitter 0-10 bar, 4-20mA, 24VDC, IP67, G1/2, DN50 Price: USD 310`, ITEMS)
  it('takes only the amount behind the currency', () => {
    expect(r.offers).toHaveLength(1)
    expect(r.offers[0]).toMatchObject({ unitPrice: 310, currency: 'USD', leadTimeText: null })
    expect(r.offers[0]?.otherPrices).toEqual([])
  })
  it('reads one bare number when nothing else is left', () => {
    const b = parseSupplierReply(`P320 transmitter 0-10 bar 4-20mA 24V DN50 IP65, 2 weeks, 250`, ITEMS)
    expect(b.offers[0]).toMatchObject({ unitPrice: 250, currency: null, leadTimeText: '2 weeks' })
    expect(b.offers[0]?.flags).toEqual(expect.arrayContaining(['bare_number', 'currency_missing']))
  })
  it('reads a line with nothing but sizes as no price', () => {
    const c = parseSupplierReply(`P320 transmitter 0-10 bar 4-20mA 24V DN50`, ITEMS)
    expect(c.offers).toEqual([])
  })
})

describe('sample 17: block layout, details on following lines', () => {
  const r = parseSupplierReply(
    `Item 1 - P320 pressure transmitter
  Price: USD 399
  Lead time: 4-6 weeks
  Origin: Germany

Item 3 - HQ1110
  Unit price: EUR 1,180.00
  Delivery: ex-stock`,
    ITEMS,
  )
  it('attaches continuation lines to the item above', () => {
    expect(one(r.offers, 'i1')).toMatchObject({ unitPrice: 399, currency: 'USD', leadTimeText: '4-6 weeks', leadTimeDaysMax: 42, origin: 'Germany' })
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 1180, currency: 'EUR', inStock: true })
    expect(one(r.offers, 'i1').snippet).toContain('Price: USD 399')
    expect(one(r.offers, 'i1').lineNumbers).toEqual([1, 2, 3, 4])
  })
})

describe('sample 18: two quotes on one line, numbered', () => {
  const r = parseSupplierReply(`1) P320 usd 410 2) HQ1110 usd 1,250`, ITEMS)
  it('cuts the line at the markers', () => {
    expect(one(r.offers, 'i1')).toMatchObject({ unitPrice: 410, currency: 'USD' })
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 1250, currency: 'USD' })
  })
})

describe('sample 19: WhatsApp export with timestamps and chatter', () => {
  const r = parseSupplierReply(
    `[12/10/26, 3:45 PM] Wang Lei: ok checking
[12/10/26, 3:52 PM] Wang Lei: P320 transmitter 405usd 3wks
[12/10/26, 3:52 PM] Wang Lei: HQ1110 1180 usd ex stock
[12/10/26, 3:53 PM] Wang Lei: all prices fob shanghai`,
    ITEMS,
  )
  it('ignores the timestamps and reads the two quotes', () => {
    expect(one(r.offers, 'i1')).toMatchObject({ unitPrice: 405, currency: 'USD', leadTimeText: '3wks', leadTimeDaysMax: 21 })
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 1180, currency: 'USD', inStock: true })
  })
})

describe('sample 20: a general currency statement fills lines that carry none', () => {
  const r = parseSupplierReply(
    `All prices in RMB, ex-works.
P320 transmitter 2,950, 15 days
Promag flow meter DN50 18,500, 25-30 days`,
    ITEMS,
  )
  it('marks the currency as taken from the reply', () => {
    const a = one(r.offers, 'i1')
    expect(a).toMatchObject({ unitPrice: 2950, currency: 'CNY', currencySource: 'reply' })
    expect(a.inherited).toContain('currency')
    expect(r.replyCurrency).toBe('CNY')
    expect(one(r.offers, 'i2')).toMatchObject({ unitPrice: 18500, currency: 'CNY', leadTimeDaysMax: 30 })
  })
  it('can be switched off', () => {
    const off = parseSupplierReply(`All prices in RMB.\nP320 transmitter 2,950`, ITEMS, { inheritReplyLevel: false })
    expect(off.offers[0]).toMatchObject({ unitPrice: 2950, currency: null })
  })
})

describe('sample 21: mixed currencies are never merged', () => {
  const r = parseSupplierReply(`P320 transmitter USD 400\nHQ1110 meter 9,000 RMB\nPromag DN50 flow meter 2000`, ITEMS)
  it('keeps each line currency and leaves the bare one without', () => {
    expect(one(r.offers, 'i1').currency).toBe('USD')
    expect(one(r.offers, 'i3').currency).toBe('CNY')
    const bare = one(r.offers, 'i2')
    expect(bare.currency).toBeNull()
    expect(r.replyCurrency).toBeNull()
  })
})

describe('sample 22: bare numbers placed by position', () => {
  const r = parseSupplierReply(`P320 transmitter USD 410\n1250\n480`, ITEMS)
  it('assigns left-over price lines to the first uncovered items, with low confidence', () => {
    const pos = r.offers.filter(o => o.matchedBy === 'position')
    expect(pos.map(o => [o.rfqItemId, o.unitPrice])).toEqual([['i2', 1250], ['i3', 480]])
    expect(pos.every(o => o.confidence === 'low' && o.flags.includes('match_by_position'))).toBe(true)
  })
})

describe('sample 23: price line that matches nothing and cannot be placed', () => {
  it('is returned with no item so the engineer can assign it', () => {
    const r = parseSupplierReply(`Some widget USD 55\nOther gadget USD 66\nThird thing USD 77\nFourth USD 88\nFifth USD 99`, ITEMS)
    expect(r.offers.length).toBe(5)
    expect(r.offers.every(o => o.rfqItemId === null && o.matchedBy === 'none' && o.flags.includes('no_item_match'))).toBe(true)
  })
})

describe('sample 24: validity written as a date', () => {
  it('turns "valid till 30 Nov 2026" into days from today', () => {
    const r = parseSupplierReply(`P320 transmitter USD 400, valid till 30 Nov 2026`, ITEMS, { today: '2026-10-14' })
    expect(r.offers[0]?.validityDays).toBe(47)
    expect(r.offers[0]?.validityText).toMatch(/30 Nov 2026/)
  })
  it('keeps the text and no days without a today', () => {
    const r = parseSupplierReply(`P320 transmitter USD 400, valid till 30 Nov 2026`, ITEMS)
    expect(r.offers[0]?.validityDays).toBeNull()
  })
})

describe('sample 25: out of stock is a stock answer, not a regret', () => {
  const r = parseSupplierReply(`HQ1110 meter USD 1,300, out of stock, 8-10 weeks`, ITEMS)
  it('sets in_stock false and keeps the lead time', () => {
    expect(r.regret).toBe(false)
    expect(one(r.offers, 'i3')).toMatchObject({ unitPrice: 1300, inStock: false, leadTimeText: '8-10 weeks', leadTimeDaysMax: 70 })
  })
})

describe('sample 26: price breaks and alternatives', () => {
  const r = parseSupplierReply(`P320 transmitter USD 410 (1-9 pcs), USD 395 (10+ pcs)`, ITEMS)
  it('takes the first price, lists the others and lowers confidence', () => {
    const o = one(r.offers, 'i1')
    expect(o.unitPrice).toBe(410)
    expect(o.otherPrices).toEqual([{ unitPrice: 395, currency: 'USD' }])
    expect(o.flags).toContain('multiple_prices')
  })
})

describe('sample 27: signature, phone number and dates are not prices', () => {
  const r = parseSupplierReply(
    `Dear Sir,
P320 transmitter USD 410, 3 weeks
Best regards,
Wang Lei | Sales Manager
Mob: +86 138 1234 5678  Tel 0755-83123456
Date: 12 Oct 2026`,
    ITEMS,
  )
  it('returns exactly one offer', () => {
    expect(r.offers).toHaveLength(1)
    expect(r.offers[0]?.unitPrice).toBe(410)
  })
})

describe('sample 28: empty and junk input', () => {
  it('returns nothing and no regret for empty text', () => {
    expect(parseSupplierReply('', ITEMS)).toMatchObject({ offers: [], regret: false, declined: [], lineCount: 0 })
    expect(parseSupplierReply('   \n\n', ITEMS).offers).toEqual([])
  })
  it('returns nothing for a reply with no items', () => {
    expect(parseSupplierReply('USD 100', []).offers[0]?.rfqItemId).toBeNull()
  })
  it('handles Windows line endings', () => {
    const r = parseSupplierReply('P320 transmitter USD 410\r\nHQ1110 USD 1250\r\n', ITEMS)
    expect(r.offers).toHaveLength(2)
  })
})

describe('regret wording', () => {
  it.each([
    'Sorry we cannot quote this.',
    'Unable to offer, thanks.',
    'No quote from our side.',
    'We are not interested in this enquiry',
    "Can't supply these, sorry",
    'Not our product range.',
  ])('%s', text => {
    const r = parseSupplierReply(text, ITEMS)
    expect(r.regret).toBe(true)
    expect(r.offers).toEqual([])
  })

  it('does not call "regards" or a normal quote a regret', () => {
    expect(parseSupplierReply('Best regards, USD 100 for P320', ITEMS).regret).toBe(false)
  })

  it('a regret next to a price is not a whole-reply regret', () => {
    const r = parseSupplierReply('Price for P320 USD 400.\nUnable to quote the rest.', ITEMS)
    expect(r.regret).toBe(false)
    expect(r.offers).toHaveLength(1)
  })
})

describe('never commits', () => {
  it('does not change its inputs and returns the same result twice', () => {
    const items = JSON.parse(JSON.stringify(ITEMS)) as ReplyItemRef[]
    const text = 'P320 transmitter USD 410, 3 weeks'
    const a = parseSupplierReply(text, items)
    const b = parseSupplierReply(text, items)
    expect(items).toEqual(ITEMS)
    expect(a).toEqual(b)
  })

  it('every offer carries a snippet from the pasted text, a confidence and a score', () => {
    const text = 'P320 transmitter USD 410, 3 weeks\nHQ1110 1180 USD'
    const r = parseSupplierReply(text, ITEMS)
    for (const o of r.offers) {
      expect(text).toContain(o.snippet.split(' / ')[0])
      expect(['high', 'medium', 'low']).toContain(o.confidence)
      expect(o.score).toBeGreaterThan(0)
      expect(o.score).toBeLessThanOrEqual(1)
    }
  })
})

describe('robustness', () => {
  it('reads a long paste quickly', () => {
    const text = Array.from({ length: 1500 }, (_, i) => `Line ${i}: P320 transmitter 0-10 bar USD ${100 + i}.50, ${i % 9 + 1}-${i % 9 + 3} weeks, DN50 24V`).join('\n')
    const t0 = Date.now()
    const r = parseSupplierReply(text, ITEMS)
    expect(r.offers.length).toBe(1500)
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('does not hang on long runs of digits, spaces and separators', () => {
    const t0 = Date.now()
    parseSupplierReply(`${'1 '.repeat(2000)}\n${'1,'.repeat(2000)}\n${'a-'.repeat(2000)}`, ITEMS)
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

describe('Pakistani (lakh) grouping and lakh / crore words', () => {
  const PUMP: ReplyItemRef[] = [{ id: 'p1', description: 'Pressure transmitter', qty: 1 }]
  const priceOf = (text: string) => {
    const r = parseSupplierReply(text, PUMP, { today: '2026-10-19' })
    return r.offers.map(o => [o.unitPrice, o.currency])
  }
  it.each([
    ['Rs 1,25,000 each', 125000, 'PKR'],
    ['PKR 12,50,000/-', 1250000, 'PKR'],
    ['Price: 1,25,000 PKR', 125000, 'PKR'],
    ['Rs. 1,00,00,000', 10000000, 'PKR'],
    ['Price PKR 2.5 lakh', 250000, 'PKR'],
    ['PKR 3 lac', 300000, 'PKR'],
    ['Rs 1.2 crore', 12000000, 'PKR'],
  ])('reads %s as %d, never as a decimal of it', (text, value, cur) => {
    expect(priceOf(text)).toEqual([[value, cur]])
  })
  it('keeps western grouping as it was', () => {
    expect(priceOf('USD 1,250.50')).toEqual([[1250.5, 'USD']])
    expect(priceOf('USD 1,234,567')).toEqual([[1234567, 'USD']])
  })
})

describe('validity date written without a year', () => {
  it('reads "valid till 15 Jan" sent in December as next January, not as a date already past', () => {
    const r = parseSupplierReply(`P320 transmitter USD 400, valid till 15 Jan`, ITEMS, { today: '2026-12-10' })
    expect(r.offers[0]?.validityDays).toBe(36)
  })
  it('keeps a yearless date later this year in this year', () => {
    const r = parseSupplierReply(`P320 transmitter USD 400, valid till 30 Dec`, ITEMS, { today: '2026-12-10' })
    expect(r.offers[0]?.validityDays).toBe(20)
  })
})

describe('a table with list price, discount and net price (fictional)', () => {
  it('takes the net price as the unit price', () => {
    const text = [
      'Pos\tDescription\tQty\tList Price USD\tDisc. %\tNet Price USD\tTotal USD',
      '1\tSITRANS P320 pressure transmitter 0-10 bar\t4\t480.00\t15%\t408.00\t1632.00',
    ].join('\n')
    const o = one(parseSupplierReply(text, ITEMS, { today: '2026-10-20' }).offers, 'i1')
    expect(o.unitPrice).toBe(408)
    expect(o.currency).toBe('USD')
  })
})
