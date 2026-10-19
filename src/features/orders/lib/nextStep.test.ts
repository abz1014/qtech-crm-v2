import { describe, expect, it } from 'vitest'
import type { OrderListRow } from '@/features/orders/api'
import { listNextStep } from '@/features/orders/lib/nextStep'

const today = '2026-11-20'
const row = (over: Partial<OrderListRow>): OrderListRow => ({
  id: 'o',
  number: 38,
  customerPo: null,
  orderedOn: '2026-11-01',
  ownerId: 'u',
  ownerName: 'Ayesha',
  companyId: 'c',
  companyName: 'Punjab Cement Ltd',
  siteName: null,
  lifecycle: 'active',
  goods: 'on_order',
  commissioning: 'n_a',
  dataTrust: 'ok',
  invoicing: 'not_invoiced',
  gross: 1000,
  payment: 'unpaid',
  balance: 1000,
  engineerIds: [],
  plannedOn: null,
  dueOn: null,
  costsState: null,
  what: 'Belimo actuator ×6',
  moreLines: false,
  ...over,
})
const step = (over: Partial<OrderListRow>, role = 'admin') => listNextStep(row(over), role, today)

describe('the orders list "Next step" column', () => {
  it('says what is late first: an overdue payment with its amount and days, then late goods', () => {
    expect(step({ payment: 'overdue', dueOn: '2026-11-08', balance: 630420, goods: 'late' })).toMatchObject({ text: 'Chase payment: 12 days overdue · PKR 630,420', tone: 'late' })
    expect(step({ goods: 'late' })).toMatchObject({ text: 'Chase the supplier: goods late', tone: 'late' })
  })

  it('then what can be done now, in the order the work is done', () => {
    expect(step({ dataTrust: 'basis_unknown', goods: 'to_place' }).text).toMatch(/Is GST included/)
    expect(step({ dataTrust: 'basis_unknown', goods: 'to_place' }, 'sales').text).toBe('Place the supplier order')
    expect(step({ goods: 'to_source' }).text).toBe('Choose a supplier')
    expect(step({ goods: 'to_place', commissioning: 'to_plan' }).text).toBe('Place the supplier order')
    expect(step({ goods: 'on_order', commissioning: 'to_plan' }).text).toBe('Plan commissioning')
    expect(step({ goods: 'partly_delivered' }).text).toBe('Deliver the rest')
    expect(step({ goods: 'delivered' }).text).toBe('Create the invoice')
    expect(step({ goods: 'delivered', invoicing: 'part' }).text).toBe('Invoice the rest')
    expect(step({ goods: 'delivered', commissioning: 'planned', plannedOn: '2026-11-19' }).text).toBe('Mark commissioning done')
  })

  it('then what we are waiting for, quietly', () => {
    expect(step({ goods: 'on_order' })).toMatchObject({ text: 'Waiting for the goods', tone: 'waiting' })
    expect(step({ goods: 'delivered', commissioning: 'planned', plannedOn: '2026-11-28' })).toMatchObject({ text: 'Commissioning 28 Nov', tone: 'waiting' })
    expect(step({ goods: 'delivered', invoicing: 'fully_invoiced', payment: 'unpaid', balance: 1180, dueOn: '2026-12-20' })).toMatchObject({ text: 'Waiting for PKR 1,180, due 20 Dec', tone: 'waiting' })
  })

  it('admin is reminded to close the costs; a finished order says so', () => {
    expect(step({ goods: 'delivered', invoicing: 'fully_invoiced', payment: 'settled', costsState: 'provisional' }).text).toBe('Mark costs complete')
    expect(step({ goods: 'delivered', invoicing: 'fully_invoiced', payment: 'settled', costsState: null }, 'sales')).toMatchObject({ text: 'Nothing left to do', tone: 'done' })
    expect(step({ lifecycle: 'done' })).toMatchObject({ text: 'Done', tone: 'done' })
    expect(step({ lifecycle: 'cancelled', goods: 'late' })).toMatchObject({ text: 'Cancelled', tone: 'done' })
  })

  it('an engineer is never told about money', () => {
    const eng = { invoicing: null, payment: null, gross: null, balance: null, dueOn: null }
    expect(step({ ...eng, goods: 'delivered' }, 'engineer').text).toBe('Nothing left for you')
    expect(step({ ...eng, goods: 'delivered', commissioning: 'planned', plannedOn: '2026-11-25' }, 'engineer').text).toBe('Commissioning 25 Nov')
    for (const g of ['to_place', 'late', 'on_order', 'delivered']) expect(step({ ...eng, goods: g, payment: 'overdue' }, 'engineer').text).not.toMatch(/PKR|payment|invoice/i)
  })

  it('ranks late before now before waiting before done, so sorting the column puts the urgent first', () => {
    const ranks = [step({ goods: 'late' }), step({ goods: 'to_place' }), step({ goods: 'on_order' }), step({ lifecycle: 'done' })].map(s => s.rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })
})
