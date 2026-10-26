// Supplier replies by family (table, prose, regret, question, Chinese, substitute, EU quotation), each with our own RFQ quoted
// below the reply. The fixtures are invented (__fixtures__/replyFamilies.ts). What is checked is the contract of the reader:
// offers, declined, question and facts, and that nothing is ever read from the RFQ underneath.

import { describe, expect, it } from 'vitest'
import { parseSupplierQuote } from '@/lib/docread/supplierQuoteParse'
import * as F from './__fixtures__/replyFamilies'
import { parseSupplierReply, stripQuotedReply, type ReplyOffer } from './replyParse'
import { suggestFromReply } from './replySuggest'

const TODAY = '2026-10-22'
const read = (text: string) => parseSupplierQuote(text, F.FAMILY_ITEMS, { today: TODAY })
const offerFor = (offers: ReplyOffer[], id: string): ReplyOffer => {
  const o = offers.filter(x => x.rfqItemId === id)
  expect(o.length, `offers for ${id}`).toBeGreaterThanOrEqual(1)
  return o[0] as ReplyOffer
}
const priced = (offers: ReplyOffer[]) => offers.filter(o => o.unitPrice !== null)

describe('our own RFQ quoted below the reply is never read', () => {
  it('cuts an Outlook From/Sent/To/Subject block, in English, German and Chinese', () => {
    for (const text of [F.REPLY_TABLE, F.REPLY_GERMAN_HEADER, F.REPLY_CHINESE_HEADER]) {
      const r = read(text)
      // the RFQ underneath names "USD 150 each", "2 weeks", "100% advance" and quantities: none of it is an offer
      expect(priced(r.offers).every(o => o.unitPrice !== 150), text.slice(0, 30)).toBe(true)
      expect(r.offers.every(o => o.leadTimeDaysMax !== 14 || o.rfqItemId === 'trans'), text.slice(0, 30)).toBe(true)
    }
    expect(read(F.REPLY_GERMAN_HEADER).offers).toHaveLength(1)
    expect(read(F.REPLY_CHINESE_HEADER).offers).toHaveLength(1)
  })

  it('cuts "-----Original Message-----" and Gmail "On ... wrote:" with ">" lines', () => {
    expect(priced(read(F.REPLY_GMAIL).offers)).toHaveLength(1)
    const t = stripQuotedReply(F.REPLY_REGRET_ALL)
    expect(t).toContain('cannot offer')
    expect(t).not.toContain('target')
    expect(t.split('\n').length).toBeLessThan(F.REPLY_REGRET_ALL.split('\n').length)
  })

  it('keeps line numbers: the ">" lines are blanked, not removed', () => {
    const t = stripQuotedReply('Price USD 5\n> USD 150 each\nLead 2 weeks')
    expect(t.split('\n')).toEqual(['Price USD 5', '', 'Lead 2 weeks'])
  })

  it('reads a forwarded supplier reply and a copy that starts with its own header', () => {
    expect(priced(read(F.REPLY_FORWARDED).offers)).toHaveLength(1)
    const own = read(F.REPLY_OWN_HEADER_FIRST)
    expect(priced(own.offers)).toHaveLength(1)
    expect(own.offers[0]).toMatchObject({ rfqItemId: 'valve', unitPrice: 185, currency: 'USD' })
  })

  it('reads the offer in the plain reader too (no docread preparation)', () => {
    const r = parseSupplierReply(F.REPLY_TABLE, F.FAMILY_ITEMS, { today: TODAY })
    expect(priced(r.offers).map(o => o.unitPrice)).toEqual([185, 96.5, 12.4])
  })
})

