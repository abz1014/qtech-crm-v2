import { describe, expect, it } from 'vitest'
import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import { buildCustomerDraft, buildGoodsDraft, buildPaymentDraft, buildSupplierDraft } from './chaseDraft'
import { agoText, chasedAgo, distanceText, headerDate, waitingLine } from './text'
import { millions, quarterStart, roundToTile, targetWorking } from './targetModel'
import type { TargetProgress } from './api'
import type { ClarificationFact, LegFact, ReceivableFact, RfqFact } from './types'

const TODAY = '2026-11-27'
const sig = { name: 'Ayesha Rana', company: 'Q-Tech Solutions', jobTitle: 'Sales' }
const rfq: RfqFact = {
  id: 'r1', number: 177, ownerId: 'me', companyName: 'Indus Textile Mills', customerRef: '74037', receivedOn: '2026-11-17', dueOn: '2026-12-11',
  quotedOn: null, isPriority: false, bidState: 'to_bid', sourcingState: 'floated_awaiting', quotationValidUntil: null,
}
const q = (o: Partial<ClarificationFact> = {}): ClarificationFact => ({ id: 'c1', rfqId: 'r1', question: 'Line size?', firstAskedOn: '2026-11-21', lastAskedOn: '2026-11-21', askCount: 1, ...o })

describe('drafts', () => {
  it('customer: both channels, from the open questions only, with the count after the stamp', () => {
    const d = buildCustomerDraft({ rfq, contact: { name: 'Mr. Tariq', phone: '+92 300 555 0142' }, questions: [q(), q({ id: 'c2', question: 'Temperature range?' })], today: TODAY, signature: sig })
    expect(d?.kind).toBe('customer')
    expect(d?.whatsapp.body).toContain('1. Line size?\n2. Temperature range?')
    expect(d?.email.subject).toContain('RFQ #74037')
    expect(d?.countAfter).toBe(2)
    expect(d?.firm).toBe(false)
    expect(d?.contact?.phone).toBe('+92 300 555 0142')
  })
  it('customer: nothing to write without open questions', () => {
    expect(buildCustomerDraft({ rfq, contact: null, questions: [], today: TODAY, signature: sig })).toBeNull()
  })
  it('customer: firmer when the first ask is over 30 days old', () => {
    const d = buildCustomerDraft({ rfq: { ...rfq, dueOn: null }, contact: null, questions: [q({ firstAskedOn: '2026-10-01', lastAskedOn: '2026-10-15' })], today: TODAY, signature: sig })
    expect(d?.firm).toBe(true)
  })

  const items: RfqItemRow[] = [
    { id: 'i1', number: 1, description: 'Flow meter', brandId: null, brandName: null, familyId: null, qty: 2, unit: 'nos' },
    { id: 'i2', number: 2, description: 'Transmitter', brandId: null, brandName: null, familyId: null, qty: 3, unit: 'nos' },
  ]
  const inquiry = (o: Partial<InquiryRow> = {}): InquiryRow => ({
    id: 'q1', supplierId: 's1', supplierName: 'Metro', supplierCountry: null, sentOn: '2026-11-23', lastChasedOn: null, lastRelayedAt: null, noOfferOn: null, noOfferReason: null,
    itemDeclines: {}, chaseCount: 0, notes: null, contactName: 'Mr. Imran', contactPhone: '0321', contactEmail: null, lastCurrency: null, responseState: 'awaiting', contactState: 'sent', itemsQuoted: 0, lines: [], ...o,
  })
  it('supplier: lists the unpriced items only and thanks for the priced one', () => {
    const d = buildSupplierDraft({ rfq, inquiry: inquiry({ lines: [{ id: 'l', inquiryId: 'q1', itemId: 'i1', unitPrice: 1, currency: 'USD', leadTime: null, inStock: null, fxRatePkr: null, fxRateOn: null }] }), items, today: TODAY, signature: sig })
    expect(d?.whatsapp.body).toContain('Thank you for pricing item 1')
    expect(d?.whatsapp.body).toContain('2. Transmitter, 3 nos')
    expect(d?.whatsapp.body).not.toContain('1. Flow meter')
    expect(d?.countAfter).toBe(1)
  })
  it('supplier: nothing to ask when everything is priced or declined, or the supplier said no', () => {
    expect(buildSupplierDraft({ rfq, inquiry: inquiry({ itemDeclines: { i1: 'x', i2: 'x' } }), items, today: TODAY, signature: sig })).toBeNull()
    expect(buildSupplierDraft({ rfq, inquiry: inquiry({ noOfferOn: '2026-11-25' }), items, today: TODAY, signature: sig })).toBeNull()
  })
  it('supplier: over 30 days since the enquiry is firmer', () => {
    const d = buildSupplierDraft({ rfq, inquiry: inquiry({ sentOn: '2026-10-20' }), items, today: TODAY, signature: sig })
    expect(d?.firm).toBe(true)
    expect(d?.whatsapp.body).toContain('over a month')
  })

  const leg: LegFact = {
    id: 'l1', orderId: 'o1', orderNumber: 38, ownerId: 'me', customerName: 'Punjab Cement', supplierName: 'Hengxin', reference: '253102', orderedOn: '2026-11-10',
    placedOn: '2026-11-12', expectedOn: '2026-11-22', receivedOn: null, deliveredOn: null, lastChasedOn: null, chaseCount: 0,
  }
  it('goods: carries the leg reference and the goods lines', () => {
    const d = buildGoodsDraft({ leg, data: { contact: null, items: [{ description: 'Pump', brandName: null, qty: 1, unit: 'nos' }] }, today: TODAY, signature: sig })
    expect(d?.whatsapp.body).toContain('253102')
    expect(d?.whatsapp.body).toContain('1. Pump, 1 no')
    expect(d?.contact).toBeNull()
  })
  it('goods: no expected date, no draft', () => {
    expect(buildGoodsDraft({ leg: { ...leg, expectedOn: null }, data: { contact: null, items: [] }, today: TODAY, signature: sig })).toBeNull()
  })

  const rec: ReceivableFact = { orderId: 'o1', orderNumber: 31, ownerId: 'me', customerName: 'KG', balance: 1111600, settled: 800000, dueOn: '2026-10-20', isOverdue: true, lastRemindedOn: null, reminderCount: 0 }
  it('payment: states the balance, and is firm after 30 days overdue', () => {
    const d = buildPaymentDraft({ receivable: rec, data: { customerPo: '251992', contact: null, invoiceNumber: 'INV-2256', invoiceDate: '2026-09-20', invoices: [] }, today: TODAY, signature: sig })
    expect(d?.whatsapp.body).toContain('PKR 1,111,600 (after your payment of PKR 800,000)')
    expect(d?.firm).toBe(true)
    expect(buildPaymentDraft({ receivable: { ...rec, dueOn: null }, data: { customerPo: null, contact: null, invoiceNumber: null, invoiceDate: null, invoices: [] }, today: TODAY, signature: sig })).toBeNull()
  })
})

