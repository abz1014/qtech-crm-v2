import { describe, expect, it } from 'vitest'
import { header } from '@/features/orders/lib/stepFixtures'
import type { VisitRow } from '@/features/orders/visits/model'
import { buildServiceReportDoc } from '@/features/orders/visits/pdf/doc'

const ORDER = header({ number: 38, companyName: 'Alpenmark Controls', customerPo: 'PO-7781' })
const VISIT: VisitRow = { id: 'v1', orderId: 'o', type: 'service', on: '2026-10-30', engineerId: 'e1', engineerName: 'Hamza', notes: null, doneOn: null }

describe('buildServiceReportDoc customer PO', () => {
  it('carries the customer PO when showPo is true (admin, sales)', () => {
    expect(buildServiceReportDoc(ORDER, VISIT, [], '2026-10-30', true).customerPo).toBe('PO-7781')
  })
  it('never carries the customer PO when showPo is false (engineer)', () => {
    expect(buildServiceReportDoc(ORDER, VISIT, [], '2026-10-30', false).customerPo).toBeNull()
  })
})
