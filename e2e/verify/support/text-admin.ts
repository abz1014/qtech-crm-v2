/* Words the verify-admin suite looks for. Merged into text.ts at the end; import them from ./text. */
export const ADMIN = {
  profile: {
    path: '/settings/company',
    legalName: 'Legal name',
    ntn: 'NTN',
    validity: 'Quotation validity',
    defaultTerms: 'Default payment terms',
    save: 'Save changes',
  },
  rates: {
    path: '/settings/exchange-rates',
    currency: 'Currency',
    rate: 'Rate, PKR for 1 unit',
    save: 'Save rate',
  },
  quote: {
    open: /Issue/,
    price: (n: number) => `Unit price, net PKR, item ${n}`,
    issue: 'Issue quotation',
  },
} as const