describe('family: table', () => {
  const r = read(F.REPLY_TABLE)
  it('reads each row: price, currency, lead time, stock', () => {
    expect(offerFor(r.offers, 'valve')).toMatchObject({ unitPrice: 185, currency: 'USD', leadTimeDaysMax: 28, matchedBy: 'description' })
    expect(offerFor(r.offers, 'trans')).toMatchObject({ unitPrice: 96.5, leadTimeDaysMax: 14 })
    expect(offerFor(r.offers, 'prox')).toMatchObject({ unitPrice: 12.4, inStock: true, leadTimeDaysMax: 0 })
    expect(r.offers).toHaveLength(3)
  })
  it('reads the facts: quote ref, date, currency, validity, payment, incoterm', () => {
    expect(r.facts).toMatchObject({ quoteRef: 'QT-2026-0457', quoteDate: '2026-10-14', currency: 'USD', validity: { days: 30 }, paymentTerms: '50% advance, 50% before shipment', incoterm: 'FOB Shanghai' })
  })
  it('is neither a question nor a regret', () => {
    expect(r).toMatchObject({ question: false, regret: false, declined: [] })
  })
})

describe('family: prose', () => {
  const r = read(F.REPLY_PROSE)
  it('reads "USD 1,250/pc, delivery 4 weeks" and "EUR 980 each ex-works, 6-8 weeks"', () => {
    expect(offerFor(r.offers, 'valve')).toMatchObject({ unitPrice: 1250, currency: 'USD', leadTimeDaysMax: 28 })
    expect(offerFor(r.offers, 'trans')).toMatchObject({ unitPrice: 980, currency: 'EUR', leadTimeDaysMin: 42, leadTimeDaysMax: 56, matchedBy: 'description' })
    expect(r.offers).toHaveLength(2)
  })
  it('takes the quote ref, date, validity, payment and incoterm out of the sentences', () => {
    expect(r.facts).toMatchObject({ quoteRef: 'SQ-8841', quoteDate: '2026-10-14', validity: { days: 30 }, paymentTerms: '30% advance, balance before shipment', incoterm: 'EXW' })
  })
  it('does not guess an ambiguous separator: the offer stays, without a price, flagged', () => {
    const a = read(F.REPLY_AMBIGUOUS)
    expect(a.offers).toHaveLength(1)
    expect(a.offers[0]).toMatchObject({ rfqItemId: 'valve', unitPrice: null, currency: 'EUR', leadTimeDaysMax: 35 })
    expect(a.offers[0]?.flags).toContain('ambiguous_separator')
    const s = suggestFromReply(a, [{ ...(F.FAMILY_ITEMS[0] as (typeof F.FAMILY_ITEMS)[number]), number: 1 }], 'EUR')
    expect(s.suggestions[0]?.selectable).toBe(false)
    expect(s.suggestions[0]?.blocked).toMatch(/two ways/)
  })
  it('reads a European 1.250,00 as 1250 without a flag', () => {
    const e = read('Ball valve BV-5016-SS: EUR 1.250,00 each, 3 weeks')
    expect(e.offers[0]).toMatchObject({ unitPrice: 1250, currency: 'EUR' })
    expect(e.offers[0]?.flags).not.toContain('ambiguous_separator')
  })
})

describe('family: regret', () => {
  it('a whole-reply regret declines every item and says why', () => {
    const r = read(F.REPLY_REGRET_ALL)
    expect(r.offers).toHaveLength(0)
    expect(r.regret).toBe(true)
    expect(r.regretKind).toBe('discontinued')
    expect(r.declined.map(d => d.rfqItemId)).toEqual(['valve', 'trans', 'prox'])
    expect(r.question).toBe(false)
  })
  it('one declined item beside priced ones is declined, not a whole-reply regret', () => {
    const r = read(F.REPLY_REGRET_ONE)
    expect(priced(r.offers).map(o => o.rfqItemId)).toEqual(['valve', 'trans'])
    expect(r.regret).toBe(false)
    expect(r.declined).toEqual([expect.objectContaining({ rfqItemId: 'prox', kind: 'discontinued' })])
  })
  it('"Items 2 and 3 ... cannot offer" declines both', () => {
    const r = read(F.REPLY_REGRET_TWO)
    expect(r.declined.map(d => d.rfqItemId).sort()).toEqual(['prox', 'trans'])
    expect(priced(r.offers).map(o => o.rfqItemId)).toEqual(['valve'])
  })
  it.each([
    ['We cannot offer this item.', 'cannot_quote'],
    ['Sorry, this is not available.', 'unavailable'],
    ['The model is obsolete.', 'discontinued'],
    ['It is no longer manufactured.', 'discontinued'],
    ['This item is out of production.', 'discontinued'],
  ])('reads "%s" as a regret (%s)', (text, kind) => {
    const r = read(text)
    expect(r.regret).toBe(true)
    expect(r.regretKind).toBe(kind)
    expect(r.offers).toHaveLength(0)
  })
})

