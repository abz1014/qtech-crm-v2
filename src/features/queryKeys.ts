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
  | 'supplier-record'
  | 'supplier-brand-quotes'
  | 'history'
  | 'money'

function brands() {
  const all = root('brands')
  return { all, list: () => [...all, 'list'] as const }
}

/** Reserved roots for areas that other tasks build. They exist now so the invalidation map can name them. */
function rfqs() {
  const all = root('rfqs')
  const detail = (id: string) => [...all, 'detail', id] as const
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
    detail,
    /** One slice of an RFQ page (R07). `slice` is a fixed word, so a typo is a type error. */
    part: (id: string, slice: RfqPart) => [...detail(id), slice] as const,
  }
}
export type RfqPart = 'header' | 'items' | 'inquiries'

/** Exchange rates (R07 reads today's rate per currency; R15 owns editing them). */
function fx() {
  const all = root('fx')
  return { all, latest: () => [...all, 'latest'] as const }
}
/** Intake (R05): who can be asked for a price, and what each of them remembers about the items being entered. */
function intake() {
  const all = root('intake')
  return {
    all,
    suppliers: () => [...all, 'suppliers'] as const,
    memory: (signature: string) => [...all, 'memory', signature] as const,
  }
}
/**
 * "Last price for this item" on an RFQ page (R17). Its own root on purpose: it leaves the open RFQ out of its own memory, so
 * saving a reply on that RFQ changes nothing in it, and it must not be refetched by every write the RFQ page makes.
 */
function memory() {
  const all = root('memory')
  return { all, rfq: (rfqId: string, signature: string) => [...all, 'rfq', rfqId, signature] as const }
}
function orders() {
  const all = root('orders')
  return { all, lists: () => [...all, 'list'] as const, detail: (id: string) => [...all, 'detail', id] as const }
}

/** Settings (A04, A06): the team list (read through the admin-users function) and the one company-profile row. */
function settings() {
  const all = root('settings')
  return { all, team: () => [...all, 'team'] as const, profile: () => [...all, 'company-profile'] as const }
}

export const qk = {
  settings: settings(),
  companies: companies(),
  brands: brands(),
  rfqs: rfqs(),
  orders: orders(),
  intake: intake(),
  memory: memory(),
  fx: fx(),
}

export type QueryKeyRoot = keyof typeof qk
