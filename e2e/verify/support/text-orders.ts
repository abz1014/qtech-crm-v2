/* Words the verify-orders suite looks for. Merged into text.ts at the end; import them from ./text. */
export const ORDERS = {
  items: {
    table: 'Order items',
    footer: (lines: number) => `Order total, ${lines} ${lines === 1 ? 'line' : 'lines'}`,
    gstRate: (line: number) => `GST rate, line ${line}`,
    /** The owner rule (DECISIONS 2026-10-15): GST is 18% or exempt, nothing else. */
    allowedRates: ['0%', '18%'],
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
    more: 'More actions',
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
