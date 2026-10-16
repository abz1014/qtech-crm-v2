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
    /** R22: the RFQs Capture offers (recents and your own with open questions), with their open questions. */
    capture: (signature = '') => [...all, 'capture', signature] as const,
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
    /** R22: the RFQs Capture offers (recents and your own with open questions), with their open questions. */
    capture: (signature = '') => [...all, 'capture', signature] as const,
    /** R10: short-lived signed links for the RFQ's files; `signature` changes when the set of files does. */
    fileUrls: (id: string, signature: string) => [...detail(id), 'file-urls', signature] as const,
    /** One slice of an RFQ page (R07). `slice` is a fixed word, so a typo is a type error. */
    part: (id: string, slice: RfqPart) => [...detail(id), slice] as const,
    /** Supplier stats for the memory lines on the RFQ page, by the suppliers' ids. */
    stats: (suppliers: string) => [...all, 'stats', suppliers] as const,
    /** The signed-in person's job title and phone (chase signatures). */
    signature: (userId: string) => [...all, 'signature', userId] as const,
  }
}
/** R19 adds the quotation slices: the issued quotations, the items with their quoted prices, the price chips. */
export type RfqPart = 'header' | 'items' | 'inquiries' | 'clarifications' | 'attachments' | 'quotations' | 'quote-items' | 'price-memory'

/** Exchange rates (R07 reads today's rate per currency; R15 owns editing them). */
function fx() {
  const all = root('fx')
  return { all, latest: () => [...all, 'latest'] as const, history: (currency: string) => [...all, 'history', currency] as const }
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
  const detail = (id: string) => [...all, 'detail', id] as const
  return {
    all,
    lists: () => [...all, 'list'] as const,
    detail,
    /** One slice of an order page (O03). `slice` is a fixed word, so a typo is a type error. */
    part: (id: string, slice: OrderPart) => [...detail(id), slice] as const,
    /** O02: past orders found to start a new one from (cached a moment; the search text is part of the key). */
    past: (text: string) => [...all, 'list', 'past', text.trim().toLowerCase()] as const,
    pastOne: (id: string) => [...all, 'list', 'past-one', id] as const,
    /** O04: every order with its state dimensions, shaped by the caller's role (an engineer's has no money in it). */
    board: (role: string) => [...all, 'list', 'board', role] as const,
    /** The orders an RFQ produced (the RFQ page shows 'Open ORD-0039' once it is won). */
    forRfq: (rfqId: string) => [...all, 'list', 'for-rfq', rfqId] as const,
    /** The company's last payment terms, the default for the next order (O01). */
    lastTerms: (companyId: string) => [...all, 'list', 'last-terms', companyId] as const,
    /** Active engineers who can be put on a commissioning job. */
    engineers: () => [...all, 'list', 'engineers'] as const,
    /** The signed-in person's job title (the sign-off of a chase message). */
    /** R22: the orders Capture offers (opened lately), and its search. */
    captureRecent: () => [...all, 'list', 'capture-recent'] as const,
    captureSearch: (text: string, includePo: boolean) => [...all, 'list', 'capture-search', text.trim().toLowerCase(), includePo] as const,
    /** Suppliers a leg can be added for. */
    supplierChoices: () => [...all, 'list', 'supplier-choices'] as const,
    jobTitle: (userId: string) => [...all, 'list', 'job-title', userId] as const,
  }
}
export type OrderPart = 'header' | 'items' | 'legs' | 'engineers' | 'money' | 'pos' | 'files'

/** Settings (A04, A06): the team list (read through the admin-users function) and the one company-profile row. */
function settings() {
  const all = root('settings')
  return {
    all,
    team: () => [...all, 'team'] as const,
    profile: () => [...all, 'company-profile'] as const,
    /** The signed-in person's own users row (Your details). */
    myDetails: () => [...all, 'my-details'] as const,
    /** M06: every targets read (rows and progress); invalidate this one after any target write. */
    targets: () => [...all, 'targets'] as const,
    targetRows: (year: number) => [...all, 'targets', 'rows', year] as const,
    targetProgress: (year: number) => [...all, 'targets', 'progress', year] as const,
    /** M13: the category list with usage counts, and the active-only list new expenses choose from. */
    categories: () => [...all, 'categories'] as const,
    activeCategories: () => [...all, 'categories', 'active'] as const,
  }
}

/** Today (R11): the whole work-list input (one read), the target tile, and the draft data of the selected item. */
function today() {
  const all = root('today')
  return {
    all,
    board: () => [...all, 'board'] as const,
    target: () => [...all, 'target'] as const,
    /** Goods-chase draft: the items on one leg and the supplier's contact. */
    leg: (legId: string) => [...all, 'leg', legId] as const,
    /** Payment-reminder draft: the order's invoices, PO number and contact. */
    payment: (orderId: string) => [...all, 'payment', orderId] as const,
  }
}

/** Supplier POs (O07): the dialog's pre-fill, the supplier's last PO, a leg's latest PO and the next number. */
function purchaseOrders() {
  const all = root('purchaseOrders')
  return {
    all,
    prefill: (legId: string) => [...all, 'prefill', legId] as const,
    lastToSupplier: (supplierId: string) => [...all, 'last-to-supplier', supplierId] as const,
    leg: (legId: string) => [...all, 'leg', legId] as const,
    nextNumber: () => [...all, 'next-number'] as const,
  }
}

/** Money, expenses (M03, M11). Admin only; the hooks pass `enabled` so no one else makes the request. */
function money() {
  const all = root('money')
  const expenses = [...all, 'expenses'] as const
  return {
    all,
    expenses: {
      all: expenses,
      /** One month's list ("2026-11") with the payee and order names beside it. */
      month: (month: string) => [...expenses, 'month', month] as const,
      /** Category tally of the last 30 days; `day` keeps it from outliving the day it was read. */
      recentUse: (day: string) => [...expenses, 'recent-use', day] as const,
      lastCategory: (orderId: string) => [...expenses, 'last-category', orderId] as const,
      receipts: (expenseId: string) => [...expenses, 'receipts', expenseId] as const,
    },
    categories: () => [...all, 'expense-categories'] as const,
    /** One order's costs for the Margin panel (M04): expenses, expected cost, the supplier-price inputs. */
    orderCosts: (orderId: string) => [...all, 'order-costs', orderId] as const,
    /** Every order's margin row (M04) and the reconciliation exceptions (M07). Admin only. */
    margins: () => [...all, 'margins'] as const,
    exceptions: () => [...all, 'exceptions'] as const,
    orderOptions: () => [...all, 'order-options'] as const,
    legOptions: (orderId: string) => [...all, 'leg-options', orderId] as const,
    recurring: {
      all: [...all, 'recurring'] as const,
      list: () => [...all, 'recurring', 'list'] as const,
      recorded: (period: string) => [...all, 'recurring', 'recorded', period] as const,
    },
  }
}

/** P01: the four read-only report views. Nothing writes to them, so no write invalidates them. */
function reports() {
  const all = root('reports')
  return {
    all,
    outcomes: () => [...all, 'outcomes'] as const,
    float: () => [...all, 'float'] as const,
    turnaround: () => [...all, 'turnaround'] as const,
    repeatCustomers: () => [...all, 'repeat-customers'] as const,
  }
}

export const qk = {
  today: today(),
  settings: settings(),
  companies: companies(),
  brands: brands(),
  rfqs: rfqs(),
  orders: orders(),
  purchaseOrders: purchaseOrders(),
  intake: intake(),
  memory: memory(),
  fx: fx(),
  money: money(),
  reports: reports(),
}

export type QueryKeyRoot = keyof typeof qk
