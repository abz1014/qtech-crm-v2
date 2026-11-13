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
    /** "Lock October": one month at a time (owner decision 2026-10-22); there is no "Close through". */
    closeButton: (monthName: string) => new RegExp(`^Lock ${monthName}$`),
    /** "Go to September 2026": a month locks only while it is on screen (owner decision 2026-11-06), so with an older month open the button moves there. */
    goToButton: (label: string) => `Go to ${label}`,
    closeDialog: (label: string) => `Lock ${label}?`,
    closedBar: (label: string) => `${label} is locked.`,
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
    /** The supplier order's menu item: Pay <supplier>, the one door for a supplier payment (redesign phase 1, 0087). */
    payFor: (supplier: string) => `Pay ${supplier}`,
    /** The Pay dialog is named by the supplier. */
    dialog: (supplier: string) => `Pay ${supplier}`,
    amount: 'Amount, PKR',
    paidIn: (currency: string) => `Paid in ${currency}`,
    pkrDebited: 'PKR debited from the bank',
    bankCharges: 'Bank charges, PKR',
    supplierPayment: 'Supplier payment',
    save: 'Save payment',
    atTodaysRate: (pkr: string) => `≈ PKR ${pkr} at today's rate`,
    partPaid: 'Part paid',
  },
} as const
