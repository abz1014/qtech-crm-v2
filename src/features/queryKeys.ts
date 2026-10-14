/*
 * The query-key factory (R01). Every TanStack Query key in the app is built here, never typed
 * inline in a hook or a component. Keys are hierarchical: a key is a prefix of the keys beneath it,
 * so invalidating `qk.companies.detail(id)` also refreshes that company's sites, contacts and so on.
 *
 *   qk.companies.all                  everything about companies
 *   qk.companies.lists()              every list/search of companies
 *   qk.companies.detail(id)           one company and everything hung off it
 *   qk.companies.detail(id, 'sites')  one slice of it
 *
 * Add a new area by adding a block below, not by editing another area's. Keep ids and filters as the
 * last parts of a key so prefixes stay useful. Never put a function, a Date or a class instance in a key.
 */
const root = <K extends string>(name: K) => [name] as const

function companies() {
  const all = root('companies')
  const detail = (id: string) => [...all, 'detail', id] as const
  return {
    all,
    lists: () => [...all, 'list'] as const,
    list: () => [...all, 'list', 'roster'] as const,
    search: (text: string) => [...all, 'list', 'search', text.trim().toLowerCase()] as const,
    byName: (name: string) => [...all, 'list', 'by-name', name.trim().toLowerCase()] as const,
    detail,
    /** One slice of a company. `slice` is a fixed word, so a typo is a type error. */
    part: (id: string, slice: CompanyPart) => [...detail(id), slice] as const,
  }
}
export type CompanyPart =
  | 'sites'
  | 'contacts'
  | 'brands'
  | 'role'
  | 'supplier-stats'
  | 'supplier-activity'
  | 'history'
  | 'money'

function brands() {
  const all = root('brands')
  return { all, list: () => [...all, 'list'] as const }
}

/** Reserved roots for areas that other tasks build. They exist now so the invalidation map can name them. */
function rfqs() {
  const all = root('rfqs')
  return {
    all,
    lists: () => [...all, 'list'] as const,
    /** R06: every open RFQ with its state, owner and company name. */
    board: () => [...all, 'list', 'board'] as const,
    /** R06: one page of won and closed RFQs. */
    closed: (page: number) => [...all, 'list', 'closed', page] as const,
    closedCount: () => [...all, 'list', 'closed-count'] as const,
    /** R06: palette search by number, customer ref or company. */
    search: (text: string) => [...all, 'list', 'search', text.trim().toLowerCase()] as const,
    detail: (id: string) => [...all, 'detail', id] as const,
  }
}
function orders() {
  const all = root('orders')
  return { all, lists: () => [...all, 'list'] as const, detail: (id: string) => [...all, 'detail', id] as const }
}

export const qk = {
  companies: companies(),
  brands: brands(),
  rfqs: rfqs(),
  orders: orders(),
}

export type QueryKeyRoot = keyof typeof qk
