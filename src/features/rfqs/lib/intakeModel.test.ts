import { describe, expect, it } from 'vitest'
import {
  copyText,
  effectiveQty,
  fillRfqRef,
  itemsWithoutSupplier,
  qtyTooLarge,
  realItems,
  RFQ_REF_PLACEHOLDER,
  tickedIds,
  toEnquiryItems,
  toFloatItems,
  type DraftItem,
} from './intakeModel'
import { suggestSuppliers, type SupplierSuggestion } from './supplierSuggestion'
import type { BrandRef } from './parseItems'

const row = (key: string, over: Partial<DraftItem> = {}): DraftItem => ({
  key,
  description: `Item ${key}`,
  qty: null,
  unit: '',
  brandId: null,
  familyId: null,
  ...over,
})

describe('float payload (FE-2: qty defaults to 1, gst_rate to 18, nothing else is required)', () => {
  it('fills the defaults and sends only what the person gave', () => {
    const out = toFloatItems([row('a'), row('b', { qty: 4, unit: ' nos ', brandId: 'b1', familyId: 'f1' })])
    expect(out).toEqual([
      { description: 'Item a', qty: 1, gst_rate: 18 },
      { description: 'Item b', qty: 4, unit: 'nos', brand_id: 'b1', family_id: 'f1', gst_rate: 18 },
    ])
  })

  it('ignores a blank row instead of failing the save', () => {
    expect(realItems([row('a'), row('b', { description: '   ' })])).toHaveLength(1)
    expect(toFloatItems([row('b', { description: '' })])).toEqual([])
  })

  it('reads an empty, zero or negative quantity as 1', () => {
    expect(effectiveQty(row('a', { qty: null }))).toBe(1)
    expect(effectiveQty(row('a', { qty: 0 }))).toBe(1)
    expect(effectiveQty(row('a', { qty: -2 }))).toBe(1)
    expect(effectiveQty(row('a', { qty: 2.5 }))).toBe(2.5)
  })
})

describe('enquiry items never carry a spec', () => {
  it('Spec stays null so the draft says "left blank"', () => {
    const brands: BrandRef[] = [{ id: 'b1', name: 'Hach', kind: 'brand' }]
    const [it] = toEnquiryItems([row('a', { description: 'HQ1110 meter', brandId: 'b1', qty: 1 })], brands)
    expect(it.spec).toBeNull()
    expect(it.brandName).toBe('Hach')
  })
})

describe('ticks and the item with no supplier', () => {
  const items = [
    { id: 'i1', description: 'Hach HQ1110', brandId: 'b-hach', brandName: 'Hach', familyId: null },
    { id: 'i2', description: 'Actuator', brandId: null, familyId: 'f-act', familyName: 'Actuator' },
  ]
  const result = suggestSuppliers(
    items,
    {
      suppliers: [
        { id: 'sOrient', name: 'Orient', stats: { supplier_id: 'sOrient', asked: 8, replied: 7, median_reply_days: 1, last_contact: '2026-11-03', brand_ids: ['b-hach'] } },
        { id: 'sKarachi', name: 'Karachi Valve', stats: { supplier_id: 'sKarachi', asked: 0, replied: 0, median_reply_days: null, last_contact: null, brand_ids: ['f-act'] } },
        { id: 'sLahore', name: 'Lahore Flow', stats: { supplier_id: 'sLahore', asked: 2, replied: 1, median_reply_days: null, last_contact: '2026-06-19', brand_ids: ['b-hach'] } },
      ],
      memory: { i1: [{ supplier_id: 'sOrient', best_tier: 0, supplied_before: true }] },
    },
    { today: '2026-11-27' },
  )
  const s: readonly SupplierSuggestion[] = result.suppliers

  it('only "supplied this item before" starts ticked', () => {
    expect(tickedIds(s, {})).toEqual(['sOrient'])
  })

  it('a hand tick adds a supplier and a hand untick removes a pre-ticked one', () => {
    expect(tickedIds(s, { sLahore: true }).sort()).toEqual(['sLahore', 'sOrient'])
    expect(tickedIds(s, { sOrient: false })).toEqual([])
  })

  it('a supplier added by hand is ticked until the person unticks it', () => {
    expect(tickedIds(s, {}, ['sX'])).toEqual(['sOrient', 'sX'])
    expect(tickedIds(s, { sX: false }, ['sX'])).toEqual(['sOrient'])
  })

  it('flags the item that no ticked supplier is asked about, and clears it when one is ticked', () => {
    expect(itemsWithoutSupplier(['i1', 'i2'], s, ['sOrient'])).toEqual(['i2'])
    expect(itemsWithoutSupplier(['i1', 'i2'], s, ['sOrient', 'sKarachi'])).toEqual([])
  })

  it('with nothing ticked every item is flagged; a hand-added supplier counts for all items', () => {
    expect(itemsWithoutSupplier(['i1', 'i2'], s, [])).toEqual(['i1', 'i2'])
    expect(itemsWithoutSupplier(['i1', 'i2'], s, ['sX'], ['sX'])).toEqual([])
  })
})

describe('the RFQ number placeholder', () => {
  it('is replaced everywhere in the text at copy time', () => {
    const body = `our ref ${RFQ_REF_PLACEHOLDER}.\nPlease quote ${RFQ_REF_PLACEHOLDER}`
    expect(fillRfqRef(body, 'RFQ-0185')).toBe('our ref RFQ-0185.\nPlease quote RFQ-0185')
  })

  it('an email copies its subject first', () => {
    const t = copyText({ subject: `${RFQ_REF_PLACEHOLDER}: quotation requested`, body: `ref ${RFQ_REF_PLACEHOLDER}` }, 'RFQ-0185')
    expect(t).toBe('Subject: RFQ-0185: quotation requested\n\nref RFQ-0185')
    expect(copyText({ subject: null, body: 'hi' }, 'RFQ-1')).toBe('hi')
  })
})

describe('a quantity too large for the database (HE-11)', () => {
  const it2 = (description: string, qty: number | null): DraftItem => ({ key: description, description, qty, unit: '', brandId: null, familyId: null })
  it('names the first row whose quantity does not fit numeric(12,3)', () => {
    const r = qtyTooLarge([it2('Valve', 2), it2('', 9e12), it2('Pressure gauge', 9_999_999_999)])
    expect(r?.row).toBe(3)
    expect(r?.message).toMatch(/^Item 3: the quantity is too large \(most 999,999,999\)/)
  })
  it('lets the largest quantity that fits through', () => {
    expect(qtyTooLarge([it2('Cable', 999_999_999), it2('Wire', null)])).toBeNull()
  })
})
