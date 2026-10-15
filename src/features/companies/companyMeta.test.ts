import { describe, expect, it } from 'vitest'
import { companyMeta, type MetaInput } from '@/features/companies/companyMeta'

const base: MetaInput = {
  country: 'Austria',
  isSupplier: true,
  isCustomer: false,
  legacyImported: false,
  createdAt: '2026-10-14T08:00:00Z',
  lowData: false,
  currency: 'EUR',
  sinceYear: 2023,
  counts: null,
}

describe('companyMeta (g2-company: the line under the name)', () => {
  it('supplier with history: place, quotes in, supplier since', () => {
    expect(companyMeta({ ...base, city: 'Linz' })).toEqual(['Linz, Austria', 'Quotes in EUR', 'Supplier since 2023'])
  })
  it('falls back to the country alone when there is no city', () => {
    expect(companyMeta(base)[0]).toBe('Austria')
  })
  it('low data says when it was added instead of a "since" year', () => {
    expect(companyMeta({ ...base, country: 'China', currency: 'CNY', lowData: true })).toEqual(['China', 'Quotes in CNY', 'Added Oct 2026'])
  })
  it('imported only says so', () => {
    expect(companyMeta({ ...base, country: 'Pakistan', currency: 'PKR', legacyImported: true })).toEqual(['Pakistan', 'Quotes in PKR', 'Imported from the old CRM'])
  })
  it('leaves out "Quotes in" until a currency is known', () => {
    expect(companyMeta({ ...base, currency: null })).toEqual(['Austria', 'Supplier since 2023'])
  })
  it('customer: place and counts, never "Added"', () => {
    expect(companyMeta({ ...base, country: 'Pakistan', city: 'Karachi', isSupplier: false, isCustomer: true, counts: { sites: 3, rfqs: 3, orders: 1 } })).toEqual([
      'Karachi, Pakistan',
      '3 sites · 3 RFQs · 1 order',
    ])
  })
  it('a company that is both shows the supplier line and the customer counts', () => {
    expect(companyMeta({ ...base, isCustomer: true, counts: { sites: 1, rfqs: 2, orders: 0 } }).slice(-1)).toEqual(['1 site · 2 RFQs · 0 orders'])
  })
})
