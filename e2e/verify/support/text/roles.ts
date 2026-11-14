/** Words the verify-roles suite looks for. */
export const ROLES = {
  /** The no-access page's heading (src/app/pages/NoAccessPage.tsx): "<Area> is for admins", "Money is for admins and sales". */
  noAccess: /\bis for (admins|sales|engineers)/,
  nav: { main: 'Main' },
  navLabels: { admin: ['Home', 'Sell', 'Deliver', 'Money', 'Companies'], sales: ['Home', 'Sell', 'Deliver', 'Money', 'Companies'], engineer: ['Home', 'I paid', 'Jobs'] },
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
