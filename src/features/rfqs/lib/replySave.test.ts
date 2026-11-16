import { describe, expect, it } from 'vitest'
import { draftFromLines, isReplyDirty, itemLeadTime, missingQuoteDetails, planReplySave, type ExistingLine } from './replySave'

const line = (itemId: string, unitPrice: number, currency = 'USD', extra: Partial<ExistingLine> = {}): ExistingLine => ({
  itemId,
  unitPrice,
  currency,
  leadTime: null,
  inStock: null,
  ...extra,
})

describe('planReplySave', () => {
  it('writes one line per price typed and ignores blanks that never had a line', () => {
    const p = planReplySave([], { currency: 'USD', prices: { a: 438, b: null, c: undefined, d: 0 }, leadTime: ' 3 weeks ', inStock: true })
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 438, leadTime: '3 weeks' }])
    expect(p.removeItemIds).toEqual([])
    expect(p.leadTime).toBe('3 weeks')
    expect(p.inStock).toBe(true)
  })
  it('updates a line in place when the currency is unchanged', () => {
    const p = planReplySave([line('a', 400)], { currency: 'USD', prices: { a: 438 }, leadTime: '', inStock: null })
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 438, leadTime: null }])
    expect(p.removeItemIds).toEqual([])
    expect(p.leadTime).toBeNull()
  })
  it('removes and re-enters a line whose currency changed, so today\'s rate is captured', () => {
    const p = planReplySave([line('a', 400, 'USD')], { currency: 'EUR', prices: { a: 400 }, leadTime: '', inStock: null })
    expect(p.removeItemIds).toEqual(['a'])
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 400, leadTime: null }])
  })
  it('removes the line of a cleared price', () => {
    const p = planReplySave([line('a', 400), line('b', 5)], { currency: 'USD', prices: { a: null, b: 5 }, leadTime: '', inStock: null })
    expect(p.removeItemIds).toEqual(['a'])
    expect(p.prices).toEqual([{ itemId: 'b', unitPrice: 5, leadTime: null }])
  })
})

describe('isReplyDirty', () => {
  const existing = [line('a', 400, 'USD', { leadTime: '2 weeks', inStock: true })]
  it('is clean when the row shows what is saved', () => {
    expect(isReplyDirty(existing, draftFromLines(existing, 'PKR'))).toBe(false)
  })
  it('is dirty for a new price, a changed price, lead time, stock or currency', () => {
    const base = draftFromLines(existing, 'PKR')
    expect(isReplyDirty(existing, { ...base, prices: { ...base.prices, b: 3 } })).toBe(true)
    expect(isReplyDirty(existing, { ...base, prices: { a: 401 } })).toBe(true)
    expect(isReplyDirty(existing, { ...base, leadTimes: { a: '3 weeks' } })).toBe(true)
    expect(isReplyDirty(existing, { ...base, inStock: false })).toBe(true)
    expect(isReplyDirty(existing, { ...base, currency: 'EUR' })).toBe(true)
  })
  it('an empty row on a supplier with no lines is clean', () => {
    expect(isReplyDirty([], draftFromLines([], 'USD'))).toBe(false)
  })
})

describe('draftFromLines', () => {
  it('takes currency and stock from the saved lines, else the pre-fill, and each line keeps its own lead time', () => {
    expect(draftFromLines([], 'CNY')).toEqual({ currency: 'CNY', prices: {}, leadTime: '', inStock: null })
    const d = draftFromLines([line('a', 1, 'EUR', { leadTime: '4 weeks', inStock: false }), line('b', 2, 'EUR')], 'CNY')
    expect(d).toEqual({ currency: 'EUR', prices: { a: 1, b: 2 }, leadTime: '', leadTimes: { a: '4 weeks', b: '' }, inStock: false })
    // An item priced now is not given another line's lead time.
    expect(itemLeadTime({ ...d, prices: { ...d.prices, c: 3 } }, 'c')).toBe('')
  })
})

