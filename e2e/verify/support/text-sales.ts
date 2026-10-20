/* Words the verify-sales suite looks for. Merged into text.ts at the end; import them from ./text. */
export const SALES = {
  intake: {
    path: '/rfqs/new',
    heading: 'New RFQ',
    company: 'Company',
    description: (n: number) => `Description of item ${n}`,
    quantity: (n: number) => `Quantity of item ${n}`,
    anyDescription: /^Description of item \d+$/,
    found: (items: number, lines: number) => `${items} ${items === 1 ? 'item' : 'items'} found in ${lines} ${lines === 1 ? 'line' : 'lines'}`,
    saveOnly: 'Save without floating',
    saved: /is saved/,
  },
  ask: {
    toAskSlot: 'suppliers-to-ask',
    copyFor: (n: number) => `Copy enquiry for ${n} supplier${n === 1 ? '' : 's'}`,
    copied: 'Enquiry text copied',
    /** The enquiry's reply line (src/features/rfqs/lib/enquiryDraft.ts); WhatsApp puts the date in *bold*. */
    replyBy: (day: string) => new RegExp(`Kindly reply by \\*?${day}\\*?\\.`),
    itemLine: (description: string, qty: string) => `${description}, ${qty}`,
  },
  reply: {
    price: (item: number, supplier: string) => `Price for item ${item} from ${supplier}`,
    save: 'Save reply',
    saved: 'Reply saved',
    eurUsual: /EUR, usual for Germany/,
  },
  won: {
    markWon: 'Mark won',
    heading: 'Mark won',
    supplierFor: (line: number) => `Supplier for line ${line}`,
  },
} as const