describe('family: question', () => {
  it('a reply that only asks gives no offers and is flagged as a question', () => {
    const r = read(F.REPLY_QUESTION)
    expect(r).toMatchObject({ offers: [], question: true, regret: false, declined: [] })
    expect(r.questionSnippet).toMatch(/thread/)
  })
  it('numbers inside a question (4 weeks, 150, item 3) are not offers', () => {
    const r = read(F.REPLY_QUESTION_NUMBERS)
    expect(r.offers).toEqual([])
    expect(r.question).toBe(true)
  })
  it('a question next to a real price is not a question-only reply', () => {
    const r = read('Ball valve BV-5016-SS: USD 185.00 each, 4 weeks. Could you confirm the thread?')
    expect(priced(r.offers)).toHaveLength(1)
    expect(r.question).toBe(false)
  })
  it('asks in Chinese too', () => {
    const r = read('请问阀门的螺纹是 BSP 还是 NPT？')
    expect(r.question).toBe(true)
    expect(r.offers).toEqual([])
  })
  it('a plain quote is not a question', () => {
    expect(read(F.REPLY_TABLE).question).toBe(false)
  })
})

describe('family: Chinese', () => {
  it('reads ¥ and 元 prices, full-width digits, 个, 天 and 现货, and matches by model', () => {
    const r = read(F.REPLY_CHINESE)
    expect(offerFor(r.offers, 'valve')).toMatchObject({ unitPrice: 1250, currency: 'CNY', leadTimeDaysMax: 15, matchedBy: 'model' })
    expect(offerFor(r.offers, 'trans')).toMatchObject({ unitPrice: 680, currency: 'CNY', inStock: true, leadTimeDaysMax: 0 })
    expect(offerFor(r.offers, 'prox')).toMatchObject({ unitPrice: 38.5, currency: 'CNY', leadTimeDaysMin: 7, leadTimeDaysMax: 10 })
    expect(r.offers).toHaveLength(3)
  })
  it('reads the facts from the Chinese labels', () => {
    expect(read(F.REPLY_CHINESE).facts).toMatchObject({ quoteRef: 'SQ-2026-0166', currency: 'CNY', validity: { days: 30 }, paymentTerms: '预付50%, 款到发货' })
  })
  it('a Chinese regret declines the item and keeps the other offers', () => {
    const r = read(F.REPLY_CHINESE_REGRET)
    expect(r.declined).toEqual([expect.objectContaining({ rfqItemId: 'valve', kind: 'discontinued' })])
    expect(priced(r.offers).map(o => [o.rfqItemId, o.unitPrice])).toEqual([['trans', 680], ['prox', 38.5]])
  })
  it('reads a Chinese regret for the whole reply', () => {
    const r = read('抱歉，这几款都已停产，无法报价。')
    expect(r.regret).toBe(true)
    expect(r.declined).toHaveLength(3)
  })
  it('reads a Chinese price list: currency from the 元 heading, one row per item', () => {
    const r = read(F.QUOTE_CHINESE_LIST)
    expect(priced(r.offers).map(o => [o.rfqItemId, o.unitPrice, o.currency, o.leadTimeDaysMax])).toEqual([
      ['valve', 1250, 'CNY', 15],
      ['trans', 680, 'CNY', 0],
      ['prox', 38.5, 'CNY', 10],
    ])
    expect(r.facts).toMatchObject({ quoteRef: 'SQ-2026-0166', quoteDate: '2026-10-14', currency: 'CNY', validity: { days: 30 }, paymentTerms: '预付50%, 款到发货' })
    expect(r.facts.incoterm).toMatch(/^FOB/)
  })
})

