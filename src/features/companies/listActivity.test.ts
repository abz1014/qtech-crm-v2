import { describe, expect, it } from 'vitest'
import { companyActivity } from '@/features/companies/listActivity'

describe('companyActivity (Companies list counts on both sides)', () => {
  it('counts a supplier by the RFQs it was asked about and its supplier orders, with its last activity', () => {
    // Dubai Instrumentation in the audit seed: asked about 4 RFQs, 3 supplier orders; the list said "0 RFQs · 0 orders · None yet".
    const m = companyActivity({
      rfqs: [],
      orders: [],
      asks: [
        { supplier_id: 'dubai', rfq_id: 'r4', sent_on: '2026-10-12' },
        { supplier_id: 'dubai', rfq_id: 'r5', sent_on: '2026-10-17' },
        { supplier_id: 'dubai', rfq_id: 'r8', sent_on: '2026-10-15' },
        { supplier_id: 'dubai', rfq_id: 'r12', sent_on: '2026-10-09' },
      ],
      legs: [
        { supplier_id: 'dubai', order_id: 'o1', on: '2026-08-20' },
        { supplier_id: 'dubai', order_id: 'o3', on: '2026-09-25' },
        { supplier_id: 'dubai', order_id: 'o11', on: '2026-10-20' },
      ],
    })
    expect(m.get('dubai')).toEqual({ rfqs: 4, orders: 3, last: '2026-10-20' })
  })

  it('a company that is both counts each RFQ and order once, and an unsent enquiry counts for nothing', () => {
    const m = companyActivity({
      rfqs: [{ id: 'r1', company_id: 'both', received_on: '2026-09-01' }],
      orders: [{ id: 'o1', company_id: 'both', ordered_on: '2026-09-10T08:00:00Z' }],
      asks: [
        { supplier_id: 'both', rfq_id: 'r2', sent_on: '2026-09-05' },
        { supplier_id: 'both', rfq_id: 'r2', sent_on: '2026-09-06' },
        { supplier_id: 'both', rfq_id: 'r3', sent_on: null },
      ],
      legs: [
        { supplier_id: 'both', order_id: 'o1', on: null },
        { supplier_id: 'both', order_id: 'o2', on: '2026-09-08' },
      ],
    })
    expect(m.get('both')).toEqual({ rfqs: 2, orders: 2, last: '2026-09-10' })
  })

  it('a customer keeps its own counts; a company with nothing is absent', () => {
    const m = companyActivity({
      rfqs: [
        { id: 'r1', company_id: 'c', received_on: '2026-10-19' },
        { id: 'r2', company_id: 'c', received_on: null },
      ],
      orders: [{ id: 'o1', company_id: 'c', ordered_on: '2026-10-02' }],
      asks: [],
      legs: [],
    })
    expect(m.get('c')).toEqual({ rfqs: 2, orders: 1, last: '2026-10-19' })
    expect(m.get('nobody')).toBeUndefined()
  })
})
