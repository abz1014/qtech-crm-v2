import { describe, expect, it } from 'vitest'
import { COLS, COLS_NO_FINANCIAL, withoutFinancials } from '@/features/settings/companyProfile'

describe('company profile: what an engineer reads', () => {
  it('selects the business details only: no bank, tax, payment terms or quotation and purchase order wording', () => {
    const cols = COLS_NO_FINANCIAL.split(', ')
    expect(cols).toEqual(['legal_name', 'address', 'phone', 'email', 'website', 'sales_email', 'sales_phone', 'updated_at'])
    for (const c of ['ntn', 'strn', 'bank_iban', 'quotation_terms', 'quotation_warranty', 'quotation_closing', 'quote_next_number', 'po_terms', 'default_payment_terms_days', 'quotation_validity_days']) {
      expect(COLS).toContain(c)
      expect(cols).not.toContain(c)
    }
  })

  it('completes the row with nulls and the database defaults, so shared code still has the full shape', () => {
    const row = withoutFinancials({ legal_name: 'Q-Tech', address: 'Karachi', updated_at: '2026-11-15T00:00:00Z' })
    expect(row).toMatchObject({ legal_name: 'Q-Tech', quotation_terms: null, po_terms: null, bank_iban: null, quotation_validity_days: 30, default_payment_terms_days: 30 })
  })
})
