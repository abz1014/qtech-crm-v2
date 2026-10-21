import { describe, expect, it } from 'vitest'
import type { SupplierStats } from '@/features/companies/api'
import { chosenText, deliveryLine, factNotes, recordLine, supplierFacts } from '@/features/companies/supplierFacts'

const base: SupplierStats = {
  supplier_id: 's',
  asked: 0,
  replied: 0,
  no_offer: 0,
  quoted: 0,
  legacy_asked: 0,
  orders_count: 0,
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
    expect(f.enquirySummary).toBe("Replied 5 of 6 · quoted 4 · couldn't offer 1")
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

  it('never says "Nothing ordered yet" while there are orders with them (a PO issued on an order with no RFQ item behind it)', () => {
    // audit seed: Dubai Instrumentation has ORD-0011 with PO-26-0004 issued, ORD-0003 and ORD-0005, none made from one of their quotes
    const f = supplierFacts({ ...base, asked: 4, replied: 4, quoted: 4, chosen_of: 0, chosen: 0, orders_count: 3 })!
    expect(f.chosen).toEqual({ kind: 'orders', orders: 3 })
    expect(chosenText(f)).toBe('3 orders with them')
    expect(factNotes(f, null)).toContain('Ordered: 3 orders with them, none traced back to one of their quotes.')
    expect(chosenText(supplierFacts({ ...base, orders_count: 1 })!)).toBe('1 order with them')
    // traced quotes win: "2 of 3 quoted items"
    expect(chosenText(supplierFacts({ ...base, chosen_of: 3, chosen: 2, orders_count: 5 })!)).toBe('2 of 3 quoted items')
    // truly nothing: no traced quote and no supplier order
    expect(chosenText(supplierFacts(base)!)).toBe('Nothing ordered yet')
  })

  it('is empty only when nothing at all is recorded', () => {
    expect(supplierFacts(base)!.empty).toBe(true)
    expect(supplierFacts({ ...base, last_contact: '2026-11-24' })!.empty).toBe(false)
  })

  it('exposes no score', () => {
    const f = supplierFacts({ ...base, asked: 6, replied: 5 })!
    expect(Object.keys(f).join()).not.toMatch(/score|rank|rating|percent/i)
  })

  it('says "No enquiries yet" rather than "Asked no times"', () => {
    expect(supplierFacts({ ...base, deliveries: 1 })!.enquirySummary).toBe('No enquiries yet')
  })
})

describe('recordLine (the counts in the page header)', () => {
  it('reads replied, quoted and late, with their counts', () => {
    expect(recordLine(supplierFacts({ ...base, asked: 6, replied: 5, quoted: 4, no_offer: 1, deliveries: 4, late: 1 })!)).toBe('Replied 5 of 6 · quoted 4 · late 1 of 4')
  })
  it('states the raw fact below three enquiries', () => {
    expect(recordLine(supplierFacts({ ...base, asked: 1 })!)).toBe('Asked once · no replies')
  })
  it('folds the usual reply time and the order count in (the "What we know" panel is gone)', () => {
    expect(
      recordLine(supplierFacts({ ...base, asked: 4, replied: 4, quoted: 4, reply_days_n: 4, median_reply_days: 9, orders_count: 3, deliveries: 2, late: 2 })!),
    ).toBe('Replied 4 of 4 in about 9 days · quoted 4 · 3 orders · late 2 of 2')
    expect(recordLine(supplierFacts({ ...base, orders_count: 1 })!)).toBe('1 order')
  })
  it('deliveries alone start with a capital', () => {
    expect(recordLine(supplierFacts({ ...base, deliveries: 2, late: 0 })!)).toBe('Late 0 of 2')
  })
  it('is null with nothing recorded', () => {
    expect(recordLine(supplierFacts(base)!)).toBeNull()
  })
  it('has no percentages', () => {
    expect(recordLine(supplierFacts({ ...base, asked: 9, replied: 9, quoted: 9, deliveries: 9 })!)).not.toMatch(/%/)
  })
})

describe('deliveryLine', () => {
  it('says late of total and how far over, when known', () => {
    expect(deliveryLine(supplierFacts({ ...base, deliveries: 4, late: 1, median_days_late: 6.4 })!)).toBe('Late 1 of 4 · about 6 days over')
    expect(deliveryLine(supplierFacts({ ...base, deliveries: 3, late: 0, median_days_late: null })!)).toBe('Late 0 of 3')
    expect(deliveryLine(supplierFacts(base)!)).toBe('None recorded yet')
  })
  it('marks imported-only dates as estimated', () => {
    expect(deliveryLine(supplierFacts({ ...base, asked: 4, legacy_asked: 4, deliveries: 2, late: 1 })!)).toBe('Late 1 of 2 · dates estimated')
  })
})

describe('factNotes (the rules behind "What we know", shown in its (i) tip)', () => {
  it('own history: where it comes from, the reply-time rule and what Chosen means', () => {
    const f = supplierFacts({ ...base, asked: 6, replied: 5, quoted: 4, reply_days_n: 5, median_reply_days: 3, chosen_of: 4, chosen: 2 })!
    expect(factNotes(f, null)).toEqual([
      'Counted from enquiries, quotes, POs and delivery dates. Nothing is typed in.',
      'Reply time is the middle of the 5 replies logged here.',
      'Chosen: 2 of 4 quoted items were later ordered from them.',
    ])
  })
  it('mixed history: how much was imported, hidden prices and replies left out', () => {
    const f = supplierFacts({ ...base, asked: 6, replied: 5, quoted: 4, legacy_asked: 3, reply_days_n: 3, median_reply_days: 2, prices_hidden: 1, deliveries: 2, late: 1 })!
    expect(factNotes(f, null)).toEqual([
      'Counted from enquiries, quotes, POs and delivery dates. Nothing is typed in.',
      'Includes imported history: 3 of 6 enquiries came from the old CRM.',
      '1 price is hidden: the currency was never checked.',
      'Reply time is the middle of the 3 replies logged here. 2 imported replies are left out (no real date).',
    ])
  })
  it('imported only: the span, and why there is no reply time', () => {
    const f = supplierFacts({ ...base, asked: 8, replied: 7, quoted: 6, legacy_asked: 8 })!
    const notes = factNotes(f, { from: '2023-03-02', to: '2025-09-30' })
    expect(notes[0]).toBe('All imported from the old CRM, Mar 2023 to Sep 2025. Nothing logged here since.')
    expect(notes).toContain('No reply time: imported replies carry the import date, not the day they answered.')
  })
  it('low data: says how many replies a reply time needs, and that no pattern is implied', () => {
    const notes = factNotes(supplierFacts({ ...base, asked: 1, replied: 1, quoted: 1, reply_days_n: 1 })!, null)
    expect(notes).toContain('Reply time shows once 3 replies are logged here (1 so far).')
    expect(notes[notes.length - 1]).toBe('With so few enquiries these are facts, not a pattern.')
  })
})