describe('family: substitute', () => {
  const r = read(F.REPLY_SUBSTITUTE)
  it('matches the replacement to our item by its old model and keeps the offered part number', () => {
    const o = r.offers.find(x => x.offeredPn === 'PT-320') as ReplyOffer
    expect(o).toMatchObject({ rfqItemId: 'trans', matchedBy: 'model', unitPrice: 104, currency: 'USD', leadTimeDaysMax: 21 })
    expect(o.flags).toContain('substitute')
  })
  it('keeps the plain offer as it is', () => {
    const o = offerFor(r.offers, 'valve')
    expect(o).toMatchObject({ unitPrice: 185, offeredPn: null })
    expect(o.flags).not.toContain('substitute')
  })
  it('an alternative named without a model of ours is matched by description', () => {
    const d = read(F.REPLY_SUBSTITUTE_BY_DESCRIPTION)
    expect(d.offers).toHaveLength(1)
    expect(d.offers[0]).toMatchObject({ rfqItemId: 'prox', matchedBy: 'description', offeredPn: 'SN-M18-N2', unitPrice: 14.2 })
  })
  it('the suggestion asks the engineer to check the substitute', () => {
    const s = suggestFromReply(r, F.FAMILY_ITEMS.map((it, i) => ({ ...it, number: i + 1 })), 'USD')
    expect(s.suggestions.find(x => x.offeredPn === 'PT-320')?.check.join(' ')).toMatch(/PT-320/)
  })
})

describe('family: EU quotation (Preventivo / Offerta)', () => {
  const r = read(F.QUOTE_ITALIAN)
  it('reads the table in the European number format with the currency from the totals', () => {
    expect(priced(r.offers).map(o => [o.rfqItemId, o.unitPrice, o.currency, o.leadTimeDaysMax])).toEqual([
      ['valve', 1250, 'EUR', 28],
      ['trans', 980, 'EUR', 56],
      ['prox', 38.5, 'EUR', 0],
    ])
    expect(r.offers).toHaveLength(3)
  })
  it('reads the facts from the Italian labels and keeps address, tax number and bank out', () => {
    expect(r.facts).toMatchObject({
      quoteRef: '2026/118',
      quoteDate: '2026-10-14',
      currency: 'EUR',
      validity: { days: 30 },
      paymentTerms: 'Bonifico bancario 30 gg d.f',
      incoterm: 'EXW Brescia',
    })
    expect(r.dropped.join('\n')).toMatch(/IBAN/)
  })
})

