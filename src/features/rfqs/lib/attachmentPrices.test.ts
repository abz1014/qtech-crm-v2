import { describe, expect, it } from 'vitest'
import { attachmentHasPrices } from '@/features/rfqs/lib/attachmentPrices'

describe('has_prices on a new file', () => {
  it('a customer PO, a supplier quote or an enquiry file from admin or sales has prices', () => {
    for (const role of ['admin', 'sales']) {
      expect(attachmentHasPrices({ role, orderId: 'o', mime: 'application/pdf' })).toBe(true)
      expect(attachmentHasPrices({ role, mime: 'application/pdf' })).toBe(true)
      expect(attachmentHasPrices({ role, mime: 'image/jpeg' })).toBe(true)
    }
  })
  it('an engineer upload never has prices (the database refuses true from an engineer)', () => {
    expect(attachmentHasPrices({ role: 'engineer', orderId: 'o', mime: 'application/pdf' })).toBe(false)
    expect(attachmentHasPrices({ role: 'engineer', mime: 'image/jpeg' })).toBe(false)
  })
  it('a site photo on an order, and a photo that answers a question, do not', () => {
    expect(attachmentHasPrices({ role: 'sales', orderId: 'o', mime: 'image/jpeg' })).toBe(false)
    expect(attachmentHasPrices({ role: 'admin', clarificationId: 'c', mime: 'image/png' })).toBe(false)
  })
})
