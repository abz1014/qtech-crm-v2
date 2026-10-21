// The parsers' verdicts in the shape the scorer (score.ts) takes. Kept apart from score.ts so the scorer has no imports from
// the app (the e2e spec imports it under the Node tsconfig).

import type { EnquiryParse } from '../enquiryParse'
import type { SupplierQuoteParse } from '../supplierQuoteParse'
import type { EnquiryResult, QuoteResult } from './score'

export function enquiryResult(p: EnquiryParse): EnquiryResult {
  return {
    items: p.items.map(i => ({ description: i.description, qty: i.qty, unit: i.unit })),
    ref: p.facts.customerRef?.value ?? null,
    due: p.facts.dueDate?.iso ?? null,
    company: p.facts.company?.name ?? null,
    domain: p.facts.company?.domain ?? null,
  }
}

export function quoteResult(p: SupplierQuoteParse): QuoteResult {
  return {
    offers: p.offers.map(o => ({ itemId: o.rfqItemId, unitPrice: o.unitPrice, currency: o.currency, leadMax: o.leadTimeDaysMax, validityDays: o.validityDays })),
    currency: p.facts.currency,
    validityDays: p.facts.validity?.days ?? null,
    leadMax: p.facts.leadTime?.daysMax ?? null,
    payment: p.facts.paymentTerms,
    incoterm: p.facts.incoterm,
    quoteRef: p.facts.quoteRef,
  }
}
