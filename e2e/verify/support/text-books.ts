/* Words the verify-books suite looks for. Merged into text.ts at the end; import them from ./text. */
export const BOOKS = {
  monthEnd: {
    checklist: (month: string) => `/money/month-end?month=${month}`,
    pnl: (month: string) => `/money/month-end/pnl?month=${month}`,
    categories: (month: string) => `/money/month-end/categories?month=${month}`,
    gst: (month: string) => `/money/month-end/gst?month=${month}`,
    team: (month: string) => `/money/month-end/team?month=${month}`,
    aging: (month: string, asOf: string) => `/money/month-end/aging?month=${month}&asof=${asOf}`,
    owe: (month: string) => `/money/month-end/owe?month=${month}`,
    /** "Close October" or "Close through October" (the screen picks one from the months with money in them). */
    closeButton: (monthName: string) => new RegExp(`^Close (through )?${monthName}$`),
    closeDialog: (label: string) => `Close ${label}?`,
    closedBar: (label: string) => `${label} is closed.`,
    reopenButton: (label: string) => `Reopen ${label}`,
    reopenDialog: (label: string) => `Reopen ${label}?`,
    reopenConfirm: (monthName: string) => `Reopen ${monthName}`,
  },
  pnl: {
    sumBar: 'Profit and loss',
    netIn: 'Net in',
    result: 'Result',
    afterDrawings: 'After drawings',
  },
  reports: {
    exportCsv: 'Export CSV',
  },
  margin: {
    panel: 'Margin',
    provisionalNoExpected: 'Provisional. No expected cost is set, so only costs paid so far are counted. It becomes final when you mark costs complete.',
    final: 'Final. Costs are marked complete.',
    markComplete: 'Mark costs complete',
    reopenCosts: 'Reopen costs',
    markedToast: 'Costs marked complete',
    reopenedToast: 'Costs reopened',
    marginsPath: '/money/margins',
    openOrder: (ref: string) => `Open ${ref}`,
  },
  owe: {
    addExpenseOnLeg: (letter: string) => `Add expense, leg ${letter}`,
    dialog: 'Add expense',
    amount: 'Amount, PKR',
    category: 'Category',
    supplierPayment: 'Supplier payment',
    save: 'Save expense',
    atTodaysRate: (pkr: string) => `≈ PKR ${pkr} at today's rate`,
    partPaid: 'Part paid',
  },
} as const
