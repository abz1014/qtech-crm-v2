/* Words the verify-roles suite looks for. Merged into text.ts at the end; import them from ./text. */
export const ROLES = {
  /** The no-access page's heading (src/app/pages/NoAccessPage.tsx): "<Area> is for admins", "Money is for admins and sales". */
  noAccess: /\bis for (admins|sales|engineers)/,
  nav: { main: 'Main' },
  navLabels: { admin: ['Today', 'RFQs', 'Orders', 'Companies', 'Money', 'Reports'], sales: ['Today', 'RFQs', 'Orders', 'Companies', 'Money', 'Reports'], engineer: ['Today', 'RFQs', 'Orders', 'Companies'] },
  order: {
    recordPayment: 'Record payment',
    createInvoice: 'Create invoice',
    marginPanel: 'Margin',
    invoicesPanel: 'Invoices and payments',
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
