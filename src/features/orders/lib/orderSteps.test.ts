import { describe, expect, it } from 'vitest'
import type { OrderListRow } from '@/features/orders/api'
import { listNextStep } from '@/features/orders/lib/nextStep'
import { orderFacts, pageStep } from '@/features/orders/lib/primaryAction'
import { header, item, listRow, legRow, money } from '@/features/orders/lib/stepFixtures'

/*
 * The orders list and the order page take their next step from ONE ordering (lib/orderSteps.ts). Each case below describes an order once
 * and feeds the same state to both: the list row (what listOrders reads) and the page (header, supplier orders, lines, balance). They must
 * name the same step (review of ux/orders 2026-10-20, finding 4).
 */
const today = '2026-11-20'

interface Case {
  name: string
  role: 'admin' | 'sales' | 'engineer'
  state: { lifecycle?: string; goods: string; commissioning: string; invoicing: string; dataTrust?: string }
  plannedOn?: string | null
  payment: string
  balance: number
  dueOn?: string | null
  costsState?: string | null
  /** The supplier orders (each with one goods line): placed / expected / delivered. */
  legs: Array<{ placedOn?: string | null; expectedOn?: string | null; deliveredOn?: string | null }>
  /** Goods lines with no supplier. */
  unsourced?: number
  expected: string
}

const CASES: Case[] = [
  { name: 'goods delivered, commissioning planned later, not invoiced', role: 'sales', state: { goods: 'delivered', commissioning: 'planned', invoicing: 'not_invoiced' }, plannedOn: '2026-11-28', payment: 'unpaid', balance: 1180, legs: [{ placedOn: '2026-11-01', deliveredOn: '2026-11-15' }], expected: 'create-invoice' },
  { name: 'everything invoiced, commissioning planned later', role: 'admin', state: { goods: 'delivered', commissioning: 'planned', invoicing: 'fully_invoiced' }, plannedOn: '2026-11-28', payment: 'unpaid', balance: 1180, legs: [{ placedOn: '2026-11-01', deliveredOn: '2026-11-15' }], expected: 'commissioning-later' },
  { name: 'commissioning has no date (admin)', role: 'admin', state: { goods: 'delivered', commissioning: 'to_plan', invoicing: 'not_invoiced' }, payment: 'unpaid', balance: 1180, legs: [{ placedOn: '2026-11-01', deliveredOn: '2026-11-15' }], expected: 'plan-commissioning' },
  { name: 'commissioning has no date (engineer)', role: 'engineer', state: { goods: 'delivered', commissioning: 'to_plan', invoicing: 'not_invoiced' }, payment: 'unpaid', balance: 1180, legs: [{ placedOn: '2026-11-01', deliveredOn: '2026-11-15' }], expected: 'wait-plan' },
  { name: 'admin, paid, costs not complete', role: 'admin', state: { goods: 'delivered', commissioning: 'n_a', invoicing: 'fully_invoiced' }, payment: 'settled', balance: 0, costsState: 'provisional', legs: [{ placedOn: '2026-11-01', deliveredOn: '2026-11-15' }], expected: 'costs' },
  { name: 'sales, invoiced and counted done, payment overdue', role: 'sales', state: { lifecycle: 'done', goods: 'delivered', commissioning: 'n_a', invoicing: 'fully_invoiced' }, payment: 'overdue', balance: 500, dueOn: '2026-11-10', legs: [{ placedOn: '2026-11-01', deliveredOn: '2026-11-15' }], expected: 'chase-payment' },
  { name: 'a goods line with no supplier', role: 'admin', state: { goods: 'to_source', commissioning: 'n_a', invoicing: 'not_invoiced' }, payment: 'unpaid', balance: 1180, legs: [], unsourced: 1, expected: 'add-supplier' },
  { name: 'one supplier late, another not placed', role: 'sales', state: { goods: 'to_place', commissioning: 'n_a', invoicing: 'not_invoiced' }, payment: 'unpaid', balance: 1180, legs: [{}, { placedOn: '2026-11-01', expectedOn: '2026-11-18' }], expected: 'goods-late' },
  { name: 'on order, not late', role: 'engineer', state: { goods: 'on_order', commissioning: 'planned', invoicing: 'not_invoiced' }, plannedOn: '2026-12-01', payment: 'unpaid', balance: 1180, legs: [{ placedOn: '2026-11-01', expectedOn: '2026-11-25' }], expected: 'deliver' },
  { name: 'commissioning due, goods delivered', role: 'admin', state: { goods: 'delivered', commissioning: 'planned', invoicing: 'not_invoiced' }, plannedOn: '2026-11-19', payment: 'unpaid', balance: 1180, legs: [{ placedOn: '2026-11-01', deliveredOn: '2026-11-15' }], expected: 'mark-done' },
  { name: 'unknown price basis (admin)', role: 'admin', state: { goods: 'to_place', commissioning: 'n_a', invoicing: 'not_invoiced', dataTrust: 'basis_unknown' }, payment: 'unpaid', balance: 1180, legs: [{}], expected: 'resolve-basis' },
]

describe('the list and the page agree on the next step', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const money_ = c.role !== 'engineer'
      const legs = c.legs.map((l, i) => legRow(`l${i}`, { placedOn: l.placedOn ?? null, expectedOn: l.expectedOn ?? null, deliveredOn: l.deliveredOn ?? null, receivedOn: l.deliveredOn ?? null }))
      const items = [...legs.map((l, i) => item(`i${i}`, l.id)), ...Array.from({ length: c.unsourced ?? 0 }, (_, i) => item(`u${i}`, null))]
      const row: OrderListRow = listRow({
        lifecycle: c.state.lifecycle ?? 'active',
        goods: c.state.goods,
        commissioning: c.state.commissioning,
        dataTrust: c.state.dataTrust ?? 'ok',
        invoicing: money_ ? c.state.invoicing : null,
        gross: money_ ? 1180 : null,
        payment: money_ ? c.payment : null,
        balance: money_ ? c.balance : null,
        dueOn: money_ ? (c.dueOn ?? null) : null,
        costsState: c.role === 'admin' ? (c.costsState ?? null) : null,
        plannedOn: c.plannedOn ?? null,
        legs: legs.map(l => ({ id: l.id, supplierName: l.supplierName, placedOn: l.placedOn, expectedOn: l.expectedOn, deliveredOn: l.deliveredOn })),
      })
      const o = header(
        { needsCommissioning: c.state.commissioning !== 'n_a', plannedOn: c.plannedOn ?? null },
        { lifecycle: c.state.lifecycle ?? 'active', goods: c.state.goods, commissioning: c.state.commissioning, invoicing: c.state.invoicing, dataTrust: c.state.dataTrust ?? 'ok', invoiced: c.state.invoicing === 'fully_invoiced' ? 1180 : 0 },
      )
      const m = money({ paymentState: c.payment, balance: c.balance, dueOn: c.dueOn ?? null, costsState: c.costsState ?? 'provisional', settled: 1180 - c.balance })
      const onList = listNextStep(row, c.role, today)
      const onPage = pageStep(orderFacts(o, legs, items, [], c.role, money_ ? m : null, today))
      expect(onList.kind).toBe(c.expected)
      expect(onPage.step.kind).toBe(c.expected)
    })
  }
})
