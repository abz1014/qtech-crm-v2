import { afterEach, describe, expect, it } from 'vitest'
import { applyIssueDraft, clearIssueDraft, readIssueDraft, writeIssueDraft, type IssueDraft } from '@/features/quotations/lib/issueDraft'

const DEFAULTS: IssueDraft = {
  prices: { a: 100, b: null },
  included: { a: true, b: false },
  rateOf: { a: '18', b: '18' },
  leads: { a: '', b: '' },
  validUntil: '2026-11-21',
  contactId: 'k1',
  delivery: 'To site',
  payment: '',
  terms: 'Standard',
}

afterEach(() => window.sessionStorage.clear())

describe('Issue quotation draft (HW-9)', () => {
  it('round-trips per RFQ and is cleared', () => {
    const d = { ...DEFAULTS, prices: { a: 125000, b: 7 } }
    writeIssueDraft('r1', d)
    expect(readIssueDraft('r1')).toEqual(d)
    expect(readIssueDraft('r2')).toBeNull()
    clearIssueDraft('r1')
    expect(readIssueDraft('r1')).toBeNull()
  })

  it('ignores junk in storage', () => {
    window.sessionStorage.setItem('qtech.issueDraft.r1', '{not json')
    expect(readIssueDraft('r1')).toBeNull()
    window.sessionStorage.setItem('qtech.issueDraft.r1', JSON.stringify({ prices: { a: 'x' }, included: {}, rateOf: { a: '7' }, leads: {} }))
    expect(readIssueDraft('r1')?.prices).toEqual({})
    expect(readIssueDraft('r1')?.rateOf).toEqual({})
  })

  it('lays the draft over the defaults for the items still on the RFQ only', () => {
    const draft: IssueDraft = { ...DEFAULTS, prices: { a: 900, gone: 5 }, included: { b: true }, validUntil: '', delivery: '' }
    const out = applyIssueDraft(DEFAULTS, draft, ['a', 'b'])
    expect(out.prices).toEqual({ a: 900, b: null })
    expect(out.included).toEqual({ a: true, b: true })
    expect(out.validUntil).toBe('2026-11-21')
    expect(out.delivery).toBe('')
    expect(applyIssueDraft(DEFAULTS, null, ['a', 'b'])).toBe(DEFAULTS)
  })
})
