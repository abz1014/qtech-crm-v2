/* Words the verify-money suite looks for. Merged into text.ts at the end; import them from ./text. */
export const MONEY = {
  order: {
    createInvoice: 'Create invoice',
    recordPayment: 'Record payment',
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
