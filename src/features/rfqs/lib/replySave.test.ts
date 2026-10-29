import { describe, expect, it } from 'vitest'
import { draftFromLines, isReplyDirty, planReplySave, type ExistingLine } from './replySave'

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
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 438 }])
    expect(p.removeItemIds).toEqual([])
    expect(p.leadTime).toBe('3 weeks')
    expect(p.inStock).toBe(true)
  })
  it('updates a line in place when the currency is unchanged', () => {
    const p = planReplySave([line('a', 400)], { currency: 'USD', prices: { a: 438 }, leadTime: '', inStock: null })
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 438 }])
    expect(p.removeItemIds).toEqual([])
    expect(p.leadTime).toBeNull()
  })
  it('removes and re-enters a line whose currency changed, so today\'s rate is captured', () => {
    const p = planReplySave([line('a', 400, 'USD')], { currency: 'EUR', prices: { a: 400 }, leadTime: '', inStock: null })
    expect(p.removeItemIds).toEqual(['a'])
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 400 }])
  })
  it('removes the line of a cleared price', () => {
    const p = planReplySave([line('a', 400), line('b', 5)], { currency: 'USD', prices: { a: null, b: 5 }, leadTime: '', inStock: null })
    expect(p.removeItemIds).toEqual(['a'])
    expect(p.prices).toEqual([{ itemId: 'b', unitPrice: 5 }])
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
    expect(isReplyDirty(existing, { ...base, leadTime: '3 weeks' })).toBe(true)
    expect(isReplyDirty(existing, { ...base, inStock: false })).toBe(true)
    expect(isReplyDirty(existing, { ...base, currency: 'EUR' })).toBe(true)
  })
  it('an empty row on a supplier with no lines is clean', () => {
    expect(isReplyDirty([], draftFromLines([], 'USD'))).toBe(false)
  })
})

describe('draftFromLines', () => {
  it('takes currency, lead time and stock from the saved lines, else the pre-fill', () => {
    expect(draftFromLines([], 'CNY')).toEqual({ currency: 'CNY', prices: {}, leadTime: '', inStock: null })
    const d = draftFromLines([line('a', 1, 'EUR', { leadTime: '4 weeks', inStock: false })], 'CNY')
    expect(d).toEqual({ currency: 'EUR', prices: { a: 1 }, leadTime: '4 weeks', inStock: false })
  })
})

describe('weight and origin (0111)', () => {
  const x = { weight: 2.5, weightUnit: 'kg' as const, origin: ' Germany ' }
  it('adds weight, unit and a trimmed origin to the planned price only when the draft holds them', () => {
    const p = planReplySave([], { currency: 'USD', prices: { a: 10, b: 20 }, leadTime: '', inStock: null, extras: { a: x } })
    expect(p.prices).toEqual([
      { itemId: 'a', unitPrice: 10, weight: 2.5, weightUnit: 'kg', origin: 'Germany' },
      { itemId: 'b', unitPrice: 20 },
    ])
  })
  it('writes a cleared weight and origin as null', () => {
    const p = planReplySave([], { currency: 'USD', prices: { a: 10 }, leadTime: '', inStock: null, extras: { a: { weight: 0, weightUnit: 'g', origin: '  ' } } })
    expect(p.prices).toEqual([{ itemId: 'a', unitPrice: 10, weight: null, weightUnit: 'g', origin: null }])
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
