import { describe, expect, it } from 'vitest'
import { orderRef, rfqRef } from '@/lib/refs'

describe('refs', () => {
  it('pads to four digits and keeps longer numbers whole', () => {
    expect(rfqRef(7)).toBe('RFQ-0007')
    expect(rfqRef(177)).toBe('RFQ-0177')
    expect(orderRef(38)).toBe('ORD-0038')
    expect(orderRef(12345)).toBe('ORD-12345')
  })
})
