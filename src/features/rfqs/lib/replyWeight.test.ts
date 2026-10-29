import { describe, expect, it } from 'vitest'
import { parseSupplierReply, weightUnitOf, type ReplyItemRef } from './replyParse'

// Synthetic replies only. Weight is the weight of ONE unit; origin is where it is made (0111).
const ITEMS: ReplyItemRef[] = [
  { id: 'i1', description: 'Siemens SITRANS P320 pressure transmitter 0-10 bar 4-20mA', qty: 4 },
  { id: 'i2', description: 'Endress+Hauser Promag 400 electromagnetic flow meter DN50', qty: 2 },
]
const offer = (text: string, id = 'i1') => {
  const r = parseSupplierReply(text, ITEMS)
  const o = r.offers.find(x => x.rfqItemId === id)
  expect(o, `offer for ${id}`).toBeDefined()
  return o!
}

describe('weightUnitOf', () => {
  it.each([
    ['kg', 'kg'],
    ['KGS', 'kg'],
    ['kilos', 'kg'],
    ['g', 'g'],
    ['gm', 'g'],
    ['grams', 'g'],
    ['lb', 'lb'],
    ['lbs', 'lb'],
    ['pounds', 'lb'],
  ])('%s is %s', (text, unit) => expect(weightUnitOf(text)).toBe(unit))
  it('knows nothing else', () => {
    expect(weightUnitOf('bar')).toBeNull()
    expect(weightUnitOf('mm')).toBeNull()
  })
})

describe('reply weight and origin', () => {
  it('reads "net wt" and "country of origin" from an item line', () => {
    const o = offer('Item 1: SITRANS P320 pressure transmitter USD 412.50 each, 3-4 weeks, net wt 2.5 kg, country of origin Germany')
    expect(o).toMatchObject({ unitPrice: 412.5, currency: 'USD', weight: 2.5, weightUnit: 'kg', origin: 'Germany' })
  })
  it('reads "weight:" in grams and does not take it for the price', () => {
    const o = offer('1) SITRANS P320 pressure transmitter - USD 410 - weight: 400 g - made in Italy')
    expect(o).toMatchObject({ unitPrice: 410, weight: 400, weightUnit: 'g', origin: 'Italy' })
  })
  it('reads pounds, with a thousands comma', () => {
    const o = offer('Item 2: Promag 400 flow meter EUR 1850, gross weight 1,200 lbs', 'i2')
    expect(o).toMatchObject({ unitPrice: 1850, currency: 'EUR', weight: 1200, weightUnit: 'lb' })
  })
  it('prefers the net weight to the gross weight when both are given', () => {
    const o = offer('Item 1: SITRANS P320 transmitter USD 399 gross wt 3.2 kg, net wt 2.4 kg')
    expect(o).toMatchObject({ weight: 2.4, weightUnit: 'kg' })
  })
  it('uses the gross weight when it is the only one', () => {
    const o = offer('Item 1: SITRANS P320 transmitter USD 399 gross wt 3.2 kg')
    expect(o).toMatchObject({ weight: 3.2, weightUnit: 'kg' })
  })
  it('leaves weight empty when the reply gives none', () => {
    const o = offer('Item 1: SITRANS P320 transmitter USD 399, 4 weeks')
    expect(o.weight).toBeNull()
    expect(o.weightUnit).toBeNull()
  })
  it('reads a weight column of a table, with the unit from the heading', () => {
    const text = ['Item | Qty | Unit price USD | Weight (kg) | Origin', 'SITRANS P320 pressure transmitter 0-10 bar | 4 | 412.50 | 2.5 | Germany'].join('\n')
    const o = offer(text)
    expect(o).toMatchObject({ unitPrice: 412.5, weight: 2.5, weightUnit: 'kg', origin: 'Germany' })
  })
  it('reads a weight cell that carries its own unit', () => {
    const text = ['Item | Qty | Price USD | Weight | Origin', 'SITRANS P320 pressure transmitter 0-10 bar | 4 | 412.50 | 900 g | Italy'].join('\n')
    const o = offer(text)
    expect(o).toMatchObject({ unitPrice: 412.5, weight: 900, weightUnit: 'g', origin: 'Italy' })
  })
})
