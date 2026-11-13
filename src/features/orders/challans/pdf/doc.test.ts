import { describe, expect, it } from 'vitest'
import { header } from '@/features/orders/lib/stepFixtures'
import type { ChallanRow } from '@/features/orders/challans/model'
import { buildChallanDoc } from '@/features/orders/challans/pdf/doc'

const ORDER = header({ number: 38, companyName: 'Alpenmark Controls', customerPo: 'PO-7781' })
const CHALLAN = { number: 'DC-0007', issuedOn: '2026-10-30', deliverTo: null, notes: null, lines: [{ description: 'Gland', qty: 2, unit: 'pcs' }] } as unknown as ChallanRow

describe('buildChallanDoc customer PO', () => {
  it('carries the customer PO when showPo is true (admin, sales)', () => {
    expect(buildChallanDoc(ORDER, CHALLAN, true).customerPo).toBe('PO-7781')
  })
  it('never carries the customer PO when showPo is false (engineer)', () => {
    expect(buildChallanDoc(ORDER, CHALLAN, false).customerPo).toBeNull()
  })
})
