// The orders list (O04): which orders a person sees, and how the filters combine. Pure and framework-free.
//
// Filters are one per state dimension (goods, commissioning, invoicing, payment) plus the lifecycle tab (active, done, cancelled), whose
// order is mine or all (for an engineer, "mine" is the jobs they are assigned to), and a search over the order number, customer PO,
// our supplier PO numbers, customer, site and every line of what was ordered. They combine with AND. Every count is taken with all the OTHER filters applied, so the numbers on the tabs and on
// the dimension options always add up to what the rest of the page shows.
//
// A typed search is never stopped by the tab or the owner switch (UX audit 2026-10-22, area 4): orders that match it in another tab,
// or someone else's while Mine is on, come after the list's own under an "Also in Done" / "Also in Active · not yours" divider.

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

/**
 * Normalises what is typed so "ord-0038", "ORD 38" and "38" all find order 38; "PO-26-0017", "PO 0017" and "po-17" find the order that
 * supplier PO is for; and a customer PO or a name matches anywhere in it.
 */
export function matchesText(row: OrderListRow, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (!q) return true
  const num = /^(ord[-\s]*)?0*(\d{1,9})$/i.exec(q)
  if (num && row.number === Number(num[2])) return true
  const po = /^po[-\s]*(?:(\d{2})[-\s]+)?0*(\d{1,9})$/i.exec(q)
  if (po && row.poNumbers.some(ref => samePo(ref, po[1], Number(po[2])))) return true
  // a bare number is the order number (above), never a fragment of the padded ref or of a supplier PO
  const ref = `ord-${String(row.number).padStart(4, '0')}`
  const ours = q.startsWith('po') ? row.poNumbers.join(' ') : null
  return [row.customerPo, row.companyName, row.siteName, row.itemsText, q.startsWith('ord') ? ref : null, ours].some(v => (v ?? '').toLowerCase().includes(q))
}

/** "PO-26-0017" against a typed number and, when one was typed, its year. */
function samePo(ref: string, year: string | undefined, n: number): boolean {
  const m = /^PO-(\d{2})-0*(\d+)$/.exec(ref)
  return Boolean(m && Number(m[2]) === n && (!year || year === m[1]))
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

type Who = { userId: string | null; role: string }

const inScope = (r: OrderListRow, f: ListFilters, who: Who) => r.lifecycle === f.tab && (f.owner === 'all' || ownedBy(r, who.userId, who.role))

/**
 * While a search is typed: the orders that match it and the state filters but are not in this list, because they are in another tab
 * or (on Mine) someone else's. Empty with no search text: the tab and the owner switch then narrow as usual.
 */
export function otherMatches(rows: readonly OrderListRow[], f: ListFilters, who: Who): OrderListRow[] {
  if (!f.text.trim()) return []
  return filterRows(rows, { ...f, owner: 'all' }, who, 'tab').filter(r => !inScope(r, f, who))
}

/**
 * The divider a row of a search comes under, and its place (this list first, then Active, Done, Cancelled; yours before others'):
 * "In Active · yours" for the list's own rows, "Also in Done", "Also in Active · not yours".
 */
export function searchGroup(r: OrderListRow, f: ListFilters, who: Who): { key: string; label: string; rank: number } {
  const tabLabel = (t: string) => TABS.find(x => x.value === t)?.label ?? t
  const engineer = who.role === 'engineer'
  if (inScope(r, f, who)) return { key: 'here', label: `In ${tabLabel(f.tab)}${f.owner === 'mine' ? (engineer ? ' · your jobs' : ' · yours') : ''}`, rank: -1 }
  const notYours = f.owner === 'mine' && !ownedBy(r, who.userId, who.role)
  const tabIndex = Math.max(0, TABS.findIndex(x => x.value === r.lifecycle))
  return {
    key: `${r.lifecycle}:${notYours ? 'others' : 'yours'}`,
    label: `Also in ${tabLabel(r.lifecycle)}${notYours ? (engineer ? ' · not your jobs' : ' · not yours') : ''}`,
    rank: tabIndex * 2 + (notYours ? 1 : 0),
  }
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

export const hasFilters = (f: ListFilters, role: string): boolean =>
  f.owner !== defaultOwner(role) || f.goods !== ALL || f.commissioning !== ALL || f.invoicing !== ALL || f.payment !== ALL || f.text.trim() !== ''
