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
    path: '/todo',
    heading: 'To do',
    loaded: /\d+ need you/,
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
