import { describe, expect, it } from 'vitest'
import { currencyForSupplier, currencySourceNote } from './replyCurrency'
import { CANT_QUOTE_REASONS, isCantQuoteReason, reasonForItem, reasonLabel } from './cantQuote'
import { defaultCloseReason } from './closeDefaults'
import { generateSupplierChase, supplierReplyBy } from './supplierChase'

describe('currencyForSupplier', () => {
  it('prefers the supplier\'s last currency', () => {
    expect(currencyForSupplier('USD', 'Germany')).toEqual({ currency: 'USD', source: 'last' })
  })
  it('falls back to the country map, any case', () => {
    expect(currencyForSupplier(null, ' china ')).toEqual({ currency: 'CNY', source: 'country' })
    expect(currencyForSupplier(undefined, 'Germany')).toEqual({ currency: 'EUR', source: 'country' })
    expect(currencyForSupplier(null, 'UAE').currency).toBe('AED')
  })
  it('falls back to PKR with no history and an unknown country', () => {
    expect(currencyForSupplier(null, null)).toEqual({ currency: 'PKR', source: 'default' })
    expect(currencyForSupplier(null, 'Atlantis').source).toBe('default')
  })
  it('ignores a malformed stored currency', () => {
    expect(currencyForSupplier('usd', 'China').source).toBe('country')
  })
  it('says where the currency came from', () => {
    expect(currencySourceNote({ currency: 'USD', source: 'last' })).toBe('USD, their last reply')
    expect(currencySourceNote({ currency: 'CNY', source: 'country' }, 'China')).toBe('CNY, usual for China')
  })
})

describe("can't quote reasons", () => {
  it('has five stable snake_case keys, the ones the database accepts', () => {
    expect(CANT_QUOTE_REASONS.map(r => r.key)).toEqual(['no_brand', 'cant_source_in_time', 'discontinued', 'wont_quote_quantity', 'other'])
    for (const r of CANT_QUOTE_REASONS) expect(r.key).toMatch(/^[a-z_]+$/)
  })
  it('builds the words from the key, and reads an unknown key as other', () => {
    expect(reasonLabel('no_brand')).toBe("Doesn't carry this brand")
    expect(reasonLabel('discontinued')).toBe('Item discontinued')
    expect(reasonLabel('something_new')).toBe('Other reason')
    expect(reasonLabel(null)).toBe('Other reason')
    expect(isCantQuoteReason('other')).toBe(true)
    expect(isCantQuoteReason("Doesn't carry this brand")).toBe(false)
  })
  it('an item override wins over the inquiry reason, which only counts once the inquiry is marked', () => {
    const base = { noOfferOn: '2026-11-27', noOfferReason: 'no_brand', itemDeclines: { b: 'discontinued' } }
    expect(reasonForItem('a', base)).toBe('no_brand')
    expect(reasonForItem('b', base)).toBe('discontinued')
    expect(reasonForItem('a', { ...base, noOfferOn: null })).toBeNull()
    expect(reasonForItem('b', { ...base, noOfferOn: null })).toBe('discontinued')
  })
})

describe('defaultCloseReason', () => {
  const base = { sourcingState: 'partly_covered', clarificationState: 'none', bidState: 'to_bid', isOverdue: false }
  it('reads the context', () => {
    expect(defaultCloseReason({ ...base, sourcingState: 'no_offer_anywhere' })).toBe('could_not_source')
    expect(defaultCloseReason({ ...base, clarificationState: 'waiting_on_customer' })).toBe('no_reply_to_clarification')
    expect(defaultCloseReason({ ...base, isOverdue: true })).toBe('we_were_late')
    expect(defaultCloseReason({ ...base, bidState: 'bid_sent' })).toBe('price')
    expect(defaultCloseReason(base)).toBe('other')
  })
  it('does not call a bid that went out late', () => {
    expect(defaultCloseReason({ ...base, isOverdue: true, bidState: 'bid_sent' })).toBe('price')
  })
})

describe('supplier chase text', () => {
  // 2026-11-27 is a Friday; the bid is due Thursday 3 December.
  const input = {
    rfqRef: 'RFQ-0179',
    sentOn: '2026-11-23',
    dueOn: '2026-12-03',
    today: '2026-11-27',
    chaseCount: 0,
    contactName: 'Mr. Imran',
    pricedNumbers: [1],
    items: [
      { number: 2, description: 'Yokogawa EJA530E pressure transmitter, 0-1 MPa', qty: 3, unit: 'nos' },
      { number: 3, description: 'Endress+Hauser Cerabar PMC71', qty: 2, unit: null },
    ],
    signature: { name: 'Ayesha Rana', company: 'Q-Tech Solutions' },
    variant: 'whatsapp' as const,
  }

  it('reply-by is two working days before the bid', () => {
    expect(supplierReplyBy('2026-12-03', '2026-11-27')).toBe('2026-12-01')
    expect(supplierReplyBy('2026-12-01', '2026-11-27')).toBe('2026-11-30')
  })
  it('never earlier than the next working day; three working days with no bid date', () => {
    expect(supplierReplyBy('2026-11-28', '2026-11-27')).toBe('2026-11-30')
    expect(supplierReplyBy(null, '2026-11-27')).toBe('2026-12-02')
  })
  it('writes the first WhatsApp chase as approved', () => {
    const t = generateSupplierChase(input)
    expect(t.replyBy).toBe('2026-12-01')
    expect(t.subject).toBeNull()
    expect(t.body).toBe(
      [
        'Assalam o Alaikum Mr. Imran,',
        '',
        'Following up on our enquiry of *Monday 23 November* (ref *RFQ-0179*). Thank you for pricing item 1. We are still awaiting your price for:',
        '2. Yokogawa EJA530E pressure transmitter, 0-1 MPa, 3 nos',
        '3. Endress+Hauser Cerabar PMC71, 2 nos',
        '',
        'Kindly send your price and lead time by *Tuesday 1 December*. If you cannot offer an item, a short note will help us approach others.',
        '',
        'Thank you.',
        'Regards,',
        'Ayesha Rana',
        'Q-Tech Solutions',
      ].join('\n'),
    )
  })
  it('asks for a "cannot offer" today from the second chase', () => {
    const t = generateSupplierChase({ ...input, chaseCount: 1 })
    expect(t.body).toContain('A second reminder on our enquiry of *Monday 23 November* (ref *RFQ-0179*).')
    expect(t.body).toContain('kindly let us know today so that we can move on.')
    expect(generateSupplierChase({ ...input, chaseCount: 2 }).body).toContain('A third reminder')
  })
  it('email carries a subject and the longer wording', () => {
    const t = generateSupplierChase({ ...input, variant: 'email', signature: { ...input.signature, jobTitle: 'Sales' } })
    expect(t.subject).toBe('RFQ-0179: price needed for 2 items by Tuesday 1 December')
    expect(t.body).toContain('Dear Mr. Imran,\nAssalam o Alaikum.')
    expect(t.body).toContain('Thank you for your quotation on item 1.')
    expect(t.body).toContain('Sales, Q-Tech Solutions')
  })
  it('never names the customer or a price, and copes with no contact, no bid date, nothing priced', () => {
    const t = generateSupplierChase({ ...input, contactName: null, dueOn: null, pricedNumbers: [], sentOn: null })
    expect(t.body.startsWith('Assalam o Alaikum,\n')).toBe(true)
    expect(t.body).toContain('our enquiry *RFQ-0179*. We are still awaiting')
    expect(t.replyBy).toBe('2026-12-02')
  })
})
