import { beforeAll, describe, expect, it } from 'vitest'
import { quotationPdf, sapEnquiryPdf } from '@/test/pdfFixtures'
import { parseEnquiry } from './enquiryParse'
import { readPdfText } from './pdfText'
import { parseSupplierQuote } from './supplierQuoteParse'

// End to end, as the screens will use it: a PDF is read on the device, then its text goes through the parser.
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
})

describe('PDF to rows', () => {
  it('an SAP-style RFQ printout becomes items, the RFQ number, the deadline and the company', async () => {
    const pdf = await readPdfText(await sapEnquiryPdf())
    expect(pdf.ok).toBe(true)
    if (!pdf.ok) return
    const r = parseEnquiry(pdf.text, { today: '2026-10-20' })
    expect(r.items).toEqual([
      { description: 'TRANSMITTER,PRESSURE;0-16BAR Make: Rosemount, Model: 3051TG', qty: 2, unit: 'nos' },
      { description: 'GAUGE,PRESSURE;0-10BAR,4" DIAL', qty: 6, unit: 'nos' },
    ])
    expect(r.facts.customerRef?.value).toBe('4500012345')
    expect(r.facts.dueDate?.iso).toBe('2026-11-11')
    expect(r.facts.company?.name).toBe('Margalla Sugar Mills Limited')
  })

  it('a table quotation becomes one offer per RFQ item, matched by part number, with the terms', async () => {
    const pdf = await readPdfText(await quotationPdf(), { subject: 'prices' })
    expect(pdf.ok).toBe(true)
    if (!pdf.ok) return
    const q = parseSupplierQuote(
      pdf.text,
      [
        { id: 'cpu', description: 'Siemens S7-1200 CPU 1214C DC/DC/DC', qty: 2 },
        { id: 'psu', description: 'Siemens power supply 24V 10A', model: '6EP1334-2BA20', qty: 1 },
        { id: 'ctr', description: 'Contactor 24VDC coil 11kW', model: '3RT2026-1BB40', qty: 4 },
      ],
      { today: '2026-10-20' },
    )
    expect(q.offers.map(o => [o.rfqItemId, o.unitPrice, o.currency, o.leadTimeDaysMax, o.validityDays])).toEqual([
      ['cpu', 285, 'USD', 28, 30],
      ['psu', 142.5, 'USD', 28, 30],
      ['ctr', 38.2, 'USD', 28, 30],
    ])
    expect(q.facts).toMatchObject({ quoteRef: 'BAT-Q-2026-0412', quoteDate: '2026-10-15', paymentTerms: '100% advance T/T' })
  })
})
