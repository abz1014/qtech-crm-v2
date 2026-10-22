/*
 * EVERY visible word the verify suites look for lives in this one file: button and field names (used with getByRole / getByLabel),
 * headings, toast and error sentences, and the way figures are printed. Selectors themselves are by role, label, test id or aria;
 * only the words come from here. When the UX branches rename a button or reword a sentence, this is the only file to change.
 *
 * Group by area. A spec imports what it needs: `import { COMMON, SALES } from '../support/text'`.
 */

/** Words used on many screens. */
export const COMMON = {
  undo: 'Undo',
  cancel: 'Cancel',
  save: 'Save',
  done: 'Done',
  signIn: 'Sign in',
  email: 'Email',
  password: 'Password',
  noAccessHeading: /no access|not available to you|you do not have access/i,
  notFound: /not found|does not exist|isn.t here/i,
  /** mapPgError's network sentence (src/lib/pgErrors.ts), shown when a save cannot reach the server. */
  network: 'Check your connection and try again. Trying again will not create a duplicate.',
  /** The month-lock trigger's sentence (P0001), passed through to the screen unchanged. */
  closedMonth: (monthLabel: string) => `${monthLabel} is closed. An admin can reopen it.`,
  nav: { today: 'Today', rfqs: 'RFQs', orders: 'Orders', companies: 'Companies', money: 'Money', reports: 'Reports' },
} as const

/*
 * How figures are printed (src/lib/money.ts formatPaisa): western thousands grouping, paisa only when non-zero, a true minus
 * sign (U+2212). Tests compute the expected figure BY HAND (in a comment) and format it with these, never with app code.
 */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** 316240 -> "316,240"; 1234.5 -> "1,234.50"; -84500 -> "−84,500". `always` keeps .00 on whole amounts. */
export function amount(n: number, opts: { always?: boolean } = {}): string {
  const paisa = Math.round(Math.abs(n) * 100)
  const whole = group(String(Math.floor(paisa / 100)))
  const cents = paisa % 100
  const frac = opts.always || cents !== 0 ? `.${String(cents).padStart(2, '0')}` : ''
  return `${n < 0 ? '−' : ''}${whole}${frac}`
}

/** "PKR 316,240" (the currency prefix the dialogs and totals print). */
export const pkr = (n: number, opts: { always?: boolean } = {}): string => `PKR ${amount(n, opts)}`

