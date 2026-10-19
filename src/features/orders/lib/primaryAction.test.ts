import { describe, expect, it } from 'vitest'
import { choosePrimary, waitingText, type PrimaryInput, type PrimaryLeg } from '@/features/orders/lib/primaryAction'

const today = '2026-11-20'
const leg = (id: string, over: Partial<PrimaryLeg> = {}): PrimaryLeg => ({ id, supplierName: `Supplier ${id}`, placedOn: null, expectedOn: null, deliveredOn: null, hasPo: false, ...over })
const input = (over: Partial<PrimaryInput> = {}): PrimaryInput => ({
  role: 'admin',
  cancelled: false,
  basisUnknown: false,
  legs: [],
  today,
  needsCommissioning: false,
  plannedOn: null,
  doneOn: null,
  invoicing: 'not_invoiced',
  toInvoice: 1180,
  balance: 1180,
  invoiced: 0,
  ...over,
})

describe('the order page has one primary step, chosen by state', () => {
  it('goes Issue PO, then Delivered today (late first), then Create invoice, then Record payment', () => {
    const placedA = leg('A', { placedOn: '2026-11-01', expectedOn: '2026-11-25' })
    const lateB = leg('B', { placedOn: '2026-11-01', expectedOn: '2026-11-10' })
    expect(choosePrimary(input({ legs: [placedA, leg('C')] }))).toMatchObject({ kind: 'issue-po', legId: 'C', label: 'Issue PO' })
    expect(choosePrimary(input({ legs: [placedA, lateB] }))).toMatchObject({ kind: 'deliver', legId: 'B', label: 'Delivered today', late: true })
    expect(choosePrimary(input({ legs: [placedA] }))).toMatchObject({ kind: 'deliver', legId: 'A', late: false })
    const delivered = leg('A', { placedOn: '2026-11-01', deliveredOn: '2026-11-15' })
    expect(choosePrimary(input({ legs: [delivered] }))).toMatchObject({ kind: 'create-invoice', label: 'Create invoice' })
    expect(choosePrimary(input({ legs: [delivered], invoicing: 'fully_invoiced', toInvoice: 0, invoiced: 1180, balance: 1180 }))).toMatchObject({ kind: 'record-payment' })
    expect(choosePrimary(input({ legs: [delivered], invoicing: 'fully_invoiced', toInvoice: 0, invoiced: 1180, balance: 0 }))).toBeNull()
  })

  it('a placed order whose PO exists but has no placed date is marked placed, not issued again', () => {
    expect(choosePrimary(input({ legs: [leg('A', { hasPo: true })] }))).toMatchObject({ kind: 'mark-placed', label: 'Mark placed' })
  })

  it('asks "Is GST included?" first on an imported order with an unknown price basis (admin only)', () => {
    expect(choosePrimary(input({ basisUnknown: true, legs: [leg('A')] }))).toMatchObject({ kind: 'resolve-basis' })
    expect(choosePrimary(input({ role: 'sales', basisUnknown: true, legs: [leg('A')] }))).toMatchObject({ kind: 'issue-po' })
  })

  it('commissioning is the step once it is due, after the goods', () => {
    const delivered = leg('A', { placedOn: '2026-11-01', deliveredOn: '2026-11-15' })
    expect(choosePrimary(input({ legs: [delivered], needsCommissioning: true, plannedOn: '2026-11-20' }))).toMatchObject({ kind: 'mark-done' })
    // planned later: invoicing may go first
    expect(choosePrimary(input({ legs: [delivered], needsCommissioning: true, plannedOn: '2026-11-28' }))).toMatchObject({ kind: 'create-invoice' })
  })

  it('sales never get Record payment (it is admin only)', () => {
    expect(choosePrimary(input({ role: 'sales', invoicing: 'fully_invoiced', toInvoice: 0, invoiced: 1180, balance: 1180 }))).toBeNull()
  })

  it('an engineer leads with their job: Mark done today, else Delivered today; never a money step', () => {
    const eng = { role: 'engineer', invoicing: null, toInvoice: null, balance: null, invoiced: null }
    expect(choosePrimary(input({ ...eng, needsCommissioning: true, plannedOn: '2026-12-01', legs: [leg('A')] }))).toMatchObject({ kind: 'mark-done', label: 'Mark done today' })
    expect(choosePrimary(input({ ...eng, legs: [leg('A', { placedOn: '2026-11-01' })] }))).toMatchObject({ kind: 'deliver' })
    expect(choosePrimary(input({ ...eng, legs: [leg('A')] }))).toBeNull()
  })

  it('a cancelled order has no primary step', () => {
    expect(choosePrimary(input({ cancelled: true, legs: [leg('A')] }))).toBeNull()
  })

  it('with nothing to do, a quiet sentence says what the order waits for', () => {
    const base = { legs: [], needsCommissioning: false, plannedOn: null, doneOn: null, invoicing: 'fully_invoiced', balance: 0, role: 'admin' }
    expect(waitingText({ ...base, legs: [{ placedOn: '2026-11-01', deliveredOn: null }] })).toBe('Waiting for the goods')
    expect(waitingText({ ...base, needsCommissioning: true, plannedOn: '2026-12-01' })).toBe('Waiting for the commissioning date')
    expect(waitingText({ ...base, balance: 500, role: 'sales' })).toBe('Waiting for the customer to pay')
    expect(waitingText(base)).toBe('Nothing left to do on this order')
  })
})
