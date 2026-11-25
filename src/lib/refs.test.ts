import { describe, expect, it } from 'vitest'
import { jobRef, orderRef, rfqRef } from '@/lib/refs'

describe('refs', () => {
  it('pads to four digits and keeps longer numbers whole', () => {
    expect(rfqRef(7)).toBe('RFQ-0007')
    expect(rfqRef(177)).toBe('RFQ-0177')
    expect(orderRef(38)).toBe('ORD-0038')
    expect(orderRef(12345)).toBe('ORD-12345')
  })
  it('writes a job as its document prints it: an RFQ job as RFQ-0139, an order with no RFQ as ORD-0045', () => {
    expect(jobRef('139')).toBe('RFQ-0139')
    expect(jobRef('O-45')).toBe('ORD-0045')
    expect(jobRef('O-2')).toBe('ORD-0002')
  })
})
