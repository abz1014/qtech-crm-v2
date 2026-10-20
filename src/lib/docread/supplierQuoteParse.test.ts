import { describe, expect, it } from 'vitest'
import type { ReplyItemRef, ReplyOffer } from '@/features/rfqs/lib/replyParse'
import { parseSupplierQuote, plainQuoteText } from './supplierQuoteParse'

const TODAY = '2026-10-20'
const parse = (text: string, items: ReplyItemRef[]) => parseSupplierQuote(text, items, { today: TODAY })

const SENSORS: ReplyItemRef[] = [
  { id: 'pe', description: 'Photoelectric sensor diffuse 300mm PNP', model: 'E3Z-D62', qty: 6 },
  { id: 'ind', description: 'Inductive sensor M12 4mm NPN', model: 'E2E-X4C1', qty: 10 },
  { id: 'relay', description: 'Safety relay 24VDC', model: 'G9SA-301', qty: 2 },
]

const PLC: ReplyItemRef[] = [
  { id: 'cpu', description: 'Siemens S7-1200 CPU 1214C DC/DC/DC', qty: 2 },
  { id: 'psu', description: 'Siemens SITOP power supply 24V 10A', model: '6EP1334-2BA20', qty: 1 },
  { id: 'ctr', description: 'Contactor 24VDC coil 11kW', model: '3RT2026-1BB40', qty: 4 },
]

const offer = (offers: ReplyOffer[], id: string): ReplyOffer => {
  const o = offers.filter(x => x.rfqItemId === id)
  expect(o, `offer for ${id}`).toHaveLength(1)
  return o[0] as ReplyOffer
}

describe('parseSupplierQuote: emails', () => {
  it('reads a Chinese supplier email: ￥ prices, "2-3 day", MOQ, validity and payment for the whole quote', () => {
    const r = parse(
      `Dear Ali,
Thanks for your inquiry. Our offer as below:
1. Omron E3Z-D62 photoelectric sensor
Unit price ￥ 8.8 /pc, MOQ 10 pcs
Delivery: 2-3 day
2. Omron E2E-X4C1 inductive sensor
Unit price ￥ 12.5 /pc
Delivery: 5-7 days
Price validity: 15 days
Payment: 100% T/T in advance
Best regards
Lily`,
      SENSORS,
    )
    const pe = offer(r.offers, 'pe')
    expect(pe).toMatchObject({ unitPrice: 8.8, currency: 'CNY', matchedBy: 'model', moq: 10, leadTimeDaysMax: 3, validityDays: 15 })
    const ind = offer(r.offers, 'ind')
    expect(ind).toMatchObject({ unitPrice: 12.5, currency: 'CNY', leadTimeDaysMax: 7, validityDays: 15 })
    expect(ind.inherited).toContain('validity')
    // the MOQ was written for one item, so it is that offer's, not a term of the whole quotation
    expect(r.facts).toMatchObject({ currency: 'CNY', validity: { days: 15 }, paymentTerms: '100% T/T in advance', moq: null })
  })

  it('reads Chinese units and full-width forms', () => {
    expect(plainQuoteText('单价：￥８.８，交货期：3-5天')).toBe('Unit price : ￥8.8, Delivery : 3-5 days')
    const r = parse('E3Z-D62 单价：￥8.8，交货期：3-5天', SENSORS)
    expect(offer(r.offers, 'pe')).toMatchObject({ unitPrice: 8.8, currency: 'CNY', leadTimeDaysMax: 5 })
  })

  it('reads a local PKR quote with Rs. and /- and keeps the bank details and totals out', () => {
    const r = parse(
      `Respected Sir,
With reference to your enquiry, our rates are as under:

1) Photoelectric sensor E3Z-D62 - Rs. 6,850/- each, ex-stock
2) Inductive sensor E2E-X4C1 - Rs. 4,200/- each, 1 week
3) Safety relay G9SA-301 - Rs. 38,500/- each, 3-4 weeks

Grand Total: PKR 157,200
Prices are inclusive of 18% GST.
Bank: Meezan Bank, A/C Title: Sialkot Automation Demo, IBAN PK36MEZN0001234567890123
Regards
Sialkot Automation Demo`,
      SENSORS,
    )
    expect(offer(r.offers, 'pe')).toMatchObject({ unitPrice: 6850, currency: 'PKR', inStock: true, leadTimeDaysMax: 0 })
    expect(offer(r.offers, 'ind')).toMatchObject({ unitPrice: 4200, currency: 'PKR', leadTimeDaysMax: 7 })
    expect(offer(r.offers, 'relay')).toMatchObject({ unitPrice: 38500, currency: 'PKR', leadTimeDaysMax: 28 })
    expect(r.offers).toHaveLength(3)
    expect(r.dropped).toEqual(['Grand Total: PKR 157,200', 'Bank: Meezan Bank, A/C Title: Sialkot Automation Demo, IBAN PK36MEZN0001234567890123'])
  })

  it('reads EUR with a decimal comma, AED and USD symbols, matched by description when there is no part number', () => {
    const items: ReplyItemRef[] = [
      { id: 'flow', description: 'Electromagnetic flow meter DN80', qty: 2 },
      { id: 'level', description: 'Ultrasonic level transmitter 0-8 m', qty: 1 },
      { id: 'gauge', description: 'Pressure gauge 4 inch 0-10 bar', qty: 6 },
    ]
    const r = parse(
      `Electromagnetic flow meter DN80: € 1.250,00 per unit, delivery 6-8 weeks
Ultrasonic level transmitter: AED 2,950 each, 2 weeks
Pressure gauge 4 inch: $38.50 /pc, ex-stock`,
      items,
    )
    expect(offer(r.offers, 'flow')).toMatchObject({ unitPrice: 1250, currency: 'EUR', leadTimeDaysMax: 56, matchedBy: 'description' })
    expect(offer(r.offers, 'level')).toMatchObject({ unitPrice: 2950, currency: 'AED', leadTimeDaysMax: 14 })
    expect(offer(r.offers, 'gauge')).toMatchObject({ unitPrice: 38.5, currency: 'USD', inStock: true })
  })

  it('keeps an item the supplier cannot quote as declined', () => {
    const r = parse('E3Z-D62: USD 9.80/pc, 1 week\nG9SA-301: sorry, discontinued, not available', SENSORS)
    expect(offer(r.offers, 'pe')).toMatchObject({ unitPrice: 9.8, currency: 'USD' })
    expect(r.declined).toEqual([expect.objectContaining({ rfqItemId: 'relay', kind: 'discontinued' })])
  })
})

