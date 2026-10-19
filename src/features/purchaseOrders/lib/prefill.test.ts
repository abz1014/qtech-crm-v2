import { describe, expect, it } from 'vitest'
import { wholeInWords } from '@/features/quotations/lib/totals'
import { currencyInWords, unitPriceText, issueLines, lineTotal, missingPrices, poTotal, priceOf, sourceOf, sourceText, termsDefaults, type PrefillRow } from '@/features/purchaseOrders/lib/prefill'

const row = (over: Partial<PrefillRow>): PrefillRow => ({
  orderItemId: 'i1',
  position: 0,
  description: 'Cerabar PMC51',
  qty: 3,
  unit: 'ea',
  unitPrice: 612,
  source: 'order',
  sourceNumber: null,
  sourceRevision: null,
  sourceOn: null,
  ...over,
})
const TODAY = '2026-11-27'

describe('PO line prices and their sources (O07)', () => {
  const order = row({})
  const lastPo = row({ orderItemId: 'i2', unitPrice: 742, qty: 2, source: 'last_po', sourceNumber: 9, sourceRevision: 0, sourceOn: '2026-08-14' })
  const quote = row({ orderItemId: 'i3', unitPrice: 214, qty: 2, source: 'quote', sourceNumber: 162, sourceOn: '2026-10-11' })
  const typed = row({ orderItemId: 'i4', unitPrice: null, qty: 8, source: 'typed' })
  const rows = [order, lastPo, quote, typed]

  it('words each of the four sources the way the dialog shows them', () => {
    expect(sourceText(order, {}, TODAY)).toEqual({ chip: 'order', detail: 'Agreed on the order' })
    expect(sourceText(lastPo, {}, TODAY)).toEqual({ chip: 'last PO', detail: 'PO-26-0009, 14 Aug 2026' })
    expect(sourceText(quote, {}, TODAY)).toEqual({ chip: 'quote', detail: 'Their quote, RFQ-0162, 11 Oct' })
    expect(sourceText(typed, {}, TODAY)).toEqual({ chip: 'typed', detail: 'Type a price' })
    expect(sourceText(typed, { i4: 18.5 }, TODAY)).toEqual({ chip: 'typed', detail: 'Typed by you, check it' })
  })

  it('names a later revision of the last PO', () => {
    expect(sourceText({ ...lastPo, sourceRevision: 1 }, {}, TODAY).detail).toBe('PO-26-0009 R1, 14 Aug 2026')
  })

  it('a price typed over a pre-fill becomes typed; typing the same price keeps the source', () => {
    expect(sourceOf(order, {})).toBe('order')
    expect(sourceOf(order, { i1: 600 })).toBe('typed')
    expect(sourceOf(order, { i1: 612 })).toBe('order')
    expect(priceOf(order, { i1: 600 })).toBe(600)
    expect(priceOf(order, { i1: null })).toBeNull()
  })

  it('adds up the PO in the leg currency and blocks while a line has no price', () => {
    expect(lineTotal(3, 612)).toBe(1836)
    expect(lineTotal(2, null)).toBeNull()
    expect(missingPrices(rows, {}).map(r => r.orderItemId)).toEqual(['i4'])
    expect(poTotal(rows, { i4: 18.5 })).toBe(1836 + 1484 + 428 + 148)
    expect(missingPrices(rows, { i4: 18.5 })).toEqual([])
    expect(issueLines(rows, { i4: 18.5 }).map(l => [l.order_item_id, l.unit_price, l.qty])).toEqual([
      ['i1', 612, 3],
      ['i2', 742, 2],
      ['i3', 214, 2],
      ['i4', 18.5, 8],
    ])
  })
})

describe('PO terms default from the supplier last PO, then the company profile', () => {
  const profile = { po_terms: '100% advance', address: 'Office 4, Gulberg III, Lahore' }
  const last = { number: 9, revision: 0, issuedOn: '2026-08-14', incoterm: 'DAP', deliveryTerms: 'Air freight, 3 weeks', paymentTerms: 'Advance on order', ship: null }

  it('a repeat supplier asks for nothing: incoterm, delivery and payment come from the last PO, ship-to from the profile', () => {
    expect(termsDefaults(last as never, profile)).toEqual({
      incoterm: { value: 'DAP', source: 'from PO-26-0009' },
      delivery: { value: 'Air freight, 3 weeks', source: 'from PO-26-0009' },
      payment: { value: 'Advance on order', source: 'from PO-26-0009' },
      shipTo: { value: 'Office 4, Gulberg III, Lahore', source: 'Q-Tech office, default' },
    })
  })

  it('a new supplier: payment terms fall back to the profile, the rest is empty and says nothing about a source', () => {
    expect(termsDefaults(null, profile)).toEqual({
      incoterm: { value: '', source: null },
      delivery: { value: '', source: null },
      payment: { value: '100% advance', source: 'company profile' },
      shipTo: { value: 'Office 4, Gulberg III, Lahore', source: 'Q-Tech office, default' },
    })
    expect(termsDefaults(null, null).payment).toEqual({ value: '', source: null })
  })
})

describe('the total in words follows the leg currency', () => {
  it.each([
    [421300n, 'USD', 'Four thousand two hundred thirteen US dollars only.'],
    [100n, 'EUR', 'One euro only.'],
    [250050n, 'GBP', 'Two thousand five hundred pounds sterling and fifty pence only.'],
    [10000n, 'JPY', 'One hundred JPY only.'],
  ])('%s %s', (minor, ccy, text) => expect(currencyInWords(minor, ccy, wholeInWords)).toBe(text))
})

describe('the unit price on the PO PDF keeps the precision the price is stored at (numeric(14,4))', () => {
  it('prints a sub-paisa unit price in full, so qty x unit price is the amount the supplier reads', () => {
    // 10,000 pcs at 0.125: the amount is 1,250.00, and the unit price must not print as 0.13 (which would read 1,300.00)
    expect(unitPriceText(0.125)).toBe('0.125')
    expect(unitPriceText(12.3456)).toBe('12.3456')
  })
  it('keeps two decimals and the grouping for an ordinary price', () => {
    expect(unitPriceText(612)).toBe('612.00')
    expect(unitPriceText(1234.5)).toBe('1,234.50')
    expect(unitPriceText(0.1 + 0.2)).toBe('0.30')
  })
})