/** A regex that finds the figure anywhere in a text, whatever sits before or after it ("PKR 1,234", "Rs 1,234", "1,234 due"). */
export const figure = (n: number): RegExp => new RegExp(`(^|[^\\d,.])${amount(n).replace(/[.,]/g, m => `\\${m}`)}(?![\\d,]|\\.\\d)`)

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-10-05" -> "5 October 2026" (the chase and reminder texts). */
export const longDate = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** "2026-10-05" -> "5 Oct" (short day labels). */
export const shortDay = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1].slice(0, 3)}`

/** Words the verify-sales suite looks for. */
export const SALES = {
  intake: {
    path: '/rfqs/new',
    heading: 'New RFQ',
    company: 'Company',
    description: (n: number) => `Description of item ${n}`,
    quantity: (n: number) => `Quantity of item ${n}`,
    anyDescription: /^Description of item \d+$/,
    found: (items: number, lines: number) => `${items} ${items === 1 ? 'item' : 'items'} found in ${lines} ${lines === 1 ? 'line' : 'lines'}`,
    saveOnly: "Save for later (don't ask suppliers yet)",
    saved: /is saved/,
    /** BUG-SALES-3: a second paste of the same lines (src/features/rfqs/lib/skipRepeats.ts repeatedNote). */
    alreadyThere: (n: number) => `${n} ${n === 1 ? 'line was' : 'lines were'} already there`,
  },
  ask: {
    toAskSlot: 'suppliers-to-ask',
    copyFor: (n: number) => `Copy message for ${n} ${n === 1 ? 'supplier' : 'suppliers'}`,
    copied: 'Message copied',
    /** The enquiry's reply line (src/features/rfqs/lib/enquiryDraft.ts); WhatsApp puts the date in *bold*. */
    replyBy: (day: string) => new RegExp(`Kindly reply by \\*?${day}\\*?\\.`),
    itemLine: (description: string, qty: string) => `${description}, ${qty}`,
  },
  reply: {
    price: (item: number, supplier: string) => `Price for item ${item} from ${supplier}`,
    save: 'Save reply',
    saved: 'Reply saved',
    eurUsual: /EUR, usual for Germany/,
  },
  won: {
    markWon: 'Mark won',
    heading: 'Mark won',
    supplierFor: (line: number) => `Supplier for line ${line}`,
  },
} as const

/** Words the verify-quotes suite looks for. */
export const QUOTES = {
  issue: {
    open: /Issue/,
    itemsList: 'Items to quote',
    price: (n: number) => `Unit price, net PKR, item ${n}`,
    gstRate: (n: number) => `GST rate, item ${n}`,
    issue: 'Issue quotation',
    done: 'Done',
  },
  won: {
    markWon: 'Mark won',
    heading: 'Mark won',
    createOrder: 'Create order',
  },
  close: {
    menu: 'More',
    closedToast: 'Closed',
    /** src/features/rfqs/lib/closeDefaults.ts CLOSE_REASONS: the stored key and the words on the menu. */
    reasons: [
      ['competitor', 'The customer chose a competitor'],
      ['price', 'Price too high'],
      ['no_reply_to_clarification', 'No reply to our questions'],
      ['customer_cancelled', 'The customer cancelled'],
      ['could_not_source', 'We could not source it'],
      ['we_were_late', 'We were too late'],
      ['other', 'Another reason'],
    ] as const,
  },
  repeat: {
    ordersPath: '/orders?owner=all',
    /** Was "New order" until the plain-words decision of 2026-10-19 (src/features/orders/NewOrderDialog.tsx). */
    newOrder: 'Repeat a past order',
    heading: 'Repeat a past order',
    find: 'Find a past order',
    customerPo: 'Customer PO number',
    create: 'Create order',
  },
} as const

/** Words the verify-orders suite looks for. */
export const ORDERS = {
  items: {
    table: 'Order items',
    footer: (lines: number) => `Total before GST, ${lines} ${lines === 1 ? 'line' : 'lines'}`,
    /** The bar under the table: "GST … · Total with GST …". */
    gstSummary: 'items-gst-summary',
    /** The per-line controls (GST select, Service, Split) are behind this toggle. */
    edit: 'Edit GST and lines',
    gstRate: (line: number) => `GST rate, line ${line}`,
    /** The owner rule (DECISIONS 2026-10-15): GST is 18% or exempt, nothing else. */
    allowedRates: ['18%', 'Exempt'],
  },
  commissioning: {
    region: 'Commissioning',
    edit: 'Edit',
    needs: 'This order needs commissioning',
    plannedOn: 'Planned on',
    assign: 'Assign an engineer',
    save: 'Save',
    markDone: 'Mark done today',
  },
  cancel: {
    more: /^More( actions)?$/,
    cancel: 'Cancel order',
    reopen: 'Reopen order',
    reason: 'The customer cancelled the PO',
  },
  today: {
    path: '/today',
    heading: 'Today',
    loaded: /\d+ due now/,
  },
  invoice: {
    create: 'Create invoice',
    dialog: 'Create invoice',
  },
  exceptions: {
    path: '/money/exceptions',
    list: 'Exceptions',
    paymentOnCancelled: 'Payment on a cancelled order',
  },
} as const

/** Words the verify-money suite looks for. */
export const MONEY = {
  order: {
    createInvoice: 'Create invoice',
    recordPayment: 'Record payment',
    /** The order's More menu: Record payment lives there once nothing is owed (an advance, more than is owed; UX audit P2). */
    more: /^More( actions)?$/,
  },
  invoice: {
    dialog: 'Create invoice',
    number: 'Invoice number',
    create: 'Create invoice',
    editAmounts: /Edit the amounts/,
    net: 'Net amount, PKR',
    gstMixed: 'GST, from the lines',
    gst18: 'GST, 18%',
    gross: 'Gross',
    created: (n: string) => `Created invoice ${n}`,
    termsDays: (d: number) => `${d} days from invoice`,
    defaultTerms: '(default terms)',
    whatIsLeft: 'what is left to invoice',
    fullyInvoiced: 'Every line of this order is already invoiced',
    /** The Invoicing cell (src/features/orders/OrderHeaderBlock.tsx) once the order is fully invoiced: Create invoice is gone. */
    invoicedTestId: 'order-invoiced',
  },
  payment: {
    dialog: 'Record payment',
    amount: 'Amount received, PKR',
    save: 'Save payment',
    /** The grey note under the amount (src/features/money/payments/model.ts paymentNote; figures without trailing paisa zeros). */
    part: (paid: string, gross: string, left: string) => `A part payment: PKR ${paid} of ${gross} gross. PKR ${left} will still be due.`,
    settlesAfter: (paid: string, gross: string, prior: string) => `This settles the order: PKR ${paid} of ${gross} gross, after the payment of ${prior}`,
    over: (extra: string) => `This is PKR ${extra} more than the balance due on this order.`,
    recorded: 'Recorded payment',
  },
  receivables: {
    path: '/money/receivables',
    recordFor: (orderRef: string) => `Record payment for ${orderRef}`,
  },
  register: {
    path: '/money/gst-register',
  },
  exceptions: {
    path: '/money/exceptions',
    list: 'Exceptions',
    overpaid: 'Payments exceed total',
    invoicedOver: 'Invoiced exceeds order',
  },
  reminder: {
    copy: 'Copy and mark reminded',
    undo: 'Undo',
    invoice: (n: string) => `Sales Tax Invoice ${n}`,
    balance: (b: string) => `outstanding balance of PKR ${b}`,
    afterPayment: (p: string) => `(after your payment of PKR ${p})`,
    fellDue: (due: string, days: number) => `It fell due on ${due}, ${days} days ago.`,
    recorded: /Reminder 1 recorded today/,
  },
} as const

/** Words the verify-books suite looks for. */
export const BOOKS = {
  monthEnd: {
    checklist: (month: string) => `/money/month-end?month=${month}`,
    pnl: (month: string) => `/money/month-end/pnl?month=${month}`,
    categories: (month: string) => `/money/month-end/categories?month=${month}`,
    gst: (month: string) => `/money/month-end/gst?month=${month}`,
    team: (month: string) => `/money/month-end/team?month=${month}`,
    aging: (month: string, asOf: string) => `/money/month-end/aging?month=${month}&asof=${asOf}`,
    owe: (month: string) => `/money/month-end/owe?month=${month}`,
    /** "Close October": one month at a time (owner decision 2026-10-22); there is no "Close through". */
    closeButton: (monthName: string) => new RegExp(`^Close ${monthName}$`),
    closeDialog: (label: string) => `Close ${label}?`,
    closedBar: (label: string) => `${label} is closed.`,
    reopenButton: (label: string) => `Reopen ${label}`,
    reopenDialog: (label: string) => `Reopen ${label}?`,
    reopenConfirm: (monthName: string) => `Reopen ${monthName}`,
    /** src/features/money/monthEnd/model.ts, the uncategorised check's label. */
    uncategorisedLabel: 'Expenses without a category',
  },
  pnl: {
    sumBar: 'Profit and loss',
    netIn: 'Received after GST',
    result: 'Profit',
    afterDrawings: 'After drawings',
  },
  reports: {
    exportCsv: 'Export CSV',
  },
  margin: {
    panel: 'Margin',
    provisionalNoExpected: 'Counts only what is paid so far.',
    final: 'Final: costs complete.',
    markComplete: 'Mark costs complete',
    reopenCosts: 'Reopen costs',
    markedToast: 'Costs marked complete',
    reopenedToast: 'Costs reopened',
    marginsPath: '/money/margins',
    openOrder: (ref: string) => `Open ${ref}`,
  },
  owe: {
    moreFor: (supplier: string) => `More for ${supplier}`,
    /** The supplier order's menu item for its one Add expense (Supplier payment, the supplier as payee). */
    payFor: (supplier: string) => `Pay ${supplier}`,
    dialog: 'Add expense',
    amount: 'Amount, PKR',
    category: 'Category',
    supplierPayment: 'Supplier payment',
    save: 'Save expense',
    atTodaysRate: (pkr: string) => `≈ PKR ${pkr} at today's rate`,
    partPaid: 'Part paid',
  },
} as const

