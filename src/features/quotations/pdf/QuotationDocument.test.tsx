import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { PdfData, QuotationLine } from '@/features/quotations/api'
import { QuotationDocument } from '@/features/quotations/pdf/QuotationDocument'

/*
 * The quotation PDF really renders (react-pdf in Node, the app's Geist faces from @fontsource) in the layout of the owner's template,
 * across pages for a long quotation, and says what the template says. Invented data only: no real customer, person or price.
 * QUOTE_SAMPLE_DIR=<folder> also writes the two sample PDFs there, to look at.
 */
const root = path.resolve(__dirname, '../../../..')
const files = path.join(root, 'node_modules/@fontsource')
Font.register({
  family: 'Geist',
  fonts: [400, 500, 600].map(w => ({ src: path.join(files, `geist-sans/files/geist-sans-latin-${w}-normal.woff`), fontWeight: w })),
})
Font.registerHyphenationCallback(word => [word])

// the real letterhead, as a data URL (a Windows path would be read as a URL)
const LOGO = `data:image/png;base64,${readFileSync(path.join(root, 'public/brand/quote-letterhead.png')).toString('base64')}`

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
})

const SAMPLE_PROFILE: CompanyProfile = {
  legal_name: 'Q Tech Solutions (Private) Limited',
  address: '12 Sample Road, Block C\nModel Town, Lahore, Pakistan',
  phone: '+92 300 0000001',
  email: 'office@example.com',
  website: 'https://example.com/',
  sales_email: 'sales@example.com',
  sales_phone: '0092-300-0000002',
  ntn: null,
  strn: null,
  bank_name: null,
  bank_account_title: null,
  bank_iban: null,
  quotation_validity_days: 14,
  default_payment_terms_days: 30,
  quotation_terms: null,
  quotation_warranty:
    'One year warranty against any manufacturing defects from the date of supply; in this case we will rectify the issue and may provide you free of cost replacement where applicable. Our liability excludes due to natural wear & tear, defects arising after transfer of risk owning etc., contrary to manuals and instructions, mishandling or negligence on part of the customer.',
  quotation_closing:
    'We hope that the above specification meets your requirement and we would be given opportunity to work with your esteemed organization to get order for these items.',
  po_terms: null,
  quote_next_number: 4810,
  updated_at: '2026-11-20T00:00:00Z',
}

const line = (n: number, over: Partial<QuotationLine> = {}): QuotationLine => ({
  rfq_item_id: `item-${n}`,
  description: n % 2 ? `Pressure transmitter PT-${n}\nModel: PTX-${100 + n}\nSpecs: 0 to 10 bar, 4 to 20 mA output` : `Cable gland M${20 + n}`,
  qty: n % 3 ? 2 : 12,
  unit: 'pcs',
  unit_price_net: 18_900 + n * 100,
  gst_rate: 18,
  lead_time: '4 to 6 weeks',
  ...over,
})

function sampleData(lines: QuotationLine[], over: Partial<PdfData> = {}): PdfData {
  return {
    quotation: {
      id: 'q1',
      number: 4810,
      code: 'TQA',
      revision: 0,
      issuedOn: '2026-11-23',
      validUntil: '2026-12-07',
      contactId: 'c1',
      lines,
      netTotal: 0,
      gstTotal: 0,
      deliveryText: null,
      paymentTerms: '30',
      notes: null,
      signatoryId: 'u1',
      pdfPath: null,
    },
    previous: null,
    firstIssuedOn: '2026-11-23',
    customer: { name: 'Tasman Quarry Allied (Pvt) Ltd.', country: 'Pakistan', city: 'Sialkot', code: 'TQA', address: null },
    siteName: 'Head office',
    siteAddress: '7-Sample Avenue, Sialkot.',
    attention: 'Imran Sample',
    attentionTitle: 'Purchase Officer',
    customerRef: '55120',
    rfqNumber: 42,
    receivedOn: '2026-11-21',
    brands: { 'item-1': 'Acme Sensors' },
    signatory: { name: 'Bilal Example', jobTitle: 'Sales Engineer', phone: '0300 0000003' },
    ...over,
  }
}

async function textOf(buf: Buffer): Promise<{ pages: number; text: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise
  const text: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent()
    // a bold label is its own text run: "Price Validity" then ": 2 Weeks.", joined back without the gap
    text.push(c.items.map(i => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ').replace(/ ([:,.)])/g, '$1'))
  }
  return { pages: doc.numPages, text }
}

async function render(data: PdfData, profile = SAMPLE_PROFILE): Promise<Buffer> {
  return renderToBuffer(<QuotationDocument data={data} profile={profile} logoSrc={LOGO} />)
}

async function keep(name: string, buf: Buffer) {
  const dir = process.env.QUOTE_SAMPLE_DIR
  if (!dir) return
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path.join(dir, name), buf)
}

