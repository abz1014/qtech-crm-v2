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
    /** The company that sent an enquiry (a PDF or a paste), by what the text says about the sender. */
    sender: (signature: string) => [...all, 'list', 'sender', signature] as const,
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
  | 'category-evidence'
  | 'history'
  | 'money'
  | 'credit'

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
    /** The board's Value (PKR net) column: quoted net per open RFQ. Money: never requested for an engineer. */
    values: () => [...all, 'list', 'values'] as const,
    userNames: () => [...all, 'user-names'] as const,
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
    /** Every supplier-stats read: a reply added or removed changes asked/replied, so they refetch (they were stale for a minute). */
    statsAll: () => [...all, 'stats'] as const,
    /** The signed-in person's job title and phone (chase signatures). */
    signature: (userId: string) => [...all, 'signature', userId] as const,
  }
}
/** R19 adds the quotation slices: the issued quotations, the items with their quoted prices, the price chips. A8 (R25) adds the ranking of the quotes. */
export type RfqPart = 'header' | 'items' | 'inquiries' | 'clarifications' | 'attachments' | 'quotations' | 'quote-items' | 'price-memory' | 'ranking'

/** Exchange rates (R07 reads today's rate per currency; R15 owns editing them). */
function fx() {
  const all = root('fx')
  return { all, latest: () => [...all, 'latest'] as const, history: (currency: string) => [...all, 'history', currency] as const, lastAuto: () => [...all, 'last-auto'] as const }
}
/** Intake (R05): who can be asked for a price, and what each of them remembers about the items being entered. */
function intake() {
  const all = root('intake')
  return {
    all,
    suppliers: () => [...all, 'suppliers'] as const,
    /** The curated product categories (brands of kind family): the dictionary's names resolve to these. */
    categories: () => [...all, 'categories'] as const,
    /** Per-category evidence, price wins and recent asks behind the supplier ranking (C3). */
    categoryEvidence: (signature: string) => [...all, 'category-evidence', signature] as const,
    memory: (signature: string) => [...all, 'memory', signature] as const,
    /** The up to three evidence orders of one supplier for one item (the memory card). */
    evidence: (signature: string) => [...all, 'evidence', signature] as const,
    /** A kept New RFQ draft, checked before it is offered: is its RFQ already saved; are its company, site and contact on file. */
    draft: (signature: string) => [...all, 'draft', signature] as const,
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
    /** The number beside Orders in the top bar: active orders (every staff role may count them). */
    activeCount: () => [...all, 'list', 'active-count'] as const,
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
    /** A8: the ranked quotes of an RFQ for the convert dialog and the Split line dialog (the role is in the key: an engineer's rows carry no selling price). */
    ranked: (rfqId: string, role: string) => [...all, 'list', 'ranked', rfqId, role] as const,
    /** The number the next order will most likely take (shown in the convert dialog). */
    nextNumber: () => [...all, 'list', 'next-number'] as const,
    /** The supplier's median days from placed to delivered (the default expected date). */
    supplierMedian: (supplierId: string) => [...all, 'list', 'supplier-median', supplierId] as const,
    /** Every role's ranked quotes of one RFQ: what a write to that RFQ's quotes (or a rate) makes stale. */
    rankedFor: (rfqId: string) => [...all, 'list', 'ranked', rfqId] as const,
    rankedAll: () => [...all, 'list', 'ranked'] as const,
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
    /** 0110: the GST pay-by and file-by days and the one-off dates. */
    gstDeadlines: () => [...all, 'gst-deadlines'] as const,
    /** The signed-in person's own users row (Your details). */
    myDetails: () => [...all, 'my-details'] as const,
    /** M06: every targets read (rows and progress); invalidate this one after any target write. */
    targets: () => [...all, 'targets'] as const,
    targetRows: (year: number) => [...all, 'targets', 'rows', year] as const,
    targetProgress: (year: number) => [...all, 'targets', 'progress', year] as const,
    /** M13: the category list with usage counts, and the active-only list new expenses choose from. */
    categories: () => [...all, 'categories'] as const,
    activeCategories: () => [...all, 'categories', 'active'] as const,
    /** C4: the product categories (families) with their curated flag and tagged suppliers. */
    productCategories: () => [...all, 'product-categories'] as const,
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
    sentForOrder: (orderId: string) => [...all, 'sent-for-order', orderId] as const,
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
      /** The Detail field's suggestions: the details typed since `since` ("2025-11-01"). */
      details: (since: string) => [...expenses, 'details', since] as const,
      /** Every expense paid from one month to another (the Expenses report's period, 0086). */
      range: (from: string, to: string) => [...expenses, 'range', from, to] as const,
      /** 0087: engineers' "I paid" claims: 'pending' (the admin's To approve) or 'mine' (an engineer's own), and one claim's photos. */
      claims: (scope: 'pending' | 'mine') => [...expenses, 'claims', scope] as const,
      claimPhotos: (claimId: string) => [...expenses, 'claims', 'photos', claimId] as const,
      /** 0087: the office cash box (cash in hand), which every cash expense moves. */
      cash: () => [...expenses, 'cash-in-hand'] as const,
      /** 0087: what one supplier order still needs, for the Pay dialog. */
      legPay: (legId: string) => [...expenses, 'leg-pay', legId] as const,
    },
    categories: () => [...all, 'expense-categories'] as const,
    /** The expense groups (0086): the first level of the category list. */
    groups: () => [...all, 'expense-groups'] as const,
    /** Settings > Expense categories: what each category had paid in one month ("2026-10"). */
    categoryMonth: (month: string) => [...all, 'expense-categories', 'month', month] as const,
    /** M12: the bank tick for one statement month ("2026-10"). */
    bank: {
      all: [...all, 'bank'] as const,
      month: (month: string) => [...all, 'bank', month] as const,
    },
    /** One order's costs for the Margin panel (M04): expenses, expected cost, the supplier-price inputs. */
    orderCosts: (orderId: string) => [...all, 'order-costs', orderId] as const,
    /** Every order's margin row (M04) and the reconciliation exceptions (M07). Admin only. */
    margins: () => [...all, 'margins'] as const,
    exceptions: () => [...all, 'exceptions'] as const,
    /** M10: Month-end. The checklist counts, the closed months and every report for one month ("2026-10") or as-of date. */
    monthEnd: {
      all: [...all, 'month-end'] as const,
      status: (month: string) => [...all, 'month-end', 'status', month] as const,
      closed: () => [...all, 'month-end', 'closed'] as const,
      pnl: () => [...all, 'month-end', 'pnl'] as const,
      payments: (month: string) => [...all, 'month-end', 'payments', month] as const,
      expenseLines: (month: string) => [...all, 'month-end', 'expense-lines', month] as const,
      categories: (month: string) => [...all, 'month-end', 'categories', month] as const,
      aging: (asOf: string) => [...all, 'month-end', 'aging', asOf] as const,
      payables: (asOf: string) => [...all, 'month-end', 'payables', asOf] as const,
      gst: () => [...all, 'month-end', 'gst'] as const,
      team: (month: string) => [...all, 'month-end', 'team', month] as const,
      /** In vs out (0079): every month's cash in and out, and the money out by category and detail from one month to another. */
      cashFlow: () => [...all, 'month-end', 'cash-flow'] as const,
      cashOutDetail: (from: string, to: string) => [...all, 'month-end', 'cash-out-detail', from, to] as const,
    },
    orderOptions: () => [...all, 'order-options'] as const,
    legOptions: (orderId: string) => [...all, 'leg-options', orderId] as const,
    /** M01: the GST register (every invoice, all months), one invoice with its steps, the order amounts a new invoice starts from. */
    invoices: {
      all: [...all, 'invoices'] as const,
      register: () => [...all, 'invoices', 'register'] as const,
      detail: (id: string) => [...all, 'invoices', 'detail', id] as const,
      receipts: (id: string) => [...all, 'invoices', 'receipts', id] as const,
      nextNumber: () => [...all, 'invoices', 'next-number'] as const,
      forOrder: (orderId: string) => [...all, 'invoices', 'for-order', orderId] as const,
      invoiceable: () => [...all, 'invoices', 'invoiceable-orders'] as const,
    },
    /** M02: order balances through order_receivables() (admin and sales) and one order's payments (admin; 0073: voided ones included). */
    receivables: {
      all: [...all, 'receivables'] as const,
      list: () => [...all, 'receivables', 'list'] as const,
      summary: (today: string) => [...all, 'receivables', 'summary', today] as const,
      /** 0080 (owner decision 2026-10-22): advances held on cancelled, never-invoiced orders (admin). */
      held: () => [...all, 'receivables', 'held'] as const,
      order: (orderId: string) => [...all, 'receivables', 'order', orderId] as const,
      payments: (orderId: string) => [...all, 'receivables', 'payments', orderId] as const,
    },
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

/** Learnability (spec 1.1, 5.1): "has this person started yet" and the first-week checklist, all derived from existing rows. */
function onboarding() {
  const all = root('onboarding')
  return {
    all,
    /** The head-counts behind the first-use states, for one person. */
    firstUse: (userId: string) => [...all, 'first-use', userId] as const,
    /** The first-week checklist of the people on the Team page (admin view). */
    firstWeek: (people = '') => [...all, 'first-week', people] as const,
  }
}

/** The "was X, now Y" history of one record (feat/history-ui). Keyed on (table, id) so any screen can reuse it. */
function history() {
  const all = root('history')
  return { all, record: (table: string, id: string) => [...all, table, id] as const }
}

/** Jobs (redesign phase 5): the read-only view v_jobs and what one job page reads. Any write in the app makes these stale (invalidateAfter). */
function jobs() {
  const all = root('jobs')
  return {
    all,
    /** Every job with its customer and owner names (an engineer's has no money in it, and v_jobs has none for anyone). */
    list: (role: string) => [...all, 'list', role] as const,
    /** The jobs a search finds: the same function the command palette calls. */
    search: (text: string) => [...all, 'search', text.trim().toLowerCase()] as const,
    /** One job by its key ('139', 'O-45'). */
    detail: (key: string) => [...all, 'detail', key] as const,
    /** One slice of a job page. */
    part: (key: string, slice: JobPart) => [...all, 'detail', key, slice] as const,
    /** Signed links for the files on a job's page. */
    fileUrls: (signature: string) => [...all, 'file-urls', signature] as const,
  }
}
export type JobPart = 'facts' | 'cancelled' | 'invoices'

export const qk = {
  jobs: jobs(),
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
  onboarding: onboarding(),
  history: history(),
}

export type QueryKeyRoot = keyof typeof qk
