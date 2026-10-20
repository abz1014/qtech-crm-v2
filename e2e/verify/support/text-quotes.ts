/* Words the verify-quotes suite looks for. Merged into text.ts at the end; import them from ./text. */
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
    newOrder: 'New order',
    heading: 'New order',
    find: 'Find a past order',
    customerPo: 'Customer PO number',
    create: 'Create order',
  },
} as const
