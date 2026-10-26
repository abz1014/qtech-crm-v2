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

  it('a late supplier is the red step', () => {
    expect(jobNext({ stage: 'supplier_ordered', stageDetail: 'supplier late', role: 'admin' }).tone).toBe('late')
  })
})