describe('structure seen in real mail (shapes only, invented content)', () => {
  it('reads a table whose heading and cells wrap, takes NA as a decline, and leaves the signature address alone', () => {
    const r = read(F.REPLY_CN_WRAPPED_TABLE)
    expect(priced(r.offers).map(o => [o.rfqItemId, o.unitPrice, o.currency, o.leadTimeDaysMax, o.origin])).toEqual([
      ['valve', 1250, 'CNY', 14, 'China'],
      ['trans', 680, 'CNY', 10, 'China'],
    ])
    expect(r.declined).toEqual([expect.objectContaining({ rfqItemId: 'prox', kind: 'unavailable' })])
    // "No. 2210, Building A3 ...", "Tel: +86 ..." and the quoted RFQ ("USD 150 each") add nothing
    expect(r.offers).toHaveLength(2)
  })

  it.each(F.REPLY_HEADER_STYLES.map((t, i) => [i, t]))('cuts our RFQ at header style %i', (_i, text) => {
    const r = parseSupplierQuote(text as string, F.FAMILY_ITEMS, { today: TODAY })
    expect(r.offers).toHaveLength(1)
    expect(r.offers[0]).toMatchObject({ rfqItemId: 'valve', unitPrice: 185, currency: 'USD', leadTimeDaysMax: 28 })
  })

  it('two items with one model are told apart by the row quantity', () => {
    const r = parseSupplierQuote(F.REPLY_TWIN_TABLE, F.TWIN_ITEMS, { today: TODAY })
    expect(r.offers.map(o => [o.rfqItemId, o.unitPrice])).toEqual([['valve', 280], ['silencer', 35]])
  })

  it('a "see below" row is answered by the next row: its part number is kept as the offered one', () => {
    const r = parseSupplierQuote(F.REPLY_POINTER_TABLE, F.POINTER_ITEMS, { today: TODAY })
    expect(r.offers.find(o => o.rfqItemId === 'valve')).toMatchObject({ unitPrice: 185, offeredPn: null })
    const alt = r.offers.find(o => o.rfqItemId === 'contactor')
    expect(alt).toMatchObject({ unitPrice: 80, currency: 'USD', offeredPn: 'LC-D55', leadTimeDaysMax: 5 })
    expect(alt?.flags).toContain('substitute')
  })

  it('"X is the only item we can supply" declines the others, and the signature adds no offer', () => {
    const r = read(F.REPLY_ONLY_ITEM)
    expect(r.offers).toEqual([])
    expect(r.declined.map(d => d.rfqItemId)).toEqual(['trans', 'prox'])
  })

  it('a standard, a part number, a postcode or a dotted article number is not a price', () => {
    const items = [{ id: 'cyl', description: 'Pneumatic cylinder ISO 4414, part 482917', model: '482917', qty: 1 }]
    const r = parseSupplierQuote(F.REPLY_IDENTIFIERS, items, { today: TODAY })
    expect(r.offers.map(o => [o.rfqItemId, o.unitPrice])).toEqual([['cyl', 181]])
  })

  it('reads a PDF quotation: numbered terms, the price written twice, the currency on a line of its own', () => {
    const items = [{ id: 'valve', description: 'Ball valve DN50 stainless steel BV-5016-SS', model: 'BV-5016-SS', qty: 1 }]
    const r = parseSupplierQuote(F.QUOTE_PDF_TEXT, items, { today: TODAY })
    expect(priced(r.offers).map(o => [o.rfqItemId, o.unitPrice, o.currency, o.leadTimeDaysMax])).toEqual([['valve', 185, 'USD', 7]])
    expect(r.offers).toHaveLength(1)
    expect(r.facts).toMatchObject({ quoteRef: 'QX261017-F', quoteDate: '2026-10-17', currency: 'USD', validity: { days: 90 }, paymentTerms: '100% PAYMENT PRIOR TO DISPATCH', incoterm: 'EXW' })
  })

  it('a reference printed beside the date over a table is the quote ref', () => {
    const r = parseSupplierQuote('2026/10/8   WQ20260031\nItem No.\tPart No.\tQty\tUnit Price\n1\tBV-5016-SS\t1\t$187', F.FAMILY_ITEMS, { today: TODAY })
    expect(r.facts.quoteRef).toBe('WQ20260031')
    expect(offerFor(r.offers, 'valve')).toMatchObject({ unitPrice: 187 })
  })
})

