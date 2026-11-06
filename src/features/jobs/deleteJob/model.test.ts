import { describe, expect, it } from 'vitest'
import { STOPS } from '@/features/jobs/lib/stages'
import { blockerLine, blockerLink, guideIntro, guideOf, stageIndexOf, toBlockers, type BlockerRow } from '@/features/jobs/deleteJob/model'

const row = (o: Partial<BlockerRow>): BlockerRow => ({
  step: 3,
  kind: 'payment',
  order_id: 'o-1',
  order_number: 38,
  ref_id: 'r-1',
  ref_label: 'Rs 10.00 payment',
  ref_on: '2026-11-02',
  can_clear: true,
  why: 'Delete the payment.',
  ...o,
})

const job = { key: '139', orderId: 'o-1', companyId: 'c-1' }

describe('toBlockers', () => {
  it('keeps the step order and drops a kind it does not know', () => {
    const out = toBlockers([row({ step: 5, kind: 'expense' }), row({ step: 1, kind: 'credit_applied' }), row({ step: 9, kind: 'something_new' })])
    expect(out.map(b => b.kind)).toEqual(['credit_applied', 'expense'])
  })
})

describe('guideOf', () => {
  it('is clear with no blocker', () => {
    expect(guideOf([])).toEqual({ todo: [], keep: [], clear: true, mustCancel: false })
  })
  it('splits what can be cleared from what the books keep', () => {
    const g = guideOf(toBlockers([row({}), row({ step: 4, kind: 'invoice', can_clear: false, ref_label: 'Invoice INV-0042' })]))
    expect(g.todo.map(b => b.kind)).toEqual(['payment'])
    expect(g.keep.map(b => b.kind)).toEqual(['invoice'])
    expect(g.mustCancel).toBe(true)
    expect(g.clear).toBe(false)
  })
})

describe('guideIntro', () => {
  it('says to do the steps when everything can be cleared', () => {
    expect(guideIntro(guideOf(toBlockers([row({})])))).toBe('This job cannot be deleted yet. Do these steps in order, then press Check again.')
  })
  it('says a kept record stops the delete, in one sentence; the way out is the button, not a second sentence', () => {
    const g = guideOf(toBlockers([row({ kind: 'invoice', can_clear: false })]))
    expect(guideIntro(g)).toBe('Some records of this job stay for the books, so it cannot be deleted.')
    expect(guideIntro(g)).not.toMatch(/instead/i)
  })
  it('strips the closing "Cancel the job instead." from a reason, and leaves the rest alone', () => {
    const kept = toBlockers([row({ kind: 'invoice', can_clear: false, why: 'A numbered invoice is kept for the books. Cancel the job instead.' })])[0]
    expect(kept.why).toBe('A numbered invoice is kept for the books.')
    const step = toBlockers([row({ why: 'Delete the payment, then check again.' })])[0]
    expect(step.why).toBe('Delete the payment, then check again.')
  })
})

describe('blockerLink', () => {
  const b = (o: Partial<BlockerRow>) => toBlockers([row(o)])[0]
  it('sends credit and refunds to the customer', () => {
    expect(blockerLink(b({ kind: 'refund', step: 2 }), job)).toEqual({ to: '/companies/c-1', label: 'Open the customer' })
    expect(blockerLink(b({ kind: 'credit_applied', step: 1 }), job)?.to).toBe('/companies/c-1')
  })
  it('opens the stage on the job page for the live order', () => {
    expect(blockerLink(b({}), job)?.to).toBe('/jobs/139?stage=payment')
    expect(blockerLink(b({ kind: 'invoice', step: 4 }), job)?.to).toBe('/jobs/139?stage=invoice')
    expect(blockerLink(b({ kind: 'purchase_order', step: 6 }), job)?.to).toBe('/jobs/139?stage=supplier-order')
  })
  it('opens the order page for an order that is not the live one, and for an expense', () => {
    expect(blockerLink(b({ order_id: 'o-9' }), job)).toEqual({ to: '/orders/o-9', label: 'Open the order' })
    expect(blockerLink(b({ kind: 'expense', step: 5 }), job)?.to).toBe('/orders/o-1')
  })
  it('sends a cost on the enquiry itself (no order yet) to the Expenses page', () => {
    expect(blockerLink(b({ kind: 'expense', step: 5, order_id: null, order_number: null }), job)).toEqual({ to: '/money/expenses', label: 'Open Expenses' })
  })
  it('has no link for a record the books keep', () => {
    expect(blockerLink(b({ can_clear: false }), job)).toBeNull()
  })
})

describe('blockerLine', () => {
  it('adds the date when there is one', () => {
    expect(blockerLine(toBlockers([row({})])[0])).toBe('Rs 10.00 payment · 2 Nov 2026')
    expect(blockerLine(toBlockers([row({ ref_on: null })])[0])).toBe('Rs 10.00 payment')
  })
})

describe('stageIndexOf', () => {
  it('finds a stop by its dashed lower-case name', () => {
    expect(stageIndexOf('payment', STOPS)).toBe(6)
    expect(stageIndexOf('supplier-order', STOPS)).toBe(3)
    expect(stageIndexOf('nonsense', STOPS)).toBeNull()
    expect(stageIndexOf(null, STOPS)).toBeNull()
  })
})
