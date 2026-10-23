import { describe, expect, it } from 'vitest'
import type { OrderListRow } from '@/features/orders/api'
import { listRow } from '@/features/orders/lib/stepFixtures'
import { listNextStep } from '@/features/orders/lib/nextStep'
import type { StepLeg } from '@/features/orders/lib/orderSteps'

const today = '2026-11-20'
const leg = (over: Partial<StepLeg>): StepLeg => ({ id: 'l', supplierName: 'Alpenmark Controls', placedOn: null, expectedOn: null, deliveredOn: null, ...over })
const step = (over: Partial<OrderListRow>, role = 'admin') => listNextStep(listRow(over), role, today)

describe('the orders list "Next step" column', () => {
  it('says what is late first: an overdue payment with its days and amount, then late goods naming the supplier and the days', () => {
    expect(step({ payment: 'overdue', dueOn: '2026-11-08', balance: 630420, goods: 'late' })).toMatchObject({ text: 'Chase payment: 12 days overdue · PKR 630,420', tone: 'late' })
    expect(step({ goods: 'late', legs: [leg({ placedOn: '2026-11-01', expectedOn: '2026-11-17', supplierName: 'Dubai Instrumentation' })] })).toMatchObject({ text: 'Chase Dubai Instrumentation: goods 3 days late', tone: 'now' }) // amber: our own pace (redesign phase 0)
    // a late supplier order shows even when the view's single goods state says something else
    expect(step({ goods: 'to_place', legs: [leg({ id: 'a' }), leg({ id: 'b', placedOn: '2026-11-01', expectedOn: '2026-11-19', supplierName: 'Dubai' })] }).text).toBe('Chase Dubai: goods 1 day late')
  })

  it('sales: an invoiced order the database counts as done still says the payment is overdue (review 2026-10-20, finding 1)', () => {
    const done = { lifecycle: 'done', goods: 'delivered', invoicing: 'fully_invoiced', payment: 'overdue', balance: 500, dueOn: '2026-11-10' }
    expect(step(done, 'sales')).toMatchObject({ text: 'Chase payment: 10 days overdue · PKR 500', tone: 'late' })
    expect(step({ ...done, payment: 'unpaid', dueOn: '2026-12-01' }, 'sales')).toMatchObject({ text: 'Waiting for PKR 500, due 1 Dec', tone: 'waiting' })
    expect(step({ ...done, payment: 'settled', balance: 0 }, 'sales')).toMatchObject({ text: 'Done', tone: 'done' })
  })

  it('then what can be done now, naming the supplier where it can', () => {
    expect(step({ dataTrust: 'basis_unknown', goods: 'to_place' }).text).toMatch(/Is GST included/)
    expect(step({ goods: 'to_source' }).text).toBe('Choose a supplier for each goods line')
    expect(step({ goods: 'to_place', legs: [leg({})] }).text).toBe('Place the order with Alpenmark Controls')
    expect(step({ goods: 'to_place' }).text).toBe('Place the supplier order')
    expect(step({ goods: 'delivered', commissioning: 'to_plan' }).text).toBe('Plan commissioning')
    expect(step({ goods: 'partly_delivered' }).text).toBe('Deliver the rest')
    expect(step({ goods: 'delivered' }).text).toBe('Create the invoice')
    expect(step({ goods: 'delivered', invoicing: 'part' }).text).toBe('Invoice the rest')
    expect(step({ goods: 'delivered', commissioning: 'planned', plannedOn: '2026-11-19' }).text).toBe('Mark commissioning done')
  })

  it('invoice-ready orders say so even when commissioning is planned later (finding 4)', () => {
    expect(step({ goods: 'delivered', commissioning: 'planned', plannedOn: '2026-11-28' }).text).toBe('Create the invoice')
    expect(step({ goods: 'delivered', commissioning: 'planned', plannedOn: '2026-11-28', invoicing: 'fully_invoiced', payment: 'settled', balance: 0 })).toMatchObject({ text: 'Commissioning 28 Nov', tone: 'waiting' })
  })

  it('then what we are waiting for, quietly', () => {
    expect(step({ goods: 'on_order', legs: [leg({ placedOn: '2026-11-10', expectedOn: '2026-11-30' })] })).toMatchObject({ text: 'Goods expected 30 Nov', tone: 'waiting' })
    expect(step({ goods: 'on_order' })).toMatchObject({ text: 'Waiting for the goods', tone: 'waiting' })
    expect(step({ goods: 'delivered', invoicing: 'fully_invoiced', payment: 'unpaid', balance: 1180, dueOn: '2026-12-20' })).toMatchObject({ text: 'Waiting for PKR 1,180, due 20 Dec', tone: 'waiting' })
  })

  it('admin is reminded to close the costs; a finished order says so', () => {
    expect(step({ goods: 'delivered', invoicing: 'fully_invoiced', payment: 'settled', balance: 0, costsState: 'provisional' }).text).toBe('Mark costs complete')
    expect(step({ goods: 'delivered', invoicing: 'fully_invoiced', payment: 'settled', balance: 0, costsState: null }, 'sales')).toMatchObject({ text: 'Nothing left to do', tone: 'done' })
    expect(step({ lifecycle: 'done', goods: 'delivered', invoicing: 'fully_invoiced', payment: 'settled', balance: 0, costsState: 'complete' })).toMatchObject({ text: 'Done', tone: 'done' })
    expect(step({ lifecycle: 'cancelled', goods: 'late' })).toMatchObject({ text: 'Cancelled', tone: 'inert' })
  })

  it('an engineer is never told about money, and never offered a step only admin and sales can take', () => {
    const eng = { invoicing: null, payment: null, gross: null, balance: null, dueOn: null }
    expect(step({ ...eng, goods: 'delivered' }, 'engineer').text).toBe('Nothing left for you')
    expect(step({ ...eng, goods: 'delivered', commissioning: 'planned', plannedOn: '2026-11-25' }, 'engineer').text).toBe('Commissioning 25 Nov')
    expect(step({ ...eng, goods: 'to_source' }, 'engineer')).toMatchObject({ text: 'Waiting for a supplier to be chosen', tone: 'waiting' })
    expect(step({ ...eng, goods: 'to_place', legs: [leg({})] }, 'engineer')).toMatchObject({ text: 'Waiting for admin to place the order with Alpenmark Controls', tone: 'waiting' })
    expect(step({ ...eng, goods: 'delivered', commissioning: 'to_plan' }, 'engineer')).toMatchObject({ text: 'Waiting for a commissioning date', tone: 'waiting' })
    for (const g of ['to_place', 'late', 'on_order', 'delivered']) expect(step({ ...eng, goods: g, payment: 'overdue' }, 'engineer').text).not.toMatch(/PKR|payment|invoice/i)
  })

  it('ranks late before now before waiting before done, so sorting the column puts the urgent first', () => {
    const ranks = [step({ goods: 'late' }), step({ goods: 'to_place' }), step({ goods: 'on_order' }), step({ lifecycle: 'done', goods: 'delivered', invoicing: 'fully_invoiced', payment: 'settled', balance: 0, costsState: 'complete' })].map(s => s.rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })
})

describe('imported rows in the list', () => {
  it('say "Imported, to review" instead of a late count, but money still wins', () => {
    const l = leg({ placedOn: '2025-01-01', expectedOn: '2025-02-01' })
    expect(step({ imported: true, goods: 'late', legs: [l] }).text).toBe('Imported, to review')
    expect(step({ imported: true, goods: 'late', legs: [l], payment: 'overdue', dueOn: '2025-03-01', balance: 5 }).kind).toBe('chase-payment')
    expect(step({ goods: 'late', legs: [l] }).text).not.toMatch(/\b([3-9]\d|\d{3,}) days (overdue|late)\b/)
    expect(step({ imported: true, goods: 'late', legs: [l] }, 'engineer').text).toBe('Imported, to review')
  })
})
