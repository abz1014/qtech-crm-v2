/** Words the verify-sales suite looks for. */
export const SALES = {
  intake: {
    path: '/rfqs/new',
    heading: 'New RFQ',
    company: 'Company',
    description: (n: number) => `Description of item ${n}`,
    quantity: (n: number) => `Quantity of item ${n}`,
    anyDescription: /^Description of item \d+$/,
    found: (items: number, lines: number) => `${items} ${items === 1 ? 'item' : 'items'} found in ${lines} ${lines === 1 ? 'line' : 'lines'}`,
    saveOnly: "Save for later (don't ask suppliers yet)",
    saved: /is saved/,
    /** BUG-SALES-3: a second paste of the same lines (src/features/rfqs/lib/skipRepeats.ts repeatedNote). */
    alreadyThere: (n: number) => `${n} ${n === 1 ? 'line was' : 'lines were'} already there`,
  },
  ask: {
    toAskSlot: 'suppliers-to-ask',
    copyFor: (n: number) => `Copy message for ${n} ${n === 1 ? 'supplier' : 'suppliers'}`,
    copied: 'Message copied',
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
