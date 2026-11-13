/** Words the verify-admin suite looks for. */
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
    open: 'Send quotation',
    price: (n: number) => `Unit price, net PKR, item ${n}`,
    issue: 'Issue quotation',
  },
} as const
