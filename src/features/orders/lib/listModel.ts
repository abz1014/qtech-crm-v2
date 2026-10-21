// The orders list (O04): which orders a person sees, and how the filters combine. Pure and framework-free.
//
// Filters are one per state dimension (goods, commissioning, invoicing, payment) plus the lifecycle tab (active, done, cancelled), whose
// order is mine or all (for an engineer, "mine" is the jobs they are assigned to), and a search over the order number, customer PO,
// customer, site and the first lines of what was ordered. They combine with AND. Every count is taken with all the OTHER filters applied, so the numbers on the tabs and on
// the dimension options always add up to what the rest of the page shows.

import type { OrderListRow } from '@/features/orders/api'

export type Tab = 'active' | 'done' | 'cancelled'
export type OwnerFilter = 'mine' | 'all'
export const ALL = 'all'

export interface ListFilters {
  tab: Tab
  owner: OwnerFilter
  goods: string
  commissioning: string
  invoicing: string
  payment: string
  text: string
}

export const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const isTab = (v: string | null): v is Tab => TABS.some(t => t.value === v)

/** Mine is the default for sales and for an engineer (their jobs); admin starts on all. */
export function defaultOwner(role: string): OwnerFilter {
  return role === 'sales' || role === 'engineer' ? 'mine' : 'all'
}

export function emptyFilters(role: string): ListFilters {
  return { tab: 'active', owner: defaultOwner(role), goods: ALL, commissioning: ALL, invoicing: ALL, payment: ALL, text: '' }
}

/** Normalises what is typed so "ord-0038", "ORD 38" and "38" all find order 38, and a PO or a name matches anywhere in it. */
export function matchesText(row: OrderListRow, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (!q) return true
  const num = /^(ord[-\s]*)?0*(\d{1,9})$/i.exec(q)
  if (num && row.number === Number(num[2])) return true
  // a bare number is the order number (above), never a fragment of the padded ref
  const ref = `ord-${String(row.number).padStart(4, '0')}`
  return [row.customerPo, row.companyName, row.siteName, row.itemsText, q.startsWith('ord') ? ref : null].some(v => (v ?? '').toLowerCase().includes(q))
}

export function ownedBy(row: OrderListRow, userId: string | null, role: string): boolean {
  if (!userId) return false
  return role === 'engineer' ? row.engineerIds.includes(userId) : row.ownerId === userId
}

type Skip = 'tab' | 'goods' | 'commissioning' | 'invoicing' | 'payment' | 'owner' | 'text' | null

/** The rows that pass every filter except the one named in `skip` (used for counts). */
export function filterRows(rows: readonly OrderListRow[], f: ListFilters, who: { userId: string | null; role: string }, skip: Skip = null): OrderListRow[] {
  return rows.filter(
    r =>
      (skip === 'tab' || r.lifecycle === f.tab) &&
      (skip === 'owner' || f.owner === 'all' || ownedBy(r, who.userId, who.role)) &&
      (skip === 'goods' || f.goods === ALL || r.goods === f.goods) &&
      (skip === 'commissioning' || f.commissioning === ALL || r.commissioning === f.commissioning) &&
      (skip === 'invoicing' || f.invoicing === ALL || r.invoicing === f.invoicing) &&
      (skip === 'payment' || f.payment === ALL || r.payment === f.payment) &&
      (skip === 'text' || matchesText(r, f.text)),
  )
}

export function tabCounts(rows: readonly OrderListRow[], f: ListFilters, who: { userId: string | null; role: string }): Record<Tab, number> {
  const base = filterRows(rows, f, who, 'tab')
  return { active: base.filter(r => r.lifecycle === 'active').length, done: base.filter(r => r.lifecycle === 'done').length, cancelled: base.filter(r => r.lifecycle === 'cancelled').length }
}

export type Dimension = 'goods' | 'commissioning' | 'invoicing' | 'payment'

/** How many rows each value of a dimension would show, with every other filter applied. */
export function dimensionCounts(rows: readonly OrderListRow[], dim: Dimension, f: ListFilters, who: { userId: string | null; role: string }): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of filterRows(rows, f, who, dim)) {
    const v = r[dim]
    if (v) out.set(v, (out.get(v) ?? 0) + 1)
  }
  return out
}

/** Dimensions in the order a person works them: the first value is the one that most needs attention. */
export const DIMENSION_VALUES: Record<Dimension, readonly string[]> = {
  goods: ['to_source', 'to_place', 'late', 'on_order', 'partly_delivered', 'received', 'delivered', 'n_a'],
  commissioning: ['to_plan', 'planned', 'done', 'n_a'],
  invoicing: ['not_invoiced', 'part', 'fully_invoiced'],
  payment: ['overdue', 'unpaid', 'part', 'settled'],
}

/** A dimension value read from the address: anything not in DIMENSION_VALUES (an old link, a typo) means no filter. */
export function dimensionParam(dim: Dimension, raw: string | null): string {
  return raw !== null && DIMENSION_VALUES[dim].includes(raw) ? raw : ALL
}

export const hasFilters = (f: ListFilters, role: string): boolean =>
  f.owner !== defaultOwner(role) || f.goods !== ALL || f.commissioning !== ALL || f.invoicing !== ALL || f.payment !== ALL || f.text.trim() !== ''
