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
    chaseCopy: 'Copy and record follow-up',
    chaseCopied: 'Follow-up text copied',
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
