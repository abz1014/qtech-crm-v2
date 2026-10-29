import { describe, expect, it } from 'vitest'
import type { InquiryRow, QuoteLineRow, RfqItemRow } from '@/features/rfqs/api'
import { buildStatement, costText, DEFAULT_SORT, plainNumber, sortRows } from './model'

// Synthetic data only.
const item = (id: string, number: number, qty: number, unit: string | null = 'pcs'): RfqItemRow => ({
  id,
  number,
  description: `Item ${number} description`,
  brandId: null,
  brandName: null,
  familyId: null,
  qty,
  unit,
})
const line = (inquiryId: string, itemId: string, unitPrice: number, currency: string, over: Partial<QuoteLineRow> = {}): QuoteLineRow => ({
  id: `${inquiryId}-${itemId}`,
  inquiryId,
  itemId,
  unitPrice,
  currency,
  leadTime: null,
  inStock: null,
  fxRatePkr: null,
  fxRateOn: null,
  weight: null,
  weightUnit: 'kg',
  origin: null,
  notes: null,
  ...over,
})
const inquiry = (id: string, name: string, lines: QuoteLineRow[], over: Partial<InquiryRow> = {}): InquiryRow =>
  ({
    id,
    supplierId: `s-${id}`,
    supplierName: name,
    supplierCountry: null,
    sentOn: '2026-10-20',
    noOfferOn: null,
    noOfferReason: null,
    itemDeclines: {},
    lines,
    ...over,
  }) as unknown as InquiryRow

const ITEMS = [item('i1', 1, 4), item('i2', 2, 2.5, 'm')]
const ZED = inquiry('z', 'Zed Controls', [
  line('z', 'i1', 100, 'USD', { leadTime: '3 weeks', weight: 2.5, weightUnit: 'kg', origin: 'Germany' }),
  line('z', 'i2', 40, 'USD', { leadTime: 'ex-stock' }),
])
const ALPHA = inquiry('a', 'alpha Instruments', [line('a', 'i1', 9000, 'PKR', { leadTime: '10 days', weight: 400, weightUnit: 'g', origin: 'China', notes: 'valid 7 days' })])
const MID = inquiry('m', 'Mid Supply', [line('m', 'i1', 95.5, 'EUR', { leadTime: '6 weeks', weight: 6, weightUnit: 'lb' })])

describe('number text', () => {
  it('shows at least 2 and at most 4 decimals, grouped', () => {
    expect(costText(412.5)).toBe('412.50')
    expect(costText(0.0125)).toBe('0.0125')
    expect(costText(1650)).toBe('1,650.00')
    expect(costText(12345.6789)).toBe('12,345.6789')
  })
  it('shows a quantity or weight without trailing zeros', () => {
    expect(plainNumber(2.5)).toBe('2.5')
    expect(plainNumber(400)).toBe('400')
    expect(plainNumber(1200)).toBe('1,200')
  })
})