describe('quotation PDF (owner template)', () => {
  it('prints the template on one A4 page', async () => {
    const buf = await render(sampleData([line(1, { lead_time: '4 weeks' }), line(2, { lead_time: '4 weeks' }), line(3, { lead_time: '4 weeks' })]))
    await keep('quote-sample.pdf', buf)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+595\.28\d*\s+841\.89\d*\s*\]/)
    const { pages, text } = await textOf(buf)
    expect(pages).toBe(1)
    const t = text[0]
    for (const want of [
      'M/s: Tasman Quarry Allied (Pvt) Ltd.',
      'Address: 7-Sample Avenue, Sialkot.',
      'Quote Ref:',
      'QTS-TQA-4810',
      '23-Nov-26',
      'To: Mr. Imran Sample (Purchase Officer),',
      'Thank you very much for your Inquiry. Please see below our techno/commercial offer for the requested items.',
      'Ref. 55120',
      'Inquiry Date: 21-11-2026',
      'Sr#',
      'Item Description',
      'Quantity',
      'Unit Pr. (PKR)',
      'Total Pr. (PKR)',
      'PRESSURE TRANSMITTER PT-1',
      'Model: PTX-101',
      'Make: ACME SENSORS',
      '19,000',
      'Gross Amount W/O GST',
      'Terms and Conditions:',
      'Price Validity: 2 Weeks.',
      'Delivery Time: 4 weeks.',
      'Prices are in PKR, exclusive of GST, and will be charged as per the Govt. Law.',
      'Prices are on F-O-R Sialkot.',
      'Payment Terms: 30 Days Credit.',
      'Warranty:',
      'esteemed organization',
      'Bilal Example (Sales Engineer)',
      'Cell No: 0092-300-0000002',
      'sales@example.com',
      'Q Tech Solutions (Private) Limited',
      'https://example.com/',
      '+92 300 0000001',
      'office@example.com',
      '12 Sample Road, Block C',
    ])
      expect(t, want).toContain(want)
    // the owner's choice: no GST line and no total with GST; no revision mark on a first issue
    expect(t).not.toMatch(/GST @|Total with GST|Rev \d/)
    // the gross: 2 x 19,000 + 2 x 19,100 + 12 x 19,200
    expect(t).toContain('306,600')
  })

  it('flows a long quotation onto more pages, with the table header and the footer on each', async () => {
    const lines = Array.from({ length: 16 }, (_, i) => line(i + 1, { lead_time: i % 2 ? '8 weeks' : '2 weeks' }))
    const buf = await render(sampleData(lines, { quotation: { ...sampleData([]).quotation, lines, revision: 1 } }))
    await keep('quote-sample-long.pdf', buf)
    const { pages, text } = await textOf(buf)
    expect(pages).toBe(2)
    for (const t of text) {
      expect(t).toContain('Item Description')
      expect(t).toContain('office@example.com')
    }
    expect(text[0]).toContain('QTS-TQA-4810 Rev 1')
    expect(text.join(' ')).toContain('Delivery Time: Mentioned against each item.')
    expect(text.join(' ')).toContain('Delivery: 8 weeks')
  })

  it('says item for one line, drops lines without their data, and keeps an older number', async () => {
    const data = sampleData([line(2, { lead_time: null })], {
      attention: null,
      attentionTitle: null,
      customerRef: null,
      receivedOn: null,
      brands: {},
      customer: { name: 'Older Customer Ltd', country: null, city: null, code: null, address: null },
      siteAddress: null,
    })
    data.quotation = { ...data.quotation, code: null, number: 42, paymentTerms: null }
    const t = (await textOf(await render(data, { ...SAMPLE_PROFILE, default_payment_terms_days: 0 }))).text[0]
    expect(t).toContain('QT-26-0042')
    expect(t).toContain('for the requested item.')
    expect(t).not.toContain('To:')
    expect(t).not.toMatch(/Delivery Time|F-O-R|Payment Terms|Make:/)
  })

  it('previews a first issue with the customer code and no number', async () => {
    const data = sampleData([line(1)], { preview: true })
    data.quotation = { ...data.quotation, number: 0, code: null }
    const t = (await textOf(await render(data))).text[0]
    expect(t).toContain('QTS-TQA-NNNN')
    expect(t).toContain('DRAFT, NOT ISSUED')
  })
})