/** Words the verify-admin suite looks for. */
export const ADMIN = {
  profile: {
    path: '/settings/company',
    legalName: 'Legal name',
    ntn: 'NTN',
    validity: 'Quotation validity',
    defaultTerms: 'Default payment terms',
    save: 'Save changes',
  },
  rates: {
    path: '/settings/exchange-rates',
    currency: 'Currency',
    rate: 'Rate, PKR for 1 unit',
    save: 'Save rate',
  },
  quote: {
    open: /Issue/,
    price: (n: number) => `Unit price, net PKR, item ${n}`,
    issue: 'Issue quotation',
  },
} as const

/** Words the verify-roles suite looks for. */
export const ROLES = {
  /** The no-access page's heading (src/app/pages/NoAccessPage.tsx): "<Area> is for admins", "Money is for admins and sales". */
  noAccess: /\bis for (admins|sales|engineers)/,
  nav: { main: 'Main' },
  navLabels: { admin: ['Today', 'RFQs', 'Orders', 'Companies', 'Money'], sales: ['Today', 'RFQs', 'Orders', 'Companies', 'Money'], engineer: ['Today', 'RFQs', 'Orders', 'Companies'] },
  order: {
    recordPayment: 'Record payment',
    createInvoice: 'Create invoice',
    marginPanel: 'Margin',
    /** The Invoicing cell's figure in the header's status strip (the old "Invoices and payments" panel was folded into it). */
    invoicedTestId: 'order-invoiced',
    issuePo: /^Issue PO/,
    items: 'Items',
  },
  rfq: {
    spread: /Spread/,
    markWon: 'Mark won',
  },
  search: {
    open: 'Search',
  },
} as const

