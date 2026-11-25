import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { InquiryRow, QuoteLineRow, RfqItemRow } from '@/features/rfqs/api'
import { buildStatement } from '@/features/statement/model'
import type { StatementPdfData } from '@/features/statement/pdf/StatementDocument'

/*
 * Synthetic comparative statements for the tests of the PDF and the Excel file (no real company or supplier): five suppliers in three
 * currencies, one that never replied, one that quoted every other item, weights in kg, g and lb, notes on some lines.
 */
export const PROFILE: CompanyProfile = {
  legal_name: 'Q-Tech Engineering (Pvt) Ltd',
  address: 'Office 5, Block 7, Clifton, Karachi',
  phone: '+92 21 0000000',
  email: 'sales@example.com',
  website: 'example.com',
  ntn: null,
  strn: null,
  bank_name: null,
  bank_account_title: null,
  bank_iban: null,
  quotation_validity_days: 30,
  default_payment_terms_days: 30,
  quotation_terms: null,
  po_terms: null,
  sales_email: null,
  sales_phone: null,
  quotation_warranty: null,
  quotation_closing: null,
  quote_next_number: 4810,
  updated_at: '2026-10-29T00:00:00Z',
}

const SUPPLIERS = [
  { name: 'Alpha Instruments GmbH', cur: 'EUR', k: 1, origin: 'Germany', lead: '4-6 weeks' },
  { name: 'Beta Controls Ltd', cur: 'USD', k: 1.08, origin: 'China', lead: '10 days' },
  { name: 'Gamma Supply Co', cur: 'USD', k: 0.97, origin: 'Italy', lead: 'Ex-stock' },
  { name: 'Delta Trading', cur: 'PKR', k: 290, origin: '', lead: '2 weeks' },
  { name: 'Epsilon Automation', cur: 'EUR', k: 1.03, origin: 'Japan', lead: '8 weeks after PO' },
]

export function sampleData(itemCount: number, showNoReply = true): StatementPdfData {
  const items: RfqItemRow[] = Array.from({ length: itemCount }, (_, i) => ({
    id: `i${i}`,
    number: i + 1,
    description: i % 3 === 0 ? `Pressure transmitter ${i + 1}\nRange 0-10 bar, 4-20 mA, IP67, stainless wetted parts` : `Cable gland M20 type ${i + 1}`,
    brandId: null,
    brandName: null,
    familyId: null,
    qty: i % 2 ? 2 : 12.5,
    unit: i % 2 ? 'pcs' : 'm',
  }))
  const inquiries = SUPPLIERS.map((s, si) => {
    const lines: QuoteLineRow[] =
      si === 4
        ? []
        : items
            .filter((_, i) => (si === 3 ? i % 2 === 0 : true))
            .map((it, i) => ({
              id: `${si}-${it.id}`,
              inquiryId: `q${si}`,
              itemId: it.id,
              unitPrice: Math.round((100 + i * 7.31) * s.k * 10000) / 10000,
              currency: s.cur,
              leadTime: s.lead,
              inStock: null,
              fxRatePkr: null,
              fxRateOn: null,
              weight: i % 4 === 3 ? null : 0.4 + (i % 5) * 0.55,
              weightUnit: (i % 7 === 6 ? 'lb' : i % 5 === 2 ? 'g' : 'kg') as 'kg' | 'g' | 'lb',
              origin: s.origin || null,
              notes: i % 6 === 1 ? 'Valid 14 days. Price ex-works.' : null,
            }))
    return {
      id: `q${si}`,
      supplierId: `s${si}`,
      supplierName: s.name,
      sentOn: '2026-10-20',
      noOfferOn: null,
      noOfferReason: null,
      itemDeclines: {},
      lines,
    } as unknown as InquiryRow
  })
  return {
    statement: buildStatement(items, inquiries, { showNoReply }),
    reference: 'Job 139 (RFQ-0139)',
    customer: 'Acme Cement Ltd',
    date: '2026-10-29',
    preparedBy: 'Sana Sales',
    showNoReply,
    grid: { items, inquiries, contact: 'Imran Ali', customerRef: 'ACM-REQ-77' },
  }
}
