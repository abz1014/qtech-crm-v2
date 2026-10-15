import { describe, expect, it } from 'vitest'
import type { SupplierStats } from '@/features/companies/api'
import { supplierFacts } from '@/features/companies/supplierFacts'

const base: SupplierStats = {
  supplier_id: 's',
  asked: 0,
  replied: 0,
  no_offer: 0,
  quoted: 0,
  legacy_asked: 0,
  reply_days_n: 0,
  median_reply_days: null,
  chosen_of: 0,
  chosen: 0,
  deliveries: 0,
  late: 0,
  median_days_late: null,
  last_contact: null,
  brand_ids: [],
  brand_names: [],
  prices_hidden: 0,
}

describe('supplierFacts (5c display rules)', () => {
  it('has nothing to say without a stats row', () => {
    expect(supplierFacts(null)).toBeNull()
  })

  it('states raw facts below three enquiries, with no pattern implied', () => {
    const f = supplierFacts({ ...base, asked: 2, replied: 1, quoted: 1 })!
    expect(f.enquirySummary).toBe('Asked twice · 1 reply')
    expect(f.lowData).toBe(true)
    expect(f.replyTime).toEqual({ kind: 'withheld', logged: 0, importedOnly: false })
  })

  it('shows every rate with its counts from three enquiries up', () => {
    const f = supplierFacts({ ...base, asked: 6, replied: 5, quoted: 4, no_offer: 1, reply_days_n: 3, median_reply_days: 2 })!
    expect(f.enquirySummary).toBe("Asked 6 · replied 5 of 6 · couldn't offer 1 of 6")
    expect(f.waiting).toBe(1)
    expect(f.replyTime).toEqual({ kind: 'known', days: 2, logged: 3, importedLeftOut: 2 })
  })

  it('withholds reply time for imported-only history and says so', () => {
    const f = supplierFacts({ ...base, asked: 8, replied: 7, quoted: 6, no_offer: 1, legacy_asked: 8, reply_days_n: 0 })!
    expect(f.replyTime).toEqual({ kind: 'withheld', logged: 0, importedOnly: true })
    expect(f.provenance.importedOnly).toBe(true)
  })

  it('shows chosen only when an item was ordered, and deliveries only when dates exist', () => {
    expect(supplierFacts(base)!.chosen).toEqual({ kind: 'none' })
    expect(supplierFacts(base)!.deliveries).toEqual({ kind: 'none' })
    const f = supplierFacts({ ...base, chosen_of: 3, chosen: 2, deliveries: 4, late: 1 })!
    expect(f.chosen).toEqual({ kind: 'known', chosen: 2, of: 3 })
    expect(f.deliveries).toEqual({ kind: 'known', total: 4, late: 1, medianDaysLate: null })
  })

  it('is empty only when nothing at all is recorded', () => {
    expect(supplierFacts(base)!.empty).toBe(true)
    expect(supplierFacts({ ...base, last_contact: '2026-11-24' })!.empty).toBe(false)
  })

  it('exposes no score', () => {
    const f = supplierFacts({ ...base, asked: 6, replied: 5 })!
    expect(Object.keys(f).join()).not.toMatch(/score|rank|rating|percent/i)
  })
})
