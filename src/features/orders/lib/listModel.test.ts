import { describe, expect, it } from 'vitest'
import type { OrderListRow } from '@/features/orders/api'
import { ALL, dimensionCounts, emptyFilters, filterRows, hasFilters, matchesText, tabCounts, type ListFilters } from '@/features/orders/lib/listModel'

const row = (over: Partial<OrderListRow>): OrderListRow => ({
  id: 'o',
  number: 1,
  customerPo: null,
  orderedOn: '2026-11-01',
  ownerId: 'u-sales',
  ownerName: 'Ayesha',
  companyId: 'c',
  companyName: 'Punjab Cement Ltd',
  siteName: 'Hub plant',
  lifecycle: 'active',
  goods: 'on_order',
  commissioning: 'n_a',
  dataTrust: 'ok',
  invoicing: 'not_invoiced',
  gross: 1000,
  payment: 'unpaid',
  balance: 1000,
  engineerIds: [],
  ...over,
})

const rows: OrderListRow[] = [
  row({ id: 'a', number: 38, customerPo: '253074', goods: 'to_place', commissioning: 'planned', engineerIds: ['u-eng'] }),
  row({ id: 'b', number: 39, companyName: 'Faisalabad Textile Mills', siteName: null, goods: 'late', invoicing: 'part', payment: 'overdue', ownerId: 'u-other' }),
  row({ id: 'c', number: 40, goods: 'delivered', commissioning: 'done', invoicing: 'fully_invoiced', payment: 'settled', lifecycle: 'done' }),
  row({ id: 'd', number: 41, lifecycle: 'cancelled', goods: 'to_place' }),
]
const sales = { userId: 'u-sales', role: 'sales' }
const f = (over: Partial<ListFilters> = {}): ListFilters => ({ ...emptyFilters('admin'), ...over })
const ids = (rs: OrderListRow[]) => rs.map(r => r.id)

describe('orders list filters (O04)', () => {
  it('starts on Mine for sales and for an engineer, All for admin', () => {
    expect(emptyFilters('sales').owner).toBe('mine')
    expect(emptyFilters('engineer').owner).toBe('mine')
    expect(emptyFilters('admin').owner).toBe('all')
    expect(hasFilters(emptyFilters('sales'), 'sales')).toBe(false)
    expect(hasFilters(f({ goods: 'late' }), 'admin')).toBe(true)
  })

  it('the tab is the lifecycle, and the owner switch narrows by owner (sales) or by assignment (engineer)', () => {
    expect(ids(filterRows(rows, f(), sales))).toEqual(['a', 'b'])
    expect(ids(filterRows(rows, f({ owner: 'mine' }), sales))).toEqual(['a'])
    expect(ids(filterRows(rows, f({ tab: 'done' }), sales))).toEqual(['c'])
    expect(ids(filterRows(rows, f({ tab: 'cancelled' }), sales))).toEqual(['d'])
    expect(ids(filterRows(rows, f({ owner: 'mine' }), { userId: 'u-eng', role: 'engineer' }))).toEqual(['a'])
  })

  it('combines a filter per dimension with AND', () => {
    expect(ids(filterRows(rows, f({ goods: 'late' }), sales))).toEqual(['b'])
    expect(ids(filterRows(rows, f({ goods: 'late', payment: 'overdue' }), sales))).toEqual(['b'])
    expect(ids(filterRows(rows, f({ goods: 'late', payment: 'settled' }), sales))).toEqual([])
    expect(ids(filterRows(rows, f({ commissioning: 'planned', invoicing: 'not_invoiced' }), sales))).toEqual(['a'])
    expect(ids(filterRows(rows, f({ invoicing: 'part', goods: ALL }), sales))).toEqual(['b'])
  })

  it('finds an order by number in any spelling, by customer PO, customer or site', () => {
    expect(matchesText(rows[0], '38')).toBe(true)
    expect(matchesText(rows[0], 'ORD-0038')).toBe(true)
    expect(matchesText(rows[0], 'ord 38')).toBe(true)
    expect(matchesText(rows[0], '9')).toBe(false)
    expect(matchesText(rows[0], '2530')).toBe(true)
    expect(matchesText(rows[0], 'cement')).toBe(true)
    expect(matchesText(rows[0], 'hub')).toBe(true)
    expect(matchesText(rows[1], 'hub')).toBe(false)
    expect(ids(filterRows(rows, f({ text: 'faisalabad' }), sales))).toEqual(['b'])
  })

  it('counts every tab and every dimension value with all the other filters applied', () => {
    expect(tabCounts(rows, f(), sales)).toEqual({ active: 2, done: 1, cancelled: 1 })
    expect(tabCounts(rows, f({ goods: 'to_place' }), sales)).toEqual({ active: 1, done: 0, cancelled: 1 })
    const goods = dimensionCounts(rows, 'goods', f({ payment: 'unpaid' }), sales)
    expect(goods.get('to_place')).toBe(1)
    expect(goods.get('late')).toBeUndefined()
    // the dimension's own filter is not applied to its own counts, so you can see what switching it would give
    expect(dimensionCounts(rows, 'goods', f({ goods: 'late' }), sales).get('to_place')).toBe(1)
  })

  it('an engineer has no money values to filter on', () => {
    const eng = rows.map(r => ({ ...r, invoicing: null, payment: null, gross: null, balance: null }))
    expect(ids(filterRows(eng, f({ payment: 'overdue' }), sales))).toEqual([])
    expect(dimensionCounts(eng, 'payment', f(), sales).size).toBe(0)
  })
})
