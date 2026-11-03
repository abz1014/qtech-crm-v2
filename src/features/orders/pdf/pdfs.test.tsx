import path from 'node:path'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { OrderItemRow } from '@/features/orders/api'
import { header } from '@/features/orders/lib/stepFixtures'
import { buildChallanDoc, challanFileName } from '@/features/orders/challans/pdf/doc'
import { ChallanDocument } from '@/features/orders/challans/pdf/ChallanDocument'
import type { ChallanRow } from '@/features/orders/challans/model'
import { buildServiceReportDoc, serviceReportFileName } from '@/features/orders/visits/pdf/doc'
import { ServiceReportDocument } from '@/features/orders/visits/pdf/ServiceReportDocument'
import type { VisitRow } from '@/features/orders/visits/model'

/*
 * The two paper documents of an order really render (react-pdf in Node, the app's Geist faces from @fontsource), across pages, and the data
 * they are made from carries no price. Synthetic data only.
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
  email: 'office@example.com',
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
  updated_at: '2026-10-20T00:00:00Z',
}

const ORDER = header({
  number: 38,
  companyName: 'Alpenmark Controls',
  customerPo: 'PO-7781',
  site: { name: 'Plant 2', address: 'Industrial Estate, Wah Cantt' },
  contact: { name: 'Sana Iqbal', phone: '0300 0000000' },
})

const item = (n: number, over: Partial<OrderItemRow> = {}): OrderItemRow =>
  ({ id: `i${n}`, number: n, description: n % 3 === 0 ? `Pressure transmitter ${n}\nRange 0-10 bar, 4-20 mA` : `Cable gland M20 ${n}`, brandName: null, model: null, qty: n % 2 ? 2 : 12.5, unit: n % 2 ? 'pcs' : 'm', isService: false, legId: null, rfqItemId: null, unitPriceNet: 1234.56, gstRate: 18, supplierUnitPrice: 999, ...over }) as OrderItemRow

const VISIT: VisitRow = { id: 'v1', orderId: 'o', type: 'service', on: '2026-10-30', engineerId: 'e1', engineerName: 'Hamza Sheikh', notes: 'Replaced the transmitter.\nChecked the 4-20 mA loop.\n\nCustomer shown the new range.', doneOn: '2026-10-30' }

describe('service report', () => {
  it('is built from the visit and the order, goods only, with no price', () => {
    const doc = buildServiceReportDoc(ORDER, VISIT, [item(1), item(2, { isService: true, description: 'Commissioning' })], '2026-10-30')
    expect(doc).toMatchObject({ orderRef: 'ORD-0038', visitType: 'Service', engineer: 'Hamza Sheikh', customer: 'Alpenmark Controls', siteName: 'Plant 2', workDone: VISIT.notes })
    expect(doc.items).toEqual([{ no: 1, description: 'Cable gland M20 1', qty: 2, unit: 'pcs' }])
    expect(JSON.stringify(doc)).not.toMatch(/1234|999|price|gst/i)
    expect(serviceReportFileName(doc)).toBe('Service-report-ORD-0038-service-2026-10-30.pdf')
  })

  it('renders a multi-page PDF', async () => {
    const doc = buildServiceReportDoc(ORDER, VISIT, Array.from({ length: 45 }, (_, i) => item(i + 1)), '2026-10-30')
    const buf = await renderToBuffer(<ServiceReportDocument doc={doc} profile={PROFILE} logoSrc={LOGO} />)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(3000)
  })

  it('renders with nothing optional filled in', async () => {
    const doc = buildServiceReportDoc(header({ number: 5 }), { ...VISIT, on: null, doneOn: null, engineerName: null, notes: null }, [], '2026-10-30')
    const buf = await renderToBuffer(<ServiceReportDocument doc={doc} profile={{ ...PROFILE, legal_name: null, address: null }} logoSrc={LOGO} />)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('delivery challan', () => {
  const CHALLAN: ChallanRow = {
    id: 'c1',
    orderId: 'o',
    number: 'DC-0007',
    issuedOn: '2026-10-30',
    deliverTo: 'Plant 2\nIndustrial Estate, Wah Cantt',
    notes: null,
    lines: Array.from({ length: 40 }, (_, i) => ({ itemId: `i${i}`, description: item(i + 1).description, unit: item(i + 1).unit, qty: item(i + 1).qty })),
  }

  it('is built from the challan, with a number and no price', () => {
    const doc = buildChallanDoc(ORDER, CHALLAN)
    expect(doc).toMatchObject({ number: 'DC-0007', orderRef: 'ORD-0038', customer: 'Alpenmark Controls', customerPo: 'PO-7781' })
    expect(doc.lines).toHaveLength(40)
    expect(JSON.stringify(doc)).not.toMatch(/1234|999|price|gst/i)
    expect(challanFileName(doc)).toBe('Delivery-challan-DC-0007.pdf')
  })

  it('renders a multi-page PDF', async () => {
    const buf = await renderToBuffer(<ChallanDocument doc={buildChallanDoc(ORDER, CHALLAN)} profile={PROFILE} logoSrc={LOGO} />)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(3000)
  })
})