describe('weight and origin (0111)', () => {
  const x = { weight: 2.5, weightUnit: 'kg' as const, origin: ' Germany ' }
  it('adds weight, unit and a trimmed origin to the planned price only when the draft holds them', () => {
    const p = planReplySave([], { currency: 'USD', prices: { a: 10, b: 20 }, leadTime: '', inStock: null, extras: { a: x } })
    expect(p.prices).toEqual([
      { itemId: 'a', unitPrice: 10, leadTime: null, weight: 2.5, weightUnit: 'kg', origin: 'Germany' },
      { itemId: 'b', unitPrice: 20, leadTime: null },
    ])
  })
  it('writes a cleared weight and origin as null', () => {
    const p = planReplySave([], { currency: 'USD', prices: { a: 10 }, leadTime: '', inStock: null, extras: { a: { weight: 0, weightUnit: 'g', origin: '  ' } } })
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 10, leadTime: null, weight: null, weightUnit: 'g', origin: null }])
  })
  it('reads the saved weight and origin back into the draft, and is not dirty until one changes', () => {
    const existing = [line('a', 10, 'USD', { weight: 2.5, weightUnit: 'kg', origin: 'Germany' })]
    const base = draftFromLines(existing, 'USD')
    expect(base.extras).toEqual({ a: { weight: 2.5, weightUnit: 'kg', origin: 'Germany' } })
    expect(isReplyDirty(existing, base)).toBe(false)
    expect(isReplyDirty(existing, { ...base, extras: { a: { ...base.extras!.a!, weight: 3 } } })).toBe(true)
    expect(isReplyDirty(existing, { ...base, extras: { a: { ...base.extras!.a!, weightUnit: 'lb' } } })).toBe(true)
    expect(isReplyDirty(existing, { ...base, extras: { a: { ...base.extras!.a!, origin: 'China' } } })).toBe(true)
  })
  it('keeps weight and origin when the currency changes and the line is entered again', () => {
    const existing = [line('a', 10, 'USD', { weight: 2.5, weightUnit: 'kg', origin: 'Germany' })]
    const p = planReplySave(existing, { ...draftFromLines(existing, 'USD'), currency: 'EUR' })
    expect(p.removeItemIds).toEqual(['a'])
    expect(p.prices[0]).toMatchObject({ itemId: 'a', weight: 2.5, origin: 'Germany' })
  })
})

describe('lead time per item (16 Nov 2026)', () => {
  it("writes each item's own lead time, and the row's for an item without one", () => {
    const p = planReplySave([], { currency: 'USD', prices: { a: 10, b: 20 }, leadTime: '6 weeks', leadTimes: { a: ' ex-stock ' }, inStock: null })
    expect(p.prices).toEqual([
      { itemId: 'a', unitPrice: 10, leadTime: 'ex-stock' },
      { itemId: 'b', unitPrice: 20, leadTime: '6 weeks' },
    ])
  })
  it("is dirty when one item's lead time changes and clean when each matches its line", () => {
    const existing = [line('a', 10, 'USD', { leadTime: '2 weeks' }), line('b', 20, 'USD', { leadTime: '5 weeks' })]
    const base = draftFromLines(existing, 'USD')
    expect(isReplyDirty(existing, base)).toBe(false)
    expect(isReplyDirty(existing, { ...base, leadTimes: { ...base.leadTimes, b: '6 weeks' } })).toBe(true)
  })
})

describe('missingQuoteDetails: lead time and weight are required for every priced item', () => {
  const kg = (weight: number | null) => ({ weight, weightUnit: 'kg' as const, origin: '' })
  it('names each priced item that lacks a lead time or a weight above zero', () => {
    const m = missingQuoteDetails({
      currency: 'USD',
      prices: { a: 10, b: 20, c: 30, d: 40 },
      leadTime: '',
      leadTimes: { a: '2 weeks', b: '  ', c: 'ex-stock', d: '1 week' },
      inStock: null,
      extras: { a: kg(1.5), b: kg(2), c: kg(0), d: kg(null) },
    })
    expect(m).toEqual({ b: { leadTime: true, weight: false }, c: { leadTime: false, weight: true }, d: { leadTime: false, weight: true } })
  })
  it('asks nothing of an item with no price, a zero price or a cleared price', () => {
    expect(missingQuoteDetails({ currency: 'USD', prices: { a: null, b: 0, c: undefined }, leadTime: '', inStock: null })).toEqual({})
  })
  it("takes the row's lead time for an item without its own, and asks for the weight when no extras are held", () => {
    expect(missingQuoteDetails({ currency: 'USD', prices: { a: 10 }, leadTime: '3 weeks', inStock: null })).toEqual({ a: { leadTime: false, weight: true } })
  })
  it('asks an old saved line without them for both when it is saved again', () => {
    const d = draftFromLines([line('a', 10)], 'USD')
    expect(missingQuoteDetails(d)).toEqual({ a: { leadTime: true, weight: true } })
  })
  it('is empty when every priced item has both', () => {
    expect(missingQuoteDetails({ currency: 'USD', prices: { a: 10 }, leadTime: '', leadTimes: { a: '4 weeks' }, inStock: null, extras: { a: kg(0.25) } })).toEqual({})
  })
})
