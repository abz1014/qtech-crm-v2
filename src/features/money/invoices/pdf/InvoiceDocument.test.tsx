import path from 'node:path'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { buildInvoiceDoc, type InvoicePdfSource } from '@/features/money/invoices/pdf/doc'
import { InvoiceDocument } from '@/features/money/invoices/pdf/InvoiceDocument'

/*
 * The invoice PDF really renders (react-pdf in Node, the app's Geist faces from @fontsource), across pages, with every optional
 * part present. The figures themselves are proven in model.test.ts.
 */
const files = path.resolve(__dirname, '../../../../../node_modules/@fontsource')
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
  email: 'accounts@example.com',
  website: 'example.com',
  ntn: '1234567-8',
  strn: '17-00-1234-567-89',
  bank_name: 'Example Bank',
  bank_account_title: 'Q-Tech Engineering',
  bank_iban: 'PK00EXMP0000000000000000',
  quotation_validity_days: 30,
  default_payment_terms_days: 30,
  quotation_terms: null,
  po_terms: null,
  updated_at: '2026-10-20T00:00:00Z',
}

describe('InvoiceDocument', () => {
  it('renders a multi-page sales tax invoice', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      id: `l${i}`,
      description: i % 3 === 0 ? `Pressure transmitter ${i}\nRange 0-10 bar, 4-20 mA, IP67` : `Cable gland M20 ${i}`,
      qty: i % 2 ? 2 : '12.5',
      unit: i % 2 ? 'pcs' : 'm',
      unitPriceNet: '1234.56',
      gstRate: i === 39 ? 0 : 18,
    }))
    const nets = lines.map(l => Math.round(Number(l.qty) * 123456) / 100)
    const gsts = lines.map((l, i) => (Number(l.gstRate) > 0 ? Math.round((nets[i] * 18) / 100) : 0))
    const src: InvoicePdfSource = {
      invoice: {
        id: 'i1',
        number: 'INV-0012',
        invoiceDate: '2026-10-20',
        net: nets.reduce((s, n) => s + n, 0).toFixed(2),
        gst: gsts.reduce((s, n) => s + n, 0).toFixed(2),
        orderId: 'o1',
      },
      order: { id: 'o1', number: 38, customerPo: '4500012345', orderedOn: '2026-10-01', paymentTermsDays: 45, legacyFlags: [] },
      buyer: { id: 'c1', name: 'Acme Cement Ltd', ntn: '7654321-0', strn: '32-77-8761-234-56', salesTaxRegistered: true, invoiceAddress: 'Plot 4, SITE, Karachi' },
      site: { name: 'Kotri plant', address: 'Kotri' },
      lines,
      otherInvoices: [],
    }
    const built = buildInvoiceDoc(src, PROFILE, lines.map(l => ({ id: l.id, qty: l.qty })), 'duplicate')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const buf = await renderToBuffer(<InvoiceDocument doc={built.doc} profile={PROFILE} logoSrc={LOGO} />)
    const text = buf.toString('latin1')
    expect(text.startsWith('%PDF')).toBe(true)
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1)
  }, 60_000)
})