describe('parseSupplierQuote: a quotation PDF read as text', () => {
  // What pdfText.ts returns for a table quotation (see pdfText.test.ts): header lines, a tab table, a total, terms.
  const PDF_TEXT = [
    'QUOTATION',
    'Bright Automation Trading Co., Ltd.',
    'Quotation No: BAT-Q-2026-0412',
    'Date: 15/10/2026',
    'To: Q-Tech Engineering',
    'Your Ref: QT-RFQ-0118',
    '',
    'No.\tPart No.\tDescription\tQty\tUnit\tUnit Price (USD)\tAmount (USD)',
    '1\t6ES7214-1AG40-0XB0\tSIMATIC S7-1200 CPU 1214C DC/DC/DC, 14 DI / 10 DO\t2\tPCS\t285.00\t570.00',
    '2\t6EP1334-2BA20\tSITOP PSU100S 24 V/10 A\t1\tPCS\t142.50\t142.50',
    '3\t3RT2026-1BB40\tContactor 24VDC coil\t4\tPCS\t38.20\t152.80',
    '\t\t\t\t\tSub Total\t865.30',
    '',
    'Delivery: 3-4 weeks after PO',
    'Validity: 30 days',
    'Payment: 100% advance T/T',
    'Price basis: FOB Shanghai',
  ].join('\n')

  it('maps each table row to its RFQ item by part number or description, with the currency from the header', () => {
    const r = parse(PDF_TEXT, PLC)
    expect(offer(r.offers, 'cpu')).toMatchObject({ unitPrice: 285, currency: 'USD', totalPrice: 570, qty: 2 })
    expect(offer(r.offers, 'psu')).toMatchObject({ unitPrice: 142.5, currency: 'USD', matchedBy: 'model' })
    expect(offer(r.offers, 'ctr')).toMatchObject({ unitPrice: 38.2, currency: 'USD', matchedBy: 'model' })
    expect(r.offers).toHaveLength(3)
    // the terms under the table apply to every item
    for (const o of r.offers) expect(o).toMatchObject({ leadTimeDaysMax: 28, validityDays: 30 })
  })

  it('reads the header and terms as facts and lists the lines it left out', () => {
    const r = parse(PDF_TEXT, PLC)
    expect(r.facts).toEqual({
      quoteRef: 'BAT-Q-2026-0412',
      quoteDate: '2026-10-15',
      currency: 'USD',
      validity: { text: 'Validity: 30 days', days: 30 },
      leadTime: expect.objectContaining({ daysMin: 21, daysMax: 28 }),
      paymentTerms: '100% advance T/T',
      incoterm: 'FOB Shanghai',
      moq: null,
    })
    expect(r.dropped).toEqual(['Quotation No: BAT-Q-2026-0412', 'Date: 15/10/2026', 'To: Q-Tech Engineering', 'Your Ref: QT-RFQ-0118', 'Sub Total\t865.30'])
  })

  it('reads a proforma invoice with ¥ in the header and a validity date', () => {
    const r = parse(
      [
        'PROFORMA INVOICE',
        'PI No.: SZ-PI-26-1187',
        'Item\tModel\tQty\tUnit Price (¥)\tAmount (¥)',
        '1\tE3Z-D62\t6\t8.80\t52.80',
        '2\tE2E-X4C1\t10\t12.50\t125.00',
        'Total\t\t\t\t177.80',
        'Valid until 31 Oct 2026',
        'MOQ: 5 pcs per model',
      ].join('\n'),
      SENSORS,
    )
    expect(offer(r.offers, 'pe')).toMatchObject({ unitPrice: 8.8, currency: 'CNY' })
    expect(offer(r.offers, 'ind')).toMatchObject({ unitPrice: 12.5, currency: 'CNY' })
    expect(r.facts).toMatchObject({ quoteRef: 'SZ-PI-26-1187', currency: 'CNY', validity: { days: 11 }, moq: 5 })
  })
})
