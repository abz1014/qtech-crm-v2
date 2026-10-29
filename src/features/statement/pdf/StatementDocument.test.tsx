import path from 'node:path'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { InquiryRow, QuoteLineRow, RfqItemRow } from '@/features/rfqs/api'
import { buildStatement } from '@/features/statement/model'
import { StatementDocument, type StatementPdfData } from '@/features/statement/pdf/StatementDocument'

/*
 * The comparative statement PDF really renders (react-pdf in Node, the app's Geist faces from @fontsource): A4 landscape, over
 * several pages, with the column headings repeated and a page number on each. Synthetic data only. Setting STATEMENT_SAMPLE_PDF to a
 * path also writes the file there, for looking at.
 */
const files = path.resolve(__dirname, '../../../../node_modules/@fontsource')
Font.register({
  family: 'Geist',
  fonts: [400, 500, 600].map(w => ({ src: path.join(files, `geist-sans/files/geist-sans-latin-${w}-normal.woff`), fontWeight: w })),
})
Font.register({
  family: 'Geist Mono',
  fonts: [400, 500].map(w => ({ src: path.join(files, `geist-mono/files/geist-mono-latin-${w}-normal.woff`), fontWeight: w })),
})
Font.registerHyphenationCallback(word => [word])

// a 1 x 1 transparent PNG stands in for the wordmark
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const PROFILE: CompanyProfile = {
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
    orderNote: 'Suppliers are listed by name. Nothing is selected.',
  }
}

const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length

describe('StatementDocument', () => {
  it('renders a multi-page A4 landscape statement', async () => {
    const buf = await renderToBuffer(<StatementDocument data={sampleData(24)} profile={PROFILE} logoSrc={LOGO} />)
    const text = buf.toString('latin1')
    expect(text.startsWith('%PDF')).toBe(true)
    expect(pages(buf)).toBeGreaterThan(1)
    // A4 landscape: the media box is 841.89 wide and 595.28 tall
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841\.89\d*\s+595\.28\d*\s*\]/)
    if (process.env.STATEMENT_SAMPLE_PDF) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.STATEMENT_SAMPLE_PDF, buf)
    }
  }, 60_000)

  it('renders a one-page statement, and one with nothing quoted yet', async () => {
    const one = await renderToBuffer(<StatementDocument data={sampleData(1, false)} profile={PROFILE} logoSrc={LOGO} />)
    if (process.env.STATEMENT_SAMPLE_PDF) (await import('node:fs')).writeFileSync(`${process.env.STATEMENT_SAMPLE_PDF}.small.pdf`, one)
    expect(pages(one)).toBe(1)
    const empty = sampleData(2, false)
    empty.statement = buildStatement([], [])
    const none = await renderToBuffer(<StatementDocument data={empty} profile={PROFILE} logoSrc={LOGO} />)
    expect(none.toString('latin1').startsWith('%PDF')).toBe(true)
  }, 60_000)
})