describe('row words', () => {
  it('says how long ago and when it returns', () => {
    expect(chasedAgo(TODAY, TODAY)).toBe('chased just now')
    expect(chasedAgo('2026-11-26', TODAY)).toBe('chased yesterday')
    expect(waitingLine('2026-11-25', '2026-11-30', TODAY)).toBe('chased 2 days ago · next nudge on Mon 30 Nov')
    expect(waitingLine('2026-11-25', '2026-11-30', TODAY, 'reminded')).toContain('reminded 2 days ago')
    expect(agoText('2026-11-21', TODAY)).toBe('6 days ago')
    expect(distanceText('2026-12-01', TODAY)).toBe('4 days')
    expect(distanceText('2026-11-26', TODAY)).toBe('1 day late')
    expect(headerDate(TODAY)).toBe('Friday 27 November')
  })
})

describe('target tile working', () => {
  const t: TargetProgress = { year: 2026, quarter: 4, quarterEnd: '2026-12-31', targetNet: 6_000_000, achievedNet: 3_450_000, gap: 2_550_000, onPaceNet: 3_782_608.7, behindPace: 332_608.7, excludedCount: 0 }
  it('shows its working: day 58 of 92, rounded to 10,000, exact kept', () => {
    const w = targetWorking(t, TODAY)
    expect(quarterStart(2026, 4)).toBe('2026-10-01')
    expect(w).toMatchObject({ label: 'Q4', startText: '1 Oct', endText: '31 Dec', dayOfQuarter: 58, daysInQuarter: 92, daysLeft: 34, status: 'behind' })
    expect(w?.onPace).toBe(3_780_000)
    expect(w?.behind).toBe(330_000)
    expect(w?.behindExact).toBeCloseTo(332_608.7)
    expect(millions(w?.onPace ?? 0)).toBe('3.78M')
  })
  it('ahead of pace', () => {
    const w = targetWorking({ ...t, achievedNet: 4_100_000, behindPace: 0 }, TODAY)
    expect(w?.status).toBe('ahead')
    expect(w?.ahead).toBe(320_000)
  })
  it('no target means no tile numbers', () => {
    expect(targetWorking({ ...t, targetNet: null }, TODAY)).toBeNull()
    expect(roundToTile(14_999)).toBe(10_000)
  })
})
