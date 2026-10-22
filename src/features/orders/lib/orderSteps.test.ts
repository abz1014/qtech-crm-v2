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

describe('imported orders wait for a review (owner decision 1b)', () => {
  const NO_BIG_COUNT = /\b([3-9]\d|\d{3,}) days (overdue|late)\b/
  const legs = [legRow('a', { placedOn: '2025-01-01', expectedOn: '2025-02-01' })]
  const items = [item('1', 'a')]
  const imp = header({ imported: true }, { goods: 'late' })

  it('an imported order with open work is "Imported, to review", grey, with no button, on the list and the page', () => {
    const p = pageStep(orderFacts(imp, legs, items, [], 'admin', money(), '2026-11-20'))
    expect(p.step).toMatchObject({ kind: 'review-imported', tone: 'inert', rank: 60 })
    expect(p.primary).toBeNull()
    expect(p.text).toBe('Imported, to review')
    const l = listNextStep(listRow({ imported: true, goods: 'late', legs: [{ id: 'a', supplierName: 'S', placedOn: '2025-01-01', expectedOn: '2025-02-01', deliveredOn: null }] }), 'sales', '2026-11-20')
    expect(l).toMatchObject({ kind: 'review-imported', text: 'Imported, to review', tone: 'inert' })
    expect(`${p.text} ${l.text}`).not.toMatch(NO_BIG_COUNT)
  })

  it('an unpaid overdue invoice still gives chase-payment, and never prints a count over 30 days', () => {
    const m = money({ paymentState: 'overdue', dueOn: '2025-03-01', balance: 500 })
    const p = pageStep(orderFacts(imp, legs, items, [], 'admin', m, '2026-11-20'))
    expect(p.step.kind).toBe('chase-payment')
    expect(p.text).toContain('since 1 Mar 2025')
    expect(p.text).not.toMatch(NO_BIG_COUNT)
    const l = listNextStep(listRow({ imported: true, payment: 'overdue', balance: 500, dueOn: '2025-03-01' }), 'admin', '2026-11-20')
    expect(l.kind).toBe('chase-payment')
    expect(l.text).not.toMatch(NO_BIG_COUNT)
  })

  it('old late goods on a non-imported order say "since <date>", not a big count', () => {
    const p = pageStep(orderFacts(header({}, { goods: 'late' }), legs, items, [], 'admin', money(), '2026-11-20'))
    expect(p.text).not.toMatch(NO_BIG_COUNT)
    expect(p.text).toContain('since 1 Feb 2025')
  })

  it('a v2 order 5 days late keeps its normal step and tone', () => {
    const late = [legRow('a', { placedOn: '2026-11-01', expectedOn: '2026-11-15' })]
    const p = pageStep(orderFacts(header({}, { goods: 'late' }), late, items, [], 'admin', money(), '2026-11-20'))
    expect(p.step).toMatchObject({ kind: 'goods-late', tone: 'now' })
    expect(p.text).toContain('5 days late')
    const m = money({ paymentState: 'overdue', dueOn: '2026-11-15', balance: 500 })
    const c = pageStep(orderFacts(header(), late.map(l => ({ ...l, deliveredOn: '2026-11-16' })), items, [], 'admin', m, '2026-11-20'))
    expect(c.step).toMatchObject({ kind: 'chase-payment', tone: 'late' })
    expect(c.text).toContain('5 days overdue')
  })

  it('an engineer sees the review step too, and no price', () => {
    const p = pageStep(orderFacts(imp, legs, items, [], 'engineer', null, '2026-11-20'))
    expect(p.step.kind).toBe('review-imported')
    expect(p.text).not.toMatch(/PKR/)
  })
})
