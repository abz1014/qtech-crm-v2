/** Words the verify-quotes suite looks for. */
export const QUOTES = {
  issue: {
    open: 'Send quotation',
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
      ['we_were_late', 'Quotation was late'],
      ['other', 'Another reason'],
    ] as const,
  },
  repeat: {
    /** + New, Order without enquiry: the dialog opens by itself on the Jobs list. */
    ordersPath: '/jobs?new=1',
    /** Was "New order" until the plain-words decision of 2026-10-19 (src/features/orders/NewOrderDialog.tsx). */
    newOrder: 'Repeat a past order',
    heading: 'Repeat a past order',
    find: 'Find a past order',
    customerPo: 'Customer PO number',
    create: 'Create order',
  },
} as const
