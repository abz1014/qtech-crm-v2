import { describe, expect, it } from 'vitest'
import { dayText, NO_PRICE_HINT, prefillLines, priceWarnings, type PrefillInput, type PrefillMemory, type PrefillQuote } from '@/features/orders/lib/sellPrefill'

const usd = (price: number, pkr: number | null, legacyFlags: string[] = []): PrefillQuote => ({ currency: 'USD', price, pkrUnitPrice: pkr, legacyFlags })
const base = (over: Partial<PrefillInput> = {}): PrefillInput => ({
  items: [
    { id: 'a', qty: 2 },
    { id: 'b', qty: 1 },
  ],
  latest: null,
  draft: null,
  memory: [],
  quoteOf: () => undefined,
  ...over,
})
const mem = (over: Partial<PrefillMemory>): PrefillMemory => ({ itemId: 'a', quotedPrice: null, quotedRef: null, quotedOn: null, soldPrice: null, soldOrderNumber: null, soldOn: null, ...over })

describe('1 the latest issued quotation', () => {
  it('prices a line from it, labelled with the revision, ticked', () => {
    const r = prefillLines(base({ latest: { ref: 'QT-26-0058 R1', lines: [{ rfq_item_id: 'a', unit_price_net: 1500, qty: 2 }] } }))
    expect(r.a).toMatchObject({ include: true, price: 1500, source: 'quotation', sourceText: 'from QT-26-0058 R1' })
  })
  it('a line the latest revision dropped is unticked "Not in QT.. R1", and ticking it falls back to the draft, memory or nothing', () => {
    const r = prefillLines(
      base({
        latest: { ref: 'QT-26-0058 R1', lines: [{ rfq_item_id: 'a', unit_price_net: 1500, qty: 2 }] },
        memory: [mem({ itemId: 'b', soldPrice: 800, soldOrderNumber: 31, soldOn: '2026-09-02' })],
      }),
    )
    expect(r.b).toMatchObject({ include: false, notIn: 'Not in QT-26-0058 R1', price: 800, source: 'last_sold' })
  })
  it('wins over a draft and the memory, and ignores whatever rfq_items holds from an earlier revision', () => {
    const r = prefillLines(base({ latest: { ref: 'QT-26-0058 R1', lines: [{ rfq_item_id: 'a', unit_price_net: 1500, qty: 2 }] }, draft: { a: 999 }, memory: [mem({ quotedPrice: 5 })] }))
    expect(r.a.price).toBe(1500)
  })
  it('notes a quantity that differs from the item, and the item quantity stays', () => {
    const r = prefillLines(base({ latest: { ref: 'QT-26-0058', lines: [{ rfq_item_id: 'a', unit_price_net: 10, qty: 5 }] } }))
    expect(r.a.qtyNote).toContain('item quantity is used')
  })
  it('a quotation line priced 0 does not count', () => {
    const r = prefillLines(base({ latest: { ref: 'QT-1', lines: [{ rfq_item_id: 'a', unit_price_net: 0, qty: 2 }] } }))
    expect(r.a).toMatchObject({ include: false, price: null })
  })
})

describe('2 the unissued Issue quotation draft', () => {
  it('prices the line and says it was not issued', () => {
    const r = prefillLines(base({ draft: { a: 1750, b: null } }))
    expect(r.a).toMatchObject({ price: 1750, source: 'draft', sourceText: 'typed in Issue quotation, not issued', include: true })
    expect(r.b.source).toBe('none')
  })
  it('wins over the memory', () => {
    expect(prefillLines(base({ draft: { a: 1 }, memory: [mem({ quotedPrice: 2 })] })).a.source).toBe('draft')
  })
})

describe('3 the customer price memory', () => {
  it('last quoted first, with the quotation and the date', () => {
    const r = prefillLines(base({ memory: [mem({ quotedPrice: 900, quotedRef: 'QT-26-0042 R1', quotedOn: '2026-10-12', soldPrice: 800 })] }))
    expect(r.a).toMatchObject({ price: 900, source: 'last_quoted', sourceText: 'last quoted QT-26-0042 R1 on 12 Oct 2026' })
  })
  it('else last sold, with the order and the date', () => {
    const r = prefillLines(base({ memory: [mem({ soldPrice: 800, soldOrderNumber: 31, soldOn: '2026-09-02' })] }))
    expect(r.a).toMatchObject({ price: 800, source: 'last_sold', sourceText: 'last sold ORD-0031 2 Sep 2026' })
  })
})

describe('no price anywhere: the app computes none', () => {
  it('leaves the price empty with the costing-sheet hint, and the line ticked so only the price is typed', () => {
    const r = prefillLines(base({ quoteOf: () => usd(412, 114701) }))
    expect(r.a).toMatchObject({ price: null, source: 'none', sourceText: NO_PRICE_HINT, include: true })
  })
  it('never derives a price from a supplier quote, whatever its currency or rate', () => {
    const r = prefillLines(base({ quoteOf: () => ({ currency: 'PKR', price: 95000, pkrUnitPrice: 95000 }) }))
    expect(r.a.price).toBeNull()
  })
  it('with an issued quotation, a line it lacks and nothing else knows starts unticked and empty', () => {
    const r = prefillLines(base({ latest: { ref: 'QT-1', lines: [{ rfq_item_id: 'a', unit_price_net: 5, qty: 2 }] } }))
    expect(r.b).toMatchObject({ include: false, price: null })
  })
})

describe('warnings never block', () => {
  it('item_guessed and currency_unverified imports', () => {
    const r = prefillLines(base({ quoteOf: () => usd(10, 2800, ['item_guessed', 'currency_unverified']) }))
    expect(r.a.warnings.join(' ')).toMatch(/may belong to another item/)
    expect(r.a.warnings.join(' ')).toMatch(/currency .* not confirmed/)
  })
  it('no current rate on a foreign quote', () => {
    expect(prefillLines(base({ quoteOf: () => usd(10, null) })).a.warnings).toContain('No current USD rate: pick the supplier.')
  })
  it('a PKR quote has no rate problem', () => {
    expect(prefillLines(base({ quoteOf: () => ({ currency: 'PKR', price: 5, pkrUnitPrice: null }) })).a.warnings).toEqual([])
  })
  it('a typed price below the supplier cost is only a warning, and only when the cost is known', () => {
    expect(priceWarnings(100000, usd(412, 114701))[0]).toContain('PKR 114,701')
    expect(priceWarnings(120000, usd(412, 114701))).toEqual([])
    expect(priceWarnings(1, usd(412, null))).toEqual([])
    expect(priceWarnings(null, usd(412, 114701))).toEqual([])
  })
})

it('words a date by its own day', () => {
  expect(dayText('2026-10-12T23:30:00Z')).toBe('12 Oct 2026')
})
