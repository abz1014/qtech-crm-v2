import { describe, expect, it } from 'vitest'
import { jobNext } from '@/features/jobs/lib/nextStep'

const STAGES = ['enquiry', 'asking_suppliers', 'prices_in', 'quoted', 'ordered', 'supplier_ordered', 'delivered', 'invoiced', 'paid', 'lost', 'cancelled']
const DETAILS = [null, '1 of 3 suppliers replied', 'supplier late', 'arrived, not delivered', 'not invoiced yet', 'partly invoiced, advance received', 'part paid', 'installation to plan', 'quotation expired', 'money still open']

describe('next step in words', () => {
  it('names a step for every stage and never carries an amount', () => {
    for (const stage of STAGES) {
      for (const detail of DETAILS) {
        for (const role of ['admin', 'sales', 'engineer'] as const) {
          const n = jobNext({ stage, stageDetail: detail, role })
          expect(n.text, `${stage}/${detail}`).not.toMatch(/PKR|Rs|\d{4,}|\$/)
        }
      }
    }
  })

  it('an engineer is never sent to invoices, payments or quotations', () => {
    expect(jobNext({ stage: 'invoiced', stageDetail: 'not paid yet', role: 'engineer' })).toMatchObject({ text: 'Handled by the office', button: null })
    expect(jobNext({ stage: 'prices_in', stageDetail: null, role: 'engineer' }).button).toBeNull()
    expect(jobNext({ stage: 'quoted', stageDetail: 'waiting for the customer', role: 'engineer' }).button).toBeNull()
    expect(jobNext({ stage: 'delivered', stageDetail: 'not invoiced yet', role: 'engineer' }).text).not.toMatch(/invoice/i)
  })

  it('points the button at the action on the old RFQ or order page', () => {
    expect(jobNext({ stage: 'prices_in', stageDetail: null, role: 'sales' })).toMatchObject({ button: 'Send quotation', on: 'rfq', query: 'issue=1' })
    expect(jobNext({ stage: 'quoted', stageDetail: 'waiting for the customer', role: 'admin' })).toMatchObject({ button: 'Mark won', on: 'rfq', query: 'won=1' })
    expect(jobNext({ stage: 'ordered', stageDetail: 'to source', role: 'admin' }).on).toBe('order')
  })

  it('the order-side steps open their stage on the job page (P5-D2), not the order page', () => {
    expect(jobNext({ stage: 'ordered', stageDetail: 'to source', role: 'admin' })).toMatchObject({ button: 'Choose suppliers', stop: 3 })
    expect(jobNext({ stage: 'ordered', stageDetail: 'to place', role: 'sales' })).toMatchObject({ button: 'Place the order', stop: 3 })
    expect(jobNext({ stage: 'supplier_ordered', stageDetail: 'arrived, not delivered', role: 'sales' })).toMatchObject({ button: 'Deliver the goods', stop: 4 })
    expect(jobNext({ stage: 'supplier_ordered', stageDetail: 'supplier late', role: 'admin' })).toMatchObject({ button: 'Chase the supplier', stop: 4 })
    expect(jobNext({ stage: 'delivered', stageDetail: 'not invoiced yet', role: 'admin' })).toMatchObject({ button: 'Create invoice', stop: 5 })
    expect(jobNext({ stage: 'invoiced', stageDetail: 'part paid', role: 'admin' })).toMatchObject({ button: 'Chase the payment', stop: 5 })
    expect(jobNext({ stage: 'delivered', stageDetail: 'installation to plan', role: 'engineer' })).toMatchObject({ button: 'Plan installation', stop: 4 })
  })

  it('a late supplier is the red step', () => {
    expect(jobNext({ stage: 'supplier_ordered', stageDetail: 'supplier late', role: 'admin' }).tone).toBe('late')
  })
})