describe('buildStatement', () => {
  it('has one section per item, in the RFQ order, with a row per supplier that quoted it', () => {
    const s = buildStatement(ITEMS, [ZED, ALPHA, MID])
    expect(s.sections.map(x => x.item.id)).toEqual(['i1', 'i2'])
    expect(s.sections[0].rows).toHaveLength(3)
    expect(s.sections[1].rows.map(r => r.supplierName)).toEqual(['Zed Controls'])
    expect(s.sections[0].quantityText).toBe('4 pcs')
    expect(s.sections[1].quantityText).toBe('2.5 m')
  })

  it('orders the suppliers by name, ignoring case, and never by price', () => {
    const s = buildStatement(ITEMS, [ZED, MID, ALPHA])
    expect(s.sections[0].rows.map(r => r.supplierName)).toEqual(['alpha Instruments', 'Mid Supply', 'Zed Controls'])
  })

  it('selects nothing: a row carries no rank, mark, recommendation or ticked flag', () => {
    const s = buildStatement(ITEMS, [ZED, ALPHA, MID])
    for (const sec of s.sections) {
      for (const r of sec.rows) {
        expect(Object.keys(r).filter(k => /rank|best|cheap|lowest|recommend|select|chosen|winner|pick/i.test(k))).toEqual([])
      }
    }
  })

  it('works out the line total as quantity x unit cost, exactly', () => {
    const s = buildStatement([item('i1', 1, 3)], [inquiry('x', 'X', [line('x', 'i1', 1.005, 'USD')])])
    expect(s.sections[0].rows[0].totalText).toBe('3.02') // 3 x 1.005 = 3.015, half away from zero, as the database rounds it
    const t = buildStatement(ITEMS, [ZED])
    expect(t.sections[0].rows[0].totalText).toBe('400.00')
    expect(t.sections[1].rows[0].totalText).toBe('100.00') // 2.5 x 40
  })

  it('shows the weight of one unit and of the whole quantity in the supplier\'s unit, and the origin and lead time', () => {
    const s = buildStatement(ITEMS, [ZED, ALPHA])
    const zed = s.sections[0].rows.find(r => r.supplierName === 'Zed Controls')!
    expect(zed).toMatchObject({ weightEachText: '2.5 kg', weightTotalText: '10 kg', origin: 'Germany', leadTime: '3 weeks', unitCostText: '100.00' })
    const alpha = s.sections[0].rows.find(r => r.supplierName.startsWith('alpha'))!
    expect(alpha).toMatchObject({ weightEachText: '400 g', weightTotalText: '1,600 g', note: 'valid 7 days' })
    const noWeight = s.sections[1].rows[0]
    expect(noWeight.weightEachText).toBeNull()
    expect(noWeight.origin).toBeNull()
  })

  it('totals per supplier and per currency and never adds currencies together', () => {
    const mixed = inquiry('q', 'Mixed Co', [line('q', 'i1', 10, 'USD'), line('q', 'i2', 20, 'EUR')])
    const s = buildStatement(ITEMS, [ZED, ALPHA, mixed])
    const byName = Object.fromEntries(s.totals.map(t => [t.supplierName, t]))
    expect(byName['Zed Controls'].byCurrency).toEqual([{ currency: 'USD', totalMinor: 50000n, totalText: '500.00' }]) // 4 x 100 + 2.5 x 40
    expect(byName['Zed Controls']).toMatchObject({ itemsQuoted: 2, itemCount: 2 })
    expect(byName['Mixed Co'].byCurrency.map(c => c.currency)).toEqual(['EUR', 'USD'])
    expect(byName['Mixed Co'].byCurrency.map(c => c.totalText)).toEqual(['50.00', '40.00'])
    expect(byName['alpha Instruments']).toMatchObject({ itemsQuoted: 1, itemCount: 2 })
    expect(s.totals.map(t => t.supplierName)).toEqual(['alpha Instruments', 'Mixed Co', 'Zed Controls'])
  })

  it('lists suppliers with no reply only when asked to', () => {
    const silent = inquiry('n', 'Silent Ltd', [])
    const cant = inquiry('c', 'Cant Ltd', [], { noOfferOn: '2026-10-22', noOfferReason: 'no_brand' })
    const partial = inquiry('p', 'Partial Ltd', [line('p', 'i1', 5, 'USD')], { itemDeclines: { i2: 'discontinued' } })
    const shortlisted = inquiry('s', 'Shortlist Ltd', [], { sentOn: null })
    const all = [ZED, silent, cant, partial, shortlisted]
    expect(buildStatement(ITEMS, all).sections[0].noQuote).toEqual([])
    const s = buildStatement(ITEMS, all, { showNoReply: true })
    expect(s.sections[0].noQuote.map(r => [r.supplierName, r.reason])).toEqual([
      ['Cant Ltd', "Can't quote: Doesn't carry this brand"],
      ['Silent Ltd', 'No reply'],
    ])
    expect(s.sections[1].noQuote.map(r => [r.supplierName, r.reason])).toEqual([
      ['Cant Ltd', "Can't quote: Doesn't carry this brand"],
      ['Partial Ltd', "Can't quote: Item discontinued"],
      ['Silent Ltd', 'No reply'],
    ])
    expect(s.noReplyCount).toBe(2)
    // a supplier with no price has no totals row
    expect(s.totals.map(t => t.supplierName)).toEqual(['Partial Ltd', 'Zed Controls'])
  })
})

describe('sortRows (only when a person asks)', () => {
  const rows = buildStatement(ITEMS, [ZED, ALPHA, MID]).sections[0].rows
  it('starts on the supplier name', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'supplier', dir: 'asc' })
    expect(sortRows(rows).map(r => r.supplierName)).toEqual(['alpha Instruments', 'Mid Supply', 'Zed Controls'])
    expect(sortRows(rows, { key: 'supplier', dir: 'desc' }).map(r => r.supplierName)).toEqual(['Zed Controls', 'Mid Supply', 'alpha Instruments'])
  })
  it('sorts a cost column within each currency, never across currencies', () => {
    expect(sortRows(rows, { key: 'unit', dir: 'asc' }).map(r => r.currency)).toEqual(['EUR', 'PKR', 'USD'])
  })
  it('sorts by lead time in days, blanks last', () => {
    const withBlank = [...rows, { ...rows[0], supplierName: 'Blank Ltd', leadTime: null, leadDays: null }]
    expect(sortRows(withBlank, { key: 'lead', dir: 'asc' }).map(r => r.supplierName)).toEqual(['alpha Instruments', 'Zed Controls', 'Mid Supply', 'Blank Ltd'])
    expect(sortRows(withBlank, { key: 'lead', dir: 'desc' }).map(r => r.supplierName).at(-1)).toBe('Blank Ltd')
  })
  it('sorts weights in a common unit', () => {
    // 400 g < 2.5 kg < 6 lb (2.72 kg)
    expect(sortRows(rows, { key: 'weight', dir: 'asc' }).map(r => r.supplierName)).toEqual(['alpha Instruments', 'Zed Controls', 'Mid Supply'])
  })
})