/** Words the verify-resilience suite looks for. */
export const RESILIENCE = {
  tryAgain: 'Try again',
  undo: /^Undo/,
  order: {
    /** `more`: the order's More menu, where Record payment lives before an invoice (an advance; UX audit P2). */
    actions: { createInvoice: 'Create invoice', recordPayment: 'Record payment', more: /^More( actions)?$/ },
    invoiceDialog: 'Create invoice',
    createInvoice: 'Create invoice',
    paymentDialog: 'Record payment',
    amount: 'Amount received, PKR',
    savePayment: 'Save payment',
    /** Supplier orders are named by the supplier on screen (no leg letters since the UX merges). */
    moreFor: (supplier: string) => `More for ${supplier}`,
    /** Admin and sales with no PO yet: Issue PO is the button, and placing without a PO is in the menu. */
    markPlacedNoPo: 'Mark placed, no PO',
    deliveredToday: (supplier: string) => `Delivered today, ${supplier}`,
    issuePoFor: (supplier: string) => `Issue PO, ${supplier}`,
    issuePoDialog: 'Issue purchase order',
    issuePo: 'Issue PO',
  },
  rfq: {
    markWon: 'Mark won',
    wonDialog: 'Mark won',
    createOrder: 'Create order',
    openOrder: /Open ORD-\d{4}/,
    /** With one supplier to chase, the Suppliers asked card offers the chase text and this button (src/features/rfqs/SuppliersAsked.tsx). */
    chaseSlot: 'suppliers-asked',
    chaseCopy: 'Copy and mark chased',
    chaseCopied: 'Chase text copied',
  },
  company: {
    path: '/companies',
    newCompany: 'New company',
    dialog: 'New company',
    name: /Company name/,
    add: 'Add company',
  },
  expense: {
    /** Money > Expenses opens the one Add expense dialog with ?add=1 (its own button now opens the burst sheet). */
    path: '/money/expenses?add=1',
    add: 'Add expense',
    dialog: 'Add expense',
    amount: 'Amount, PKR',
    note: 'Detail',
    save: 'Save expense',
  },
  signIn: {
    email: 'Email',
    password: 'Password',
    button: 'Sign in',
  },
} as const
