// Ported from src/lib/gst/fbr.test.ts @ 7a29f3a (Q-Tech CRM v1). Rewritten for v2 derived states, exception rule and legacy flag.
import { describe, it, expect } from 'vitest'
import { fbrState, fbrException, needsFbrAttention, type FbrInvoice } from '@/lib/fbr'

const inv = (o: Partial<FbrInvoice> = {}): FbrInvoice => ({
  invoice_date: '2026-05-10',
  psid: null,
  wasif_receipt_on: null,
  tax_deposited_on: null,
  legacy_flags: [],
  ...o,
})
const TODAY = '2026-07-15'
const LEGACY = ['fbr_generated_legacy']

describe('fbrState', () => {
  it('pending with nothing set', () => expect(fbrState(inv())).toBe('pending'))
  it('generated with psid', () => expect(fbrState(inv({ psid: 'P1' }))).toBe('generated'))
  it('generated with legacy flag only', () =>
    expect(fbrState(inv({ legacy_flags: LEGACY }))).toBe('generated'))
  it('ignores unrelated legacy flags', () =>
    expect(fbrState(inv({ legacy_flags: ['other'] }))).toBe('pending'))
  it('receipt_received with receipt date', () =>
    expect(fbrState(inv({ psid: 'P1', wasif_receipt_on: '2026-06-01' }))).toBe('receipt_received'))
  it('deposited is furthest', () =>
    expect(
      fbrState(inv({ psid: 'P1', wasif_receipt_on: '2026-06-01', tax_deposited_on: '2026-06-05' })),
    ).toBe('deposited'))
  it('deposited even with no earlier steps', () =>
    expect(fbrState(inv({ tax_deposited_on: '2026-06-05' }))).toBe('deposited'))
  it('treats null legacy_flags safely', () =>
    expect(fbrState(inv({ legacy_flags: null }))).toBe('pending'))
})

describe('fbrException', () => {
  it('false for a clean progression', () => {
    expect(fbrException(inv())).toBe(false)
    expect(fbrException(inv({ psid: 'P1' }))).toBe(false)
    expect(fbrException(inv({ psid: 'P1', wasif_receipt_on: '2026-06-01' }))).toBe(false)
    expect(
      fbrException(inv({ psid: 'P1', wasif_receipt_on: '2026-06-01', tax_deposited_on: '2026-06-05' })),
    ).toBe(false)
  })
  it('true for deposited with no psid and no legacy flag', () =>
    expect(fbrException(inv({ tax_deposited_on: '2026-06-05' }))).toBe(true))
  it('true for deposited without receipt', () =>
    expect(fbrException(inv({ psid: 'P1', tax_deposited_on: '2026-06-05' }))).toBe(true))
  it('true for receipt without psid or legacy flag', () =>
    expect(fbrException(inv({ wasif_receipt_on: '2026-06-01' }))).toBe(true))
  it('legacy flag satisfies the generated step', () =>
    expect(
      fbrException(
        inv({ legacy_flags: LEGACY, wasif_receipt_on: '2026-06-01', tax_deposited_on: '2026-06-05' }),
      ),
    ).toBe(false))
})

describe('needsFbrAttention', () => {
  it('flags a prior-month invoice that is not deposited', () => {
    expect(needsFbrAttention(inv({ invoice_date: '2026-05-10' }), TODAY)).toBe(true)
    expect(needsFbrAttention(inv({ invoice_date: '2025-12-01' }), TODAY)).toBe(true)
  })
  it('never flags a deposited invoice, however old', () =>
    expect(needsFbrAttention(inv({ invoice_date: '2024-01-01', tax_deposited_on: '2024-02-01' }), TODAY)).toBe(false))
  it('does not flag current month or future', () => {
    expect(needsFbrAttention(inv({ invoice_date: '2026-07-01' }), TODAY)).toBe(false)
    expect(needsFbrAttention(inv({ invoice_date: '2026-08-15' }), TODAY)).toBe(false)
  })
  it('month boundaries', () => {
    expect(needsFbrAttention(inv({ invoice_date: '2026-06-30' }), '2026-07-01')).toBe(true)
    expect(needsFbrAttention(inv({ invoice_date: '2026-07-01' }), '2026-07-01')).toBe(false)
    expect(needsFbrAttention(inv({ invoice_date: '2025-12-31' }), '2026-01-01')).toBe(true)
    expect(needsFbrAttention(inv({ invoice_date: '2026-07-31' }), '2026-07-31')).toBe(false)
  })
  it('does not flag when there is no invoice date', () =>
    expect(needsFbrAttention(inv({ invoice_date: '' }), TODAY)).toBe(false))
  it('defaults today to the Karachi business date', () =>
    expect(needsFbrAttention(inv({ invoice_date: '1999-01-01' }))).toBe(true))
})
