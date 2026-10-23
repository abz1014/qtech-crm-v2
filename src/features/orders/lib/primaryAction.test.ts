import { describe, expect, it } from 'vitest'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow, OrderMoney } from '@/features/orders/api'
import { header, item, legRow, money } from '@/features/orders/lib/stepFixtures'
import { orderFacts, pageStep, recordPaymentPlace } from '@/features/orders/lib/primaryAction'

const today = '2026-11-20'


const page = (o: OrderHeader, legs: OrderLegRow[], items: OrderItemRow[], role = 'admin', m: OrderMoney | null = money(), pos: LegPo[] = []) => pageStep(orderFacts(o, legs, items, pos, role, role === 'engineer' ? null : m, today))

describe('the order page: one primary button, chosen by the shared ordering', () => {
  it('goes Issue PO, then Delivered today, then Create invoice, then Record payment', () => {
    const a = legRow('a')
    const placed = legRow('a', { placedOn: '2026-11-10', expectedOn: '2026-11-30' })
    const delivered = legRow('a', { placedOn: '2026-11-10', deliveredOn: '2026-11-15' })
    const issue = page(header(), [a], [item('1', 'a')])
    expect(issue.primary).toMatchObject({ kind: 'issue-po', label: 'Issue PO', legId: 'a', supplierName: 'Supplier a' })
    expect(issue.text).toBe('Order the goods from Supplier a')
    expect(page(header({}, { goods: 'on_order' }), [placed], [item('1', 'a')]).primary).toMatchObject({ kind: 'deliver', label: 'Delivered today' })
    expect(page(header({}, { goods: 'delivered' }), [delivered], [item('1', 'a')]).primary).toMatchObject({ kind: 'create-invoice' })
    const invoiced = page(header({}, { goods: 'delivered', invoicing: 'fully_invoiced', invoiced: 1180 }), [delivered], [item('1', 'a')], 'admin', money({ dueOn: '2026-12-20' }))
    expect(invoiced.primary).toMatchObject({ kind: 'record-payment' })
    expect(invoiced.text).toBe('Customer owes PKR 1,180, due 20 Dec')
  })

  it('late goods come first: admin and sales chase them; an engineer marks them delivered', () => {
    const late = legRow('b', { placedOn: '2026-11-01', expectedOn: '2026-11-17', supplierName: 'Dubai Instrumentation' })
    const both = [legRow('a'), late]
    const items = [item('1', 'a'), item('2', 'b')]
    const sales = page(header(), both, items, 'sales')
    expect(sales.primary).toMatchObject({ kind: 'chase-goods', label: 'Chase goods', supplierName: 'Dubai Instrumentation' })
    expect(sales.text).toBe('Goods from Dubai Instrumentation are 3 days late')
    expect(sales.step.tone).toBe('now') // amber: late goods are our own pace; red is for late money and promises (redesign phase 0)
    expect(page(header(), both, items, 'engineer').primary).toMatchObject({ kind: 'deliver', label: 'Delivered today' })
  })

  it('a placed order whose PO exists but has no placed date is marked placed, not issued again', () => {
    expect(page(header(), [legRow('a')], [item('1', 'a')], 'admin', money(), [{ legId: 'a', number: 17, revision: 0, issuedOn: today, firstIssuedOn: today, lines: [] }]).primary).toMatchObject({ kind: 'mark-placed' })
  })

  it('goods lines with no supplier are a step of their own, and never "Everything is delivered" (finding 2)', () => {
    const r = page(header({}, { goods: 'to_source' }), [], [item('1', null), item('2', null)], 'sales')
    expect(r.primary).toMatchObject({ kind: 'add-supplier', label: 'Add supplier' })
    expect(r.text).toBe('2 goods lines have no supplier yet')
    expect(page(header({}, { goods: 'to_source' }), [], [item('1', null)], 'engineer').primary).toBeNull()
  })

  it('a supplier order with no goods lines is not a step (finding 3)', () => {
    const empty = legRow('e', { supplierName: 'Empty Co' })
    const delivered = legRow('a', { placedOn: '2026-11-10', deliveredOn: '2026-11-15' })
    const r = page(header({}, { goods: 'delivered' }), [delivered, empty], [item('1', 'a'), item('2', 'e', { isService: true })])
    expect(r.primary?.kind).toBe('create-invoice')
    expect(r.text).not.toMatch(/Empty Co/)
  })

  it('asks "Is GST included?" first on an imported order with an unknown price basis (admin only)', () => {
    expect(page(header({}, { dataTrust: 'basis_unknown' }), [legRow('a')], [item('1', 'a')]).primary).toMatchObject({ kind: 'resolve-basis' })
    expect(page(header({}, { dataTrust: 'basis_unknown' }), [legRow('a')], [item('1', 'a')], 'sales').primary).toMatchObject({ kind: 'issue-po' })
  })

  it('commissioning: Plan commissioning when it has no date, Mark done today only once the date has come, invoicing before a later date', () => {
    const delivered = [legRow('a', { placedOn: '2026-11-10', deliveredOn: '2026-11-15' })]
    const items = [item('1', 'a')]
    expect(page(header({ needsCommissioning: true }, { goods: 'delivered', commissioning: 'to_plan' }), delivered, items).primary).toMatchObject({ kind: 'plan-commissioning' })
    expect(page(header({ needsCommissioning: true, plannedOn: '2026-11-20' }, { goods: 'delivered', commissioning: 'planned' }), delivered, items).primary).toMatchObject({ kind: 'mark-done' })
    expect(page(header({ needsCommissioning: true, plannedOn: '2026-11-28' }, { goods: 'delivered', commissioning: 'planned' }), delivered, items).primary).toMatchObject({ kind: 'create-invoice' })
  })

  it('an engineer: Mark done today is green only once the planned date has come, and never hides Delivered today (finding 5)', () => {
    const later = header({ needsCommissioning: true, plannedOn: '2026-12-01' }, { goods: 'on_order', commissioning: 'planned' })
    const onOrder = [legRow('a', { placedOn: '2026-11-10', expectedOn: '2026-11-30' })]
    expect(page(later, onOrder, [item('1', 'a')], 'engineer').primary).toMatchObject({ kind: 'deliver' })
    expect(page(later, [legRow('a', { placedOn: '2026-11-10', deliveredOn: '2026-11-18' })], [item('1', 'a')], 'engineer').primary).toBeNull()
    const due = header({ needsCommissioning: true, plannedOn: '2026-11-20' }, { goods: 'delivered', commissioning: 'planned' })
    expect(page(due, [legRow('a', { placedOn: '2026-11-10', deliveredOn: '2026-11-18' })], [item('1', 'a')], 'engineer').primary).toMatchObject({ kind: 'mark-done' })
    expect(page(header({}, { goods: 'to_place' }), [legRow('a')], [item('1', 'a')], 'engineer').primary).toBeNull()
  })

  it('sales never get Record payment (it is admin only): they get Copy reminder while the customer owes, overdue or not', () => {
    const r = page(header({}, { goods: 'delivered', invoicing: 'fully_invoiced', invoiced: 1180 }), [], [], 'sales', money({ paymentState: 'overdue', dueOn: '2026-11-10' }))
    expect(r.primary).toMatchObject({ kind: 'copy-reminder', label: 'Copy reminder' })
    expect(r.text).toBe('Customer owes PKR 1,180, 10 days overdue')
    const notDue = page(header({}, { goods: 'delivered', invoicing: 'fully_invoiced', invoiced: 1180 }), [], [], 'sales', money({ dueOn: '2026-12-03' }))
    expect(notDue.primary).toMatchObject({ kind: 'copy-reminder' })
    expect(notDue.text).toBe('Customer owes PKR 1,180, due 3 Dec')
  })

  it('an engineer waits for the admin to place the order, and is told so', () => {
    const r = page(header({}, { goods: 'to_place' }), [legRow('a', { supplierName: 'Dubai Instrumentation' })], [item('1', 'a')], 'engineer')
    expect(r.primary).toBeNull()
    expect(r.text).toBe('Waiting for admin to place the order with Dubai Instrumentation')
  })

  it('admin, paid in full, costs open: the page says Mark costs complete, like the list', () => {
    const r = page(header({}, { goods: 'delivered', invoicing: 'fully_invoiced', invoiced: 1180 }), [], [], 'admin', money({ paymentState: 'settled', balance: 0, settled: 1180 }))
    expect(r.step.kind).toBe('costs')
    expect(r.primary).toBeNull()
    expect(r.text).toBe('Mark costs complete in the Margin panel')
  })

  it('Record payment: in the Payment cell only once invoiced and owed; before the invoice (an advance) or once paid, in the More menu', () => {
    const invoiced = header({}, { invoiced: 1180 })
    expect(recordPaymentPlace(header(), money(), undefined, 'admin')).toBe('menu')
    expect(recordPaymentPlace(invoiced, money(), undefined, 'admin')).toBe('cell')
    expect(recordPaymentPlace(invoiced, money({ balance: 0, settled: 1180, paymentState: 'settled' }), undefined, 'admin')).toBe('menu')
    expect(recordPaymentPlace(invoiced, money(), 'record-payment', 'admin')).toBe('primary')
    expect(recordPaymentPlace(invoiced, money(), undefined, 'sales')).toBeNull()
    expect(recordPaymentPlace(header({ cancelledOn: '2026-11-19' }), money(), undefined, 'admin')).toBeNull()
  })

  it('a done, paid order: admin and sales get Repeat order as the green button; an engineer gets none (audit 39676918821)', () => {
    const done = header({}, { lifecycle: 'done', goods: 'delivered', invoicing: 'fully_invoiced', invoiced: 1180 })
    const paid = money({ paymentState: 'settled', balance: 0, settled: 1180, costsState: 'complete' })
    const admin = page(done, [], [], 'admin', paid)
    expect(admin.step.kind).toBe('done')
    expect(admin.primary).toEqual({ kind: 'repeat-order', label: 'Repeat order' })
    expect(admin.text).toBe('Nothing left to do on this order')
    expect(page(done, [], [], 'sales', paid).primary).toMatchObject({ kind: 'repeat-order' })
    expect(page(done, [], [], 'engineer').primary).toBeNull()
  })

  it('a cancelled order has no primary step', () => {
    expect(page(header({ cancelledOn: '2026-11-19' }), [legRow('a')], [item('1', 'a')]).primary).toBeNull()
  })
})

describe('the order page for an imported order', () => {
  it('has no green button and says it is to review', () => {
    const r = page(header({ imported: true }, { goods: 'to_place' }), [legRow('a')], [item('1', 'a')])
    expect(r.step.kind).toBe('review-imported')
    expect(r.primary).toBeNull()
    expect(r.text).toBe('Imported, to review')
  })
})