describe('round 2: shapes the first dev set did not have', () => {
  const items = [
    { id: 'XQ-100', description: 'Timing relay XQ-100' },
    { id: 'WP-2000', description: 'Pressure switch WP-2000' },
  ]
  const priced = (t: string) => parseSupplierReply(t, items, { today: '2026-10-20' }).offers.map(o => [o.rfqItemId, o.unitPrice, o.currency])

  it('numbered terms and contact lines are no offers, and a list number is no price', () => {
    const r = priced(['XQ-100 Unit price: 310,00€ 4 weeks', '2.) Prices are based on the quantity quoted.', '3.) For orders under 500EUR we charge 20EUR handling.', '4) Handling charge: USD12.00', 'Skype 1: someone.sales', 'Skype 2: another.sales'].join('\n'))
    expect(r).toEqual([['XQ-100', 310, 'EUR']])
  })

  it('a price with its currency written against it keeps a quantity after it out of the price', () => {
    expect(priced('XQ-100 relay 8A 69,87USD 1 In stock')).toEqual([['XQ-100', 69.87, 'USD']])
    expect(priced('XQ-100 US$ 235.00 each')).toEqual([['XQ-100', 235, 'USD']])
  })

  it('an item line with no price, the price on the line under it, and a line that repeats the price as a total', () => {
    const text = ['ITEM\tUNI\tQTY\tDELIVERY\t\tPRICE', '1) XQ-100 Maker - NEW', 'Modular timing relay, 8A, 1 CO, 24...240V\t69,87USD\t1\tIn stock', '5-7 days\t\t69,87USD', '2) WP-2000 Maker - NEW', 'Pressure switch 0-10 bar\t90,26USD\t1\tIn stock', '7-10 days\t\t90,26USD'].join('\n')
    expect(priced(text)).toEqual([['XQ-100', 69.87, 'USD'], ['WP-2000', 90.26, 'USD']])
  })

  it('a "Best regards" in a template above the quotation table does not hide the table', () => {
    const text = ['Good day,', 'Please find our proposal.', 'Best regards', 'ITEM\tQTY\tPRICE', '1) XQ-100 Maker', 'Timing relay\t1\t45,00USD', '2) WP-2000 Maker', 'Pressure switch\t1\t60,00USD'].join('\n')
    expect(priced(text)).toEqual([['XQ-100', 45, 'USD'], ['WP-2000', 60, 'USD']])
  })

  it('a table row the mail client wrote short (its empty Delivery cell missing) is put back under its heading', () => {
    const text = ['SL\tProduct Description\tQty\tUnit Price (RMB)\tDelivery Time\tWeight\tOrigin', '1\tModel: XQ-100 Brand: Maker\t6\t250\t1-2 weeks\t0.2 kg\tFrance', '2\tModel: WP-2000 Brand: Maker\t4\t480\t0.3 kg\tIndia'].join('\n')
    expect(priced(text)).toEqual([['XQ-100', 250, 'CNY'], ['WP-2000', 480, 'CNY']])
  })

  it('"If you have no orders, we will be unable to quote again" is a condition, not a refusal', () => {
    const r = parseSupplierReply('Do you have any order?\nIf you have no orders, we will be unable to provide further price quotes for you.', items)
    expect(r.regret).toBe(false)
  })
})

describe('round 3: a table whose cells a mail export scrambled', () => {
  it('the end of one row that landed at the start of the next goes back to its own item', () => {
    const items = ['XQ-100', 'WP-2000', 'ZT-300'].map(id => ({ id, description: id }))
    const text = [
      'SL\tProduct Description\tQty (Pcs)\tUnit Price (RMB)\tDelivery Time\tWeight(Unit)\tOrigin',
      '1\tModel: XQ-100 Brand: Maker\t6\t250\t1-2 weeks\t0.2 kg\tFrance',
      '2\tModel: WP-2000 Brand: Maker',
      '3\t380 0.3 kg India\t3\t\tModel: ZT-300\tBrand: Maker\t6 265 0.1 kg India',
    ].join('\n')
    const r = parseSupplierReply(text, items, { today: '2026-10-20' })
    expect(r.offers.map(o => [o.rfqItemId, o.unitPrice, o.currency])).toEqual([['XQ-100', 250, 'CNY'], ['WP-2000', 380, 'CNY'], ['ZT-300', 265, 'CNY']])
  })
})
